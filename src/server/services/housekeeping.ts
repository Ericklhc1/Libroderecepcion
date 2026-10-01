import 'server-only';
import { Prisma, type Priority } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canAccessHousekeeping, canManageHousekeeping, housekeepingActions, housekeepingNeedsNote, housekeepingTransition, isHousekeepingClosed, type HousekeepingAction, type HousekeepingStatus } from '@/domain/housekeeping';
import { notify } from '@/server/notifications';
import type { GlobalSearchResult } from './global-search';

export function assertHousekeepingAccess(user: Pick<CurrentUser, 'roleKey' | 'permissions'>, manage = false) {
  if (!(manage ? canManageHousekeeping(user) : canAccessHousekeeping(user))) throw new ForbiddenError(manage ? 'No tienes permiso para gestionar Housekeeping.' : 'Housekeeping no está habilitado para tu rol.');
}

/** Legacy administrative trials remain private; operational records follow permissions. */
export function housekeepingAuditVisibility(user: Pick<CurrentUser, 'roleKey' | 'permissions'>): Prisma.AuditLogWhereInput {
  if (user.roleKey === 'ADMINISTRADOR_SISTEMA') return {};
  return canAccessHousekeeping(user) ? { OR: [{ NOT: { entity: 'HousekeepingRequest' } }, { isDemo: false }] } : { NOT: { entity: 'HousekeepingRequest' } };
}

function housekeepingVisibility(user: CurrentUser): Prisma.HousekeepingRequestWhereInput {
  return user.roleKey === 'ADMINISTRADOR_SISTEMA' ? {} : { isDemo: false };
}

const include = {
  assignedTo: { select: { name: true } }, department: { select: { name: true } }, createdBy: { select: { name: true } },
  sourceEntry: { select: { id: true, humanId: true, title: true, description: true, updatedAt: true, deletedAt: true, status: true, room: { select: { number: true } } } },
  events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' as const }, take: 20 },
} satisfies Prisma.HousekeepingRequestInclude;

export function housekeepingSourceChanged(request: { acknowledgedAt: Date | null; sourceVersion: Date | null; sourceEntry: { updatedAt: Date } | null }): boolean {
  return !!request.acknowledgedAt && !!request.sourceEntry && request.sourceVersion?.getTime() !== request.sourceEntry.updatedAt.getTime();
}

export async function getHousekeepingBoard(user: CurrentUser, history = false, page = 1, focusId?: number, mine = false) {
  assertHousekeepingAccess(user);
  const terminal = ['RESUELTO', 'CANCELADO'];
  const currentPage = Number.isSafeInteger(page) ? Math.min(10000, Math.max(1, page)) : 1;
  const selectedStatus = history ? { in: terminal } : { notIn: terminal };
  const visibility = housekeepingVisibility(user);
  const where = { ...visibility, ...(mine ? { assignedToId: user.id } : {}), status: selectedStatus, ...(Number.isSafeInteger(focusId) && focusId! > 0 ? { humanId: focusId } : {}) };
  const [requests, total, active, pending, blocked, overdue] = await Promise.all([
    prisma.housekeepingRequest.findMany({
      where, include,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }], take: 25, skip: (currentPage - 1) * 25,
    }),
    prisma.housekeepingRequest.count({ where }),
    prisma.housekeepingRequest.count({ where: { ...visibility, status: { notIn: terminal } } }),
    prisma.housekeepingRequest.count({ where: { ...visibility, acknowledgedAt: null, status: { notIn: terminal } } }),
    prisma.housekeepingRequest.count({ where: { ...visibility, status: 'BLOQUEADO' } }),
    prisma.housekeepingRequest.count({ where: { ...visibility, status: { notIn: terminal }, dueAt: { lt: new Date() } } }),
  ]);
  return { requests, total, page: currentPage, active, pending, blocked, overdue };
}

