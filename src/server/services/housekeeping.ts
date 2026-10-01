import 'server-only';
import { Prisma, type Priority } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canAccessHousekeeping, housekeepingActions, housekeepingNeedsNote, housekeepingTransition, isHousekeepingClosed, type HousekeepingAction, type HousekeepingStatus } from '@/domain/housekeeping';
import type { GlobalSearchResult } from './global-search';

// Deliberately role-bound during the private pilot: technical permissions alone
// cannot enable the module for any operational/custom role.
export function assertHousekeepingAdmin(user: Pick<CurrentUser, 'roleKey'>) {
  if (!canAccessHousekeeping(user.roleKey)) throw new ForbiddenError('Housekeeping está disponible únicamente para el Administrador de sistema.');
}

/** Private pilot content must not leak through shared history or Fronti. */
export function housekeepingAuditVisibility(user: Pick<CurrentUser, 'roleKey'>): Prisma.AuditLogWhereInput {
  return canAccessHousekeeping(user.roleKey) ? {} : { NOT: { entity: 'HousekeepingRequest' } };
}

const include = {
  sourceEntry: { select: { id: true, humanId: true, title: true, description: true, updatedAt: true, deletedAt: true, status: true, room: { select: { number: true } } } },
  events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' as const }, take: 20 },
} satisfies Prisma.HousekeepingRequestInclude;

export function housekeepingSourceChanged(request: { acknowledgedAt: Date | null; sourceVersion: Date | null; sourceEntry: { updatedAt: Date } | null }): boolean {
  return !!request.acknowledgedAt && !!request.sourceEntry && request.sourceVersion?.getTime() !== request.sourceEntry.updatedAt.getTime();
}

export async function getHousekeepingBoard(user: CurrentUser, history = false, page = 1, focusId?: number) {
  assertHousekeepingAdmin(user);
  const terminal = ['RESUELTO', 'CANCELADO'];
  const currentPage = Number.isSafeInteger(page) ? Math.min(10000, Math.max(1, page)) : 1;
  const selectedStatus = history ? { in: terminal } : { notIn: terminal };
  const where = { status: selectedStatus, ...(Number.isSafeInteger(focusId) && focusId! > 0 ? { humanId: focusId } : {}) };
  const [requests, total, active, pending, blocked, overdue] = await Promise.all([
    prisma.housekeepingRequest.findMany({
      where, include,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }], take: 25, skip: (currentPage - 1) * 25,
    }),
    prisma.housekeepingRequest.count({ where }),
    prisma.housekeepingRequest.count({ where: { status: { notIn: terminal } } }),
    prisma.housekeepingRequest.count({ where: { acknowledgedAt: null, status: { notIn: terminal } } }),
    prisma.housekeepingRequest.count({ where: { status: 'BLOQUEADO' } }),
    prisma.housekeepingRequest.count({ where: { status: { notIn: terminal }, dueAt: { lt: new Date() } } }),
  ]);
  return { requests, total, page: currentPage, active, pending, blocked, overdue };
}

