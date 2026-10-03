import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { assertReceptionOperationPermission } from './reception-operation-gate';

export const LOST_FOUND_STATUSES = ['EN_CUSTODIA', 'ENTREGADO', 'DISPUESTO'] as const;
export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];
type Tx = Prisma.TransactionClient;
export function canViewLostFound(user: CurrentUser) {
  return user.roleKey === 'ADMINISTRADOR_SISTEMA' || user.permissions.includes('custody.view') || user.permissions.includes('custody.manage');
}
export function canManageLostFound(user: CurrentUser) {
  return user.roleKey === 'ADMINISTRADOR_SISTEMA' || user.permissions.includes('custody.manage');
}
async function guard(user: CurrentUser, write = false) {
  if (write ? !canManageLostFound(user) : !canViewLostFound(user)) throw new ForbiddenError();
  if (write) await assertReceptionOperationPermission(user, 'custody.manage');
}
const custodianWhere: Prisma.UserWhereInput = {
  active: true, deletedAt: null, hiddenFromSelectors: false,
  role: { operational: true, OR: [{ key: 'ADMINISTRADOR_SISTEMA' }, { permissions: { some: { permission: { key: 'custody.manage' } } } }] },
};
async function eligibleCustodian(tx: Tx, id: string) {
  const person = await tx.user.findFirst({ where: { ...custodianWhere, id }, select: { id: true, name: true } });
  if (!person) throw new RuleError('Selecciona un usuario activo habilitado para gestionar custodia.');
  return person;
}
export async function listLostFound(user: CurrentUser, input: { status?: string; q?: string; page?: number; humanId?: number } = {}) {
  await guard(user);
  const q = input.q?.trim().slice(0, 240);
  const page = Math.max(1, Math.min(10000, Math.floor(input.page || 1)));
  const rows = await prisma.lostFoundItem.findMany({
    where: {
      isDemo: false,
      ...(input.humanId ? { humanId: input.humanId } : {}),
      ...(input.status && LOST_FOUND_STATUSES.includes(input.status as LostFoundStatus) ? { status: input.status } : {}),
      ...(q ? { OR: [
        ...(/^#?[1-9]\d*$/.test(q) && Number.isSafeInteger(Number(q.replace('#', ''))) ? [{ humanId: Number(q.replace('#', '')) }] : []),
        { item: { contains: q, mode: 'insensitive' as const } },
        { foundLocation: { contains: q, mode: 'insensitive' as const } },
        { custodyLocation: { contains: q, mode: 'insensitive' as const } },
      ] } : {}),
    },
    include: { registeredBy: { select: { name: true } }, custodian: { select: { name: true } }, closedBy: { select: { name: true } }, events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
    orderBy: [{ foundAt: 'desc' }, { id: 'desc' }], take: 50, skip: (page - 1) * 50,
  });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(row => row.events.map(event => event.actorId)))] } }, select: { id: true, name: true } });
  const names = new Map(actors.map(actor => [actor.id, actor.name]));
  return rows.map(row => ({ ...row, events: row.events.map(event => ({ ...event, actorName: names.get(event.actorId) ?? 'Usuario histórico' })) }));
}
export async function lostFoundTeam(user: CurrentUser) {
  await guard(user);
  if (!canManageLostFound(user)) return [];
  return prisma.user.findMany({ where: custodianWhere, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 300 });
}
type CreateInput = { requestKey: string; item: string; foundLocation: string; foundAt: Date; custodyLocation: string; custodianId?: string | null };
function normalizedInput(input: CreateInput) {
  if (!Number.isFinite(input.foundAt.getTime()) || input.foundAt.getTime() > Date.now() + 5 * 60000) throw new RuleError('Indica una fecha válida de hallazgo que no esté en el futuro.');
  const values = { item: input.item.trim(), foundLocation: input.foundLocation.trim(), foundAt: input.foundAt, custodyLocation: input.custodyLocation.trim(), custodianId: input.custodianId || null };
  if ([values.item, values.foundLocation, values.custodyLocation].some(value => !value || value.length > 240)) throw new RuleError('Indica el objeto, el lugar y la ubicación de custodia (máximo 240 caracteres cada uno).');
  return values;
}
async function repeatedCreate(tx: Tx, user: CurrentUser, requestKey: string, fingerprint: string) {
  const repeated = await tx.lostFoundItem.findUnique({ where: { requestKey } });
  if (!repeated) return null;
  if (repeated.registeredById !== user.id || repeated.isDemo) throw new ForbiddenError();
  const audit = await tx.auditLog.findFirst({ where: { entity: 'LostFoundItem', entityId: repeated.id, action: 'CREAR', userId: user.id }, orderBy: { createdAt: 'asc' }, select: { after: true } });
  const after = audit?.after;
  if (!after || typeof after !== 'object' || Array.isArray(after) || after.fingerprint !== fingerprint) throw new RuleError('La referencia de reintento pertenece a otros datos. No se ha creado otro objeto.');
  return repeated;
}
export async function createLostFound(user: CurrentUser, input: CreateInput) {
  await guard(user, true);
  const values = normalizedInput(input);
  const fingerprint = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  try {
    return await prisma.$transaction(async tx => {
      const repeated = await repeatedCreate(tx, user, input.requestKey, fingerprint);
      if (repeated) return repeated;
      const custodian = values.custodianId ? await eligibleCustodian(tx, values.custodianId) : null;
      const row = await tx.lostFoundItem.create({ data: {
        ...values, requestKey: input.requestKey, registeredById: user.id,
        events: { create: { actorId: user.id, action: 'REGISTRAR', note: `Custodia: ${values.custodyLocation} · Responsable: ${custodian?.name ?? 'Sin responsable individual'}` } },
      } });
      await tx.auditLog.create({ data: { entity: 'LostFoundItem', entityId: row.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Objeto olvidado #${row.humanId} registrado`, reason: values.foundLocation, after: { fingerprint } } });
      return row;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const repeated = await repeatedCreate(prisma, user, input.requestKey, fingerprint);
      if (repeated) return repeated;
    }
    throw error;
  }
}
export type LostFoundChange = { id: string; version: number; action: 'MOVER' | 'ENTREGAR' | 'DISPONER' | 'REABRIR'; custodyLocation?: string; custodianId?: string | null; note: string; evidenceNote?: string };
export async function changeLostFound(user: CurrentUser, input: LostFoundChange) {
  await guard(user, true);
  const note = input.note.trim();
  if (!note || note.length > 2000 || (input.evidenceNote?.length ?? 0) > 1000) throw new RuleError('Indica un motivo o resultado válido.');
  if (!['MOVER', 'ENTREGAR', 'DISPONER', 'REABRIR'].includes(input.action)) throw new RuleError('Acción de custodia no válida.');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "LostFoundItem" WHERE "id"=${input.id} FOR UPDATE`;
    const current = await tx.lostFoundItem.findUnique({ where: { id: input.id } });
    if (!current || current.isDemo) throw new NotFoundError();
    if (current.version !== input.version) throw new RuleError('El registro cambió. Actualiza antes de continuar.');
    const final = input.action === 'ENTREGAR' || input.action === 'DISPONER';
    if (input.action !== 'REABRIR' && current.status !== 'EN_CUSTODIA') throw new RuleError('El objeto tiene un cierre registrado. Usa Reabrir custodia e indica el motivo antes de modificarlo.');
    if (input.action === 'REABRIR' && current.status === 'EN_CUSTODIA') throw new RuleError('El objeto ya está en custodia.');
    if (final && !input.evidenceNote?.trim()) throw new RuleError('Registra la evidencia o referencia de la entrega/disposición. Evita datos personales innecesarios.');
    const location = input.custodyLocation === undefined ? current.custodyLocation : input.custodyLocation.trim();
    if (!location || location.length > 240) throw new RuleError('Indica una ubicación de custodia válida.');
    const custodianId = input.custodianId === undefined ? current.custodianId : input.custodianId || null;
    const custodian = custodianId && !final ? await eligibleCustodian(tx, custodianId) : null;
    const status = input.action === 'ENTREGAR' ? 'ENTREGADO' : input.action === 'DISPONER' ? 'DISPUESTO' : 'EN_CUSTODIA';
    const previous = { status: current.status, custodyLocation: current.custodyLocation, custodianId: current.custodianId, finalAction: current.finalAction, evidenceNote: current.evidenceNote, closedById: current.closedById, closedAt: current.closedAt?.toISOString() ?? null };
    const data: Prisma.LostFoundItemUncheckedUpdateManyInput = {
      status, version: { increment: 1 }, custodyLocation: location, custodianId,
      ...(final ? { finalAction: note, evidenceNote: input.evidenceNote!.trim(), closedById: user.id, closedAt: new Date() } : { finalAction: null, evidenceNote: null, closedById: null, closedAt: null }),
    };
    if (!(await tx.lostFoundItem.updateMany({ where: { id: current.id, version: input.version }, data })).count) throw new RuleError('Otra persona actualizó el registro. Recarga.');
    const details = final ? ` · Evidencia: ${input.evidenceNote!.trim()}` : ` · Custodia: ${current.custodyLocation} → ${location} · Responsable: ${custodian?.name ?? 'Sin responsable individual'}`;
    await tx.lostFoundEvent.create({ data: { itemId: current.id, actorId: user.id, action: input.action, note: note + details } });
    await tx.auditLog.create({ data: { entity: 'LostFoundItem', entityId: current.id, action: input.action === 'REABRIR' ? 'REABRIR' : 'CAMBIO_ESTADO', userId: user.id, sessionId: user.sessionId, summary: `Objeto olvidado #${current.humanId}: ${input.action}`, reason: note, before: previous, after: { status, custodyLocation: location, custodianId, ...(final ? { evidenceNote: input.evidenceNote!.trim(), finalAction: note, closedById: user.id } : {}) } } });
    return tx.lostFoundItem.findUniqueOrThrow({ where: { id: current.id } });
  });
}
export function newLostFoundKey() { return randomUUID(); }