export async function searchHousekeepingRecords(user: CurrentUser, query: string, limit = 60): Promise<GlobalSearchResult[]> {
  assertHousekeepingAccess(user);
  const text = query.trim().replace(/^#/, '').slice(0, 200);
  if (!text) return [];
  const terms = text.toLocaleLowerCase('es-CL').split(/\s+/).filter(Boolean).slice(0, 8);
  const haystack = Prisma.sql`lower(concat_ws(' ', h."humanId"::text, 'Housekeeping', coalesce(e."title", h."title"), coalesce(e."description", h."description"), h."location", h."status"))`;
  return prisma.$queryRaw<GlobalSearchResult[]>(Prisma.sql`
    SELECT h."humanId", 'HousekeepingRequest'::text AS "entityType", h."id" AS "entityId",
      'Housekeeping'::text AS "kind", coalesce(e."title", h."title") AS "title",
      coalesce(e."description", h."description") AS "summary", h."status", h."location" AS "roomNumber",
      NULL::text AS "guestName", NULL::text AS "responsible", CASE WHEN h."isDemo" THEN 'Prueba administrativa' ELSE 'Operación' END AS "category", h."createdAt",
      '/admin/housekeeping?vista=' || CASE WHEN h."status" IN ('RESUELTO', 'CANCELADO') THEN 'historial' ELSE 'pendientes' END || '&aviso=' || h."humanId"::text || '#aviso-' || h."humanId"::text AS "href"
    FROM "HousekeepingRequest" h LEFT JOIN "OperationalEntry" e ON e."id" = h."sourceEntryId"
    WHERE (h."isDemo" = false OR ${user.roleKey === 'ADMINISTRADOR_SISTEMA'}) AND ${Prisma.join(terms.map((term) => Prisma.sql`${haystack} LIKE ${`%${term}%`}`), ' AND ')}
    ORDER BY CASE WHEN h."humanId"::text = ${text} THEN 0 ELSE 1 END, h."createdAt" DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `);
}

export async function getHousekeepingSources(user: CurrentUser, query = '') {
  assertHousekeepingAccess(user, true);
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

type CreateInput = { requestKey: string; title?: string; description?: string; sourceEntryId?: string; location?: string; priority: Priority; dueAt?: Date | null; departmentId?: string; assignedToId?: string };

export async function createHousekeepingRequest(user: CurrentUser, input: CreateInput) {
  assertHousekeepingAccess(user, true);
  if (!input.sourceEntryId && (!input.title?.trim() || !input.description?.trim())) throw new RuleError('Indica qué necesita Housekeeping y el contexto.');
  const existing = await prisma.housekeepingRequest.findUnique({ where: { requestKey: input.requestKey } });
  if (existing) { if (existing.isDemo && user.roleKey !== 'ADMINISTRADOR_SISTEMA') throw new ForbiddenError(); return existing; }
  try {
    return await prisma.$transaction(async (tx) => {
      const departmentId = input.departmentId || (await tx.department.findUnique({ where: { key: 'HOUSEKEEPING' }, select: { id: true } }))?.id;
      await validateDestination(tx, departmentId, input.assignedToId);
      const source = input.sourceEntryId ? await tx.operationalEntry.findFirst({ where: { id: input.sourceEntryId, deletedAt: null, status: { notIn: ['CERRADO', 'RESUELTO'] } } }) : null;
      if (input.sourceEntryId && !source) throw new NotFoundError('La novedad ya no está disponible para vincular.');
      const request = await tx.housekeepingRequest.create({ data: {
        requestKey: input.requestKey, sourceEntryId: source?.id, isDemo: false,
        createdById: user.id, departmentId, assignedToId: input.assignedToId || null,
        // Linked notices read their content from the canonical entry. No copy.
        title: source ? null : input.title!.trim(), description: source ? null : input.description!.trim(),
        location: input.location?.trim() || null, priority: source?.priority ?? input.priority, dueAt: input.dueAt ?? source?.dueAt,
        events: { create: { actorId: user.id, action: 'CREAR', toStatus: 'PENDIENTE', note: 'Aviso operativo creado. Recepción y resultado se registran por separado.' } },
      } });
      await tx.auditLog.create({ data: { entity: 'HousekeepingRequest', entityId: request.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Housekeeping: aviso #${request.humanId}`, isDemo: false } });
      await notifyHousekeeping(tx, request, user.id, 'Nuevo aviso');
      return request;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const repeated = await prisma.housekeepingRequest.findUnique({ where: { requestKey: input.requestKey } });
      if (repeated) { if (repeated.isDemo && user.roleKey !== 'ADMINISTRADOR_SISTEMA') throw new ForbiddenError(); return repeated; }
      throw new RuleError('Esta novedad ya está vinculada a Housekeeping. Abre el aviso existente.');
    }
    throw error;
  }
}

type ChangeInput = { id: string; version: number; action: HousekeepingAction; note?: string; dueAt?: Date | null; departmentId?: string; assignedToId?: string };

export async function changeHousekeepingRequest(user: CurrentUser, input: ChangeInput) {
  assertHousekeepingAccess(user, true);
  const note = input.note?.trim() || null;
  if (housekeepingNeedsNote(input.action) && !note) throw new RuleError('Registra el motivo o resultado para conservar la trazabilidad.');
  return prisma.$transaction(async (tx) => {
    const current = await tx.housekeepingRequest.findUnique({ where: { id: input.id }, include: { sourceEntry: { select: { updatedAt: true, deletedAt: true } } } });
    if (!current || (current.isDemo && user.roleKey !== 'ADMINISTRADOR_SISTEMA')) throw new NotFoundError();
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
    const transfer = input.action === 'DERIVAR';
    if (transfer && !input.departmentId) throw new RuleError('Selecciona el área que recibirá el aviso.');
    if (transfer) await validateDestination(tx, input.departmentId, input.assignedToId);
    const confirm = input.action === 'CONFIRMAR' || input.action === 'TOMAR';
    const reopen = input.action === 'REABRIR';
    const update = await tx.housekeepingRequest.updateMany({
      where: { id: current.id, version: input.version }, data: {
        status: next, version: { increment: 1 },
        ...(confirm || input.action === 'INICIAR' || input.action === 'RETOMAR' ? { assignedToId: user.id } : {}),
        ...(transfer ? { departmentId: input.departmentId, assignedToId: input.assignedToId || null, acknowledgedAt: null, sourceVersion: null, blockReason: null } : {}),
        ...(confirm ? { acknowledgedAt: new Date(), sourceVersion: current.sourceEntry?.updatedAt ?? null, ...(input.dueAt ? { dueAt: input.dueAt } : {}) } : {}),
        ...(reopen ? { acknowledgedAt: null, sourceVersion: null, resolvedAt: null, resolution: null, blockReason: null } : {}),
        ...(['ACLARAR', 'BLOQUEAR'].includes(input.action) ? { blockReason: note } : {}),
        ...(['RETOMAR', 'INICIAR'].includes(input.action) ? { blockReason: null } : {}),
        ...(input.action === 'RESOLVER' ? { resolution: note, blockReason: null } : {}),
        ...(isHousekeepingClosed(next) ? { resolvedAt: new Date() } : {}),
      },
    });
    if (update.count !== 1) throw new RuleError('Otra persona actualizó este aviso. Recarga la página.');
    await tx.housekeepingEvent.create({ data: { requestId: current.id, actorId: user.id, action: input.action, fromStatus: current.status, toStatus: next, note: transfer ? `${note} · Área: ${(await tx.department.findUniqueOrThrow({ where: { id: input.departmentId! } })).name} · Responsable: ${input.assignedToId ? (await tx.user.findUniqueOrThrow({ where: { id: input.assignedToId } })).name : 'Por tomar'}` : note } });
    await tx.auditLog.create({ data: {
      entity: 'HousekeepingRequest', entityId: current.id, action: 'CAMBIO_ESTADO', userId: user.id, sessionId: user.sessionId,
      summary: `Housekeeping #${current.humanId}: ${input.action}`, before: { status: current.status, version: current.version }, after: { status: next, version: current.version + 1 }, reason: note, isDemo: current.isDemo,
    } });
    const updated = await tx.housekeepingRequest.findUniqueOrThrow({ where: { id: current.id } });
    await notifyHousekeeping(tx, updated, user.id, input.action === 'RESOLVER' ? 'Resultado registrado' : input.action === 'DERIVAR' ? 'Aviso derivado / relevo' : 'Aviso actualizado');
    return { id: current.id, humanId: current.humanId };
  });
}

const eligibleManager = {
  active: true, deletedAt: null, hiddenFromSelectors: false,
  role: { OR: [{ key: 'ADMINISTRADOR_SISTEMA' }, { permissions: { some: { permission: { key: 'housekeeping.manage' } } } }] },
} satisfies Prisma.UserWhereInput;
async function validateDestination(tx: Prisma.TransactionClient, departmentId?: string, assignedToId?: string) {
  if (!departmentId || !await tx.department.findFirst({ where: { id: departmentId, active: true } })) throw new RuleError('El área seleccionada no está disponible.');
  if (assignedToId && !await tx.user.findFirst({ where: { ...eligibleManager, id: assignedToId, OR: [{ departmentId }, { scheduleCollaborator: { active: true, memberships: { some: { departmentId, active: true } } } }] } })) throw new RuleError('El responsable debe pertenecer al área y tener permiso para gestionar avisos.');
}
export async function getHousekeepingDestinations(user: CurrentUser) {
  assertHousekeepingAccess(user, true);
  const [departments, users] = await Promise.all([
    prisma.department.findMany({ where: { active: true }, select: { id: true, name: true, key: true }, orderBy: { order: 'asc' } }),
    prisma.user.findMany({ where: eligibleManager, select: { id: true, name: true, departmentId: true, scheduleCollaborator: { select: { active: true, memberships: { where: { active: true }, select: { departmentId: true } } } } }, orderBy: { name: 'asc' } }),
  ]);
  return { departments, users: users.map(u => ({ id: u.id, name: u.name, departmentIds: [...new Set([u.departmentId, ...(u.scheduleCollaborator?.active ? u.scheduleCollaborator.memberships.map(m => m.departmentId) : [])].filter((id): id is string => !!id))] })) };
}
async function notifyHousekeeping(tx: Prisma.TransactionClient, request: { id: string; humanId: number; departmentId: string | null; assignedToId: string | null; createdById: string | null; isDemo: boolean }, actorId: string, title: string, escalation = false) {
  if (request.isDemo) return;
  const users = await tx.user.findMany({ where: {
    active: true, deletedAt: null, hiddenFromSelectors: false, id: { not: actorId },
    role: { OR: [{ key: 'ADMINISTRADOR_SISTEMA' }, { permissions: { some: { permission: { key: { in: ['housekeeping.manage', 'housekeeping.view'] } } } } }] },
    OR: [
      ...(request.createdById ? [{ id: request.createdById }] : []),
      ...(request.assignedToId ? [{ id: request.assignedToId }] : []),
      ...(!request.assignedToId && request.departmentId ? [{ OR: [{ departmentId: request.departmentId }, { scheduleCollaborator: { active: true, memberships: { some: { departmentId: request.departmentId, active: true } } } }], role: eligibleManager.role }] : []),
      ...(escalation ? [{ role: { key: { in: ['ADMINISTRADOR_SISTEMA', 'SUPERVISOR_RECEPCION'] } } }] : []),
    ],
  }, select: { id: true } });
  await notify(users.map(u => ({ userId: u.id, type: 'ACTUALIZACION_OPERATIVA' as const, title: `Housekeeping #${request.humanId}: ${title}`, link: `/admin/housekeeping?aviso=${request.humanId}`, entity: 'HousekeepingRequest', entityId: request.id })), tx);
}
/** Cron durable: one escalation per revision; no fake receipt or automatic closure. */
export async function escalateHousekeepingRequests(now = new Date()) {
  const candidates = await prisma.housekeepingRequest.findMany({ where: { isDemo: false, status: { notIn: ['RESUELTO', 'CANCELADO'] }, dueAt: { lt: now }, OR: [{ escalatedVersion: null }, { NOT: { escalatedVersion: { equals: prisma.housekeepingRequest.fields.version } } }] }, orderBy: { dueAt: 'asc' }, take: 100 });
  let escalated = 0;
  for (const request of candidates) {
    if (request.escalatedVersion === request.version) continue;
    await prisma.$transaction(async tx => {
      const claimed = await tx.housekeepingRequest.updateMany({ where: { id: request.id, version: request.version, OR: [{ escalatedVersion: null }, { escalatedVersion: { not: request.version } }], status: { notIn: ['RESUELTO', 'CANCELADO'] } }, data: { escalatedVersion: request.version } });
      if (!claimed.count) return;
      await notifyHousekeeping(tx, request, '', 'Plazo vencido: requiere seguimiento', true);
      escalated++;
    });
  }
  return { escalated };
}