export async function searchHousekeepingRecords(user: CurrentUser, query: string, limit = 60): Promise<GlobalSearchResult[]> {
  assertHousekeepingAdmin(user);
  const text = query.trim().replace(/^#/, '').slice(0, 200);
  if (!text) return [];
  const terms = text.toLocaleLowerCase('es-CL').split(/\s+/).filter(Boolean).slice(0, 8);
  const haystack = Prisma.sql`lower(concat_ws(' ', h."humanId"::text, 'Housekeeping piloto', coalesce(e."title", h."title"), coalesce(e."description", h."description"), h."location", h."status"))`;
  return prisma.$queryRaw<GlobalSearchResult[]>(Prisma.sql`
    SELECT h."humanId", 'HousekeepingRequest'::text AS "entityType", h."id" AS "entityId",
      'Housekeeping · prueba administrativa'::text AS "kind", coalesce(e."title", h."title") AS "title",
      coalesce(e."description", h."description") AS "summary", h."status", h."location" AS "roomNumber",
      NULL::text AS "guestName", NULL::text AS "responsible", 'Piloto privado'::text AS "category", h."createdAt",
      '/admin/housekeeping?vista=' || CASE WHEN h."status" IN ('RESUELTO', 'CANCELADO') THEN 'historial' ELSE 'pendientes' END || '&aviso=' || h."humanId"::text || '#aviso-' || h."humanId"::text AS "href"
    FROM "HousekeepingRequest" h LEFT JOIN "OperationalEntry" e ON e."id" = h."sourceEntryId"
    WHERE ${Prisma.join(terms.map((term) => Prisma.sql`${haystack} LIKE ${`%${term}%`}`), ' AND ')}
    ORDER BY CASE WHEN h."humanId"::text = ${text} THEN 0 ELSE 1 END, h."createdAt" DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `);
}

export async function getHousekeepingSources(user: CurrentUser, query = '') {
  assertHousekeepingAdmin(user);
  const text = query.trim().slice(0, 100);
  const number = /^#?\d+$/.test(text) ? Number(text.replace('#', '')) : undefined;
  return prisma.operationalEntry.findMany({
    where: {
      deletedAt: null, housekeepingRequest: null,
      status: { notIn: ['CERRADO', 'RESUELTO'] },
      ...(text ? { OR: [{ title: { contains: text, mode: 'insensitive' as const } }, { room: { number: { contains: text } } }, ...(number && Number.isSafeInteger(number) ? [{ humanId: number }] : [])] } : {}),
    },
    select: { id: true, humanId: true, title: true, room: { select: { number: true } } },
    orderBy: { createdAt: 'desc' }, take: 25,
  });
}

type CreateInput = { requestKey: string; title?: string; description?: string; sourceEntryId?: string; location?: string; priority: Priority; dueAt?: Date | null };

export async function createHousekeepingRequest(user: CurrentUser, input: CreateInput) {
  assertHousekeepingAdmin(user);
  if (!input.sourceEntryId && (!input.title?.trim() || !input.description?.trim())) throw new RuleError('Indica qué necesita Housekeeping y el contexto.');
  const existing = await prisma.housekeepingRequest.findUnique({ where: { requestKey: input.requestKey } });
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      const source = input.sourceEntryId ? await tx.operationalEntry.findFirst({ where: { id: input.sourceEntryId, deletedAt: null, status: { notIn: ['CERRADO', 'RESUELTO'] } } }) : null;
      if (input.sourceEntryId && !source) throw new NotFoundError('La novedad ya no está disponible para vincular.');
      const request = await tx.housekeepingRequest.create({ data: {
        requestKey: input.requestKey, sourceEntryId: source?.id,
        // Linked notices read their content from the canonical entry. No copy.
        title: source ? null : input.title!.trim(), description: source ? null : input.description!.trim(),
        location: input.location?.trim() || null, priority: source?.priority ?? input.priority, dueAt: input.dueAt ?? source?.dueAt,
        events: { create: { actorId: user.id, action: 'CREAR', toStatus: 'PENDIENTE', note: 'Aviso creado en el piloto administrativo; no enviado al personal.' } },
      } });
      await tx.auditLog.create({ data: { entity: 'HousekeepingRequest', entityId: request.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Piloto Housekeeping: aviso #${request.humanId}`, isDemo: true } });
      return request;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const repeated = await prisma.housekeepingRequest.findUnique({ where: { requestKey: input.requestKey } });
      if (repeated) return repeated;
      throw new RuleError('Esta novedad ya está vinculada a Housekeeping. Abre el aviso existente.');
    }
    throw error;
  }
}

type ChangeInput = { id: string; version: number; action: HousekeepingAction; note?: string; dueAt?: Date | null };

export async function changeHousekeepingRequest(user: CurrentUser, input: ChangeInput) {
  assertHousekeepingAdmin(user);
  const note = input.note?.trim() || null;
  if (housekeepingNeedsNote(input.action) && !note) throw new RuleError('Registra el motivo o resultado para conservar la trazabilidad.');
  return prisma.$transaction(async (tx) => {
    const current = await tx.housekeepingRequest.findUnique({ where: { id: input.id }, include: { sourceEntry: { select: { updatedAt: true, deletedAt: true } } } });
    if (!current) throw new NotFoundError();
    if (current.sourceEntryId) {
      // Freeze the exact source version during acknowledgement/transition.
      await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id" = ${current.sourceEntryId} FOR SHARE`;
      current.sourceEntry = await tx.operationalEntry.findUnique({ where: { id: current.sourceEntryId }, select: { updatedAt: true, deletedAt: true } });
    }
    if (current.version !== input.version) throw new RuleError('Este aviso cambió en otra ventana. Actualiza la página antes de continuar.');
    const changed = housekeepingSourceChanged(current);
    if (!housekeepingActions(current.status as HousekeepingStatus, changed).includes(input.action)) throw new RuleError(changed ? 'La novedad cambió: revisa y confirma su nueva versión antes de avanzar.' : 'La acción no corresponde al estado actual.');
    if (current.sourceEntry?.deletedAt && !['CANCELAR', 'REABRIR'].includes(input.action)) throw new RuleError('La novedad de origen fue archivada. Revisa el caso y cancela el aviso con motivo si corresponde.');
    let next: HousekeepingStatus;
    try { next = housekeepingTransition(current.status as HousekeepingStatus, input.action, !!current.acknowledgedAt); }
    catch (error) { throw new RuleError((error as Error).message); }
    const confirm = input.action === 'CONFIRMAR';
    const reopen = input.action === 'REABRIR';
    const update = await tx.housekeepingRequest.updateMany({
      where: { id: current.id, version: input.version }, data: {
        status: next, version: { increment: 1 },
        ...(confirm ? { acknowledgedAt: new Date(), sourceVersion: current.sourceEntry?.updatedAt ?? null, ...(input.dueAt ? { dueAt: input.dueAt } : {}) } : {}),
        ...(reopen ? { acknowledgedAt: null, sourceVersion: null, resolvedAt: null, resolution: null, blockReason: null } : {}),
        ...(['ACLARAR', 'BLOQUEAR'].includes(input.action) ? { blockReason: note } : {}),
        ...(['RETOMAR', 'INICIAR'].includes(input.action) ? { blockReason: null } : {}),
        ...(input.action === 'RESOLVER' ? { resolution: note, blockReason: null } : {}),
        ...(isHousekeepingClosed(next) ? { resolvedAt: new Date() } : {}),
      },
    });
    if (update.count !== 1) throw new RuleError('Otro administrador actualizó este aviso. Recarga la página.');
    await tx.housekeepingEvent.create({ data: { requestId: current.id, actorId: user.id, action: input.action, fromStatus: current.status, toStatus: next, note } });
    await tx.auditLog.create({ data: {
      entity: 'HousekeepingRequest', entityId: current.id, action: 'CAMBIO_ESTADO', userId: user.id, sessionId: user.sessionId,
      summary: `Piloto Housekeeping #${current.humanId}: ${input.action}`, before: { status: current.status, version: current.version }, after: { status: next, version: current.version + 1 }, reason: note, isDemo: true,
    } });
    return { id: current.id, humanId: current.humanId };
  });
}
