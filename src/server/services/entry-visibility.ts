import 'server-only';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { TASK_OPEN_STATUSES } from '@/domain/labels';
import { isReceptionDeskRole } from '@/lib/permissions';

export type EntryReader = Pick<CurrentUser, 'id' | 'permissions' | 'isSystemAdmin'> & Partial<Pick<CurrentUser, 'departmentId' | 'roleKey'>>;

export function canManageEntryVisibility(user: EntryReader, createdById: string) {
  return user.id === createdById || user.isSystemAdmin || user.roleKey === 'SUPERVISOR';
}

/** Visibility is presentation/access by area; assignment does not grant access. */
export function entryReadWhere(user: EntryReader): Prisma.OperationalEntryWhereInput {
  // Explicit identity predicate: Prisma prunes an empty relation filter inside OR.
  if (user.isSystemAdmin || user.roleKey === 'SUPERVISOR') return { id: { not: '' } };
  return { OR: [
    { createdById: user.id },
    { hiddenFromDepartments: { none: { OR: [
      { users: { some: { id: user.id } } },
      ...(user.departmentId ? [{ id: user.departmentId }] : []),
      ...(user.roleKey && isReceptionDeskRole(user.roleKey) ? [{ key: 'RECEPCION' }] : []),
    ] } } },
  ] };
}

/** Shared Reception handovers never inherit the supervisor/creator override. */
export const receptionHandoverEntryWhere: Prisma.OperationalEntryWhereInput = {
  includeInReceptionHandover: true,
  hiddenFromDepartments: { none: { key: 'RECEPCION' } },
};

export const closureValidationAlertWhere: Prisma.AlertWhereInput = {
  dedupeKey: { startsWith: 'shift-validation:' },
};

/** SQL counterpart for the existing global search view. Alias e is fixed. */
export function entryReadSql(user: EntryReader) {
  if (user.isSystemAdmin || user.roleKey === 'SUPERVISOR') return Prisma.sql`TRUE`;
  return Prisma.sql`(e."createdById" = ${user.id} OR NOT EXISTS (
    SELECT 1 FROM "_EntryHiddenAreas" h JOIN "Department" d ON d.id=h."A"
    WHERE h."B"=e.id AND (d.id=${user.departmentId ?? null}
      OR EXISTS (SELECT 1 FROM "User" u WHERE u.id=${user.id} AND u."departmentId"=d.id)
      OR (d.key='RECEPCION' AND ${!!user.roleKey && isReceptionDeskRole(user.roleKey)}))
  ))`;
}

/** Source lookups and visibility changes serialize on the same entry row. */
export async function assertEntryVisibleForWrite(tx: Prisma.TransactionClient, user: EntryReader, id: string, includeDeleted=false) {
  await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${id} FOR UPDATE`;
  if (!await tx.operationalEntry.count({where:{id,...(includeDeleted?{}:{deletedAt:null}),AND:[entryReadWhere(user)]}})) throw new NotFoundError('El registro de origen no está visible para tu área.');
}

/** Locks every native ancestor before authorizing a derived mutation. */
export async function lockEntrySourcesForRecord(tx: Prisma.TransactionClient, user: EntryReader, kind: 'task'|'alert'|'followup'|'operationalalarm', id: string) {
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT e.id FROM "OperationalEntry" e WHERE e.id IN (SELECT "entryId" FROM "native_entry_origin_ids"(${kind},${id})) ORDER BY e.id FOR UPDATE`;
  if(rows.length && await tx.operationalEntry.count({where:{id:{in:rows.map(r=>r.id)},AND:[entryReadWhere(user)]}})!==rows.length) throw new NotFoundError('El registro de origen no está visible para tu área.');
}

/** Assignment must remain usable under the proposed area visibility. */
export async function assertEntryOwnerVisibility(tx: Prisma.TransactionClient, input: {ownerId?:string|null;createdById:string;hiddenDepartmentIds:string[]}) {
  if(!input.ownerId)return;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${input.ownerId} FOR SHARE`;
  const owner=await tx.user.findFirst({where:{id:input.ownerId,active:true,deletedAt:null},select:{id:true,departmentId:true,role:{select:{key:true}}}});
  if(!owner)throw new RuleError('El responsable no está disponible.');
  if(owner.id===input.createdById || ['SUPERVISOR','ADMINISTRADOR_SISTEMA'].includes(owner.role.key))return;
  if(await tx.department.count({where:{id:{in:input.hiddenDepartmentIds},OR:[{id:owner.departmentId??''},{users:{some:{id:owner.id}}},...(isReceptionDeskRole(owner.role.key)?[{key:'RECEPCION'}]:[])]}}))throw new RuleError('El responsable no podrá ver la novedad. Reasigna o quita al responsable antes de ocultarla a su área.');
}

/** Native Housekeeping work cannot expose an entry hidden from its reader. */
export function housekeepingEntryReadWhere(user: EntryReader): Prisma.HousekeepingRequestWhereInput {
  return {AND:[{OR:[{sourceEntryId:null},{sourceEntry:entryReadWhere(user)}]},{OR:[{maintenanceEntryId:null},{maintenanceEntry:entryReadWhere(user)}]}]};
}
export async function assertEntryWorkDestination(tx: Prisma.TransactionClient, sourceId: string, departmentId: string, assignedToId?: string|null) {
  if(await tx.operationalEntry.count({where:{id:sourceId,hiddenFromDepartments:{some:{id:departmentId}}}}))throw new RuleError('La novedad está oculta al área de destino. Cambia su visibilidad antes de solicitar trabajo.');
  if(!assignedToId)return;
  const person=await tx.user.findFirst({where:{id:assignedToId,active:true,deletedAt:null},select:{id:true,departmentId:true,role:{select:{key:true}}}});
  if(!person)throw new RuleError('El responsable no está disponible.');
  await assertEntryVisibleForWrite(tx,{id:person.id,departmentId:person.departmentId,roleKey:person.role.key,isSystemAdmin:person.role.key==='ADMINISTRADOR_SISTEMA',permissions:[]},sourceId);
}

/** A visibility change must not strand already assigned, still-active work.
 * Called under the canonical entry lock, shared by derived assignment writes. */
export async function assertEntryLinkedWorkVisibility(tx: Prisma.TransactionClient, input: {id:string;createdById:string;hiddenDepartmentIds:string[]}) {
  if(!input.hiddenDepartmentIds.length)return;
  const [tasks,followUps,hk,attentions]=await Promise.all([
    tx.task.findMany({where:{deletedAt:null,status:{in:TASK_OPEN_STATUSES},sourceEntries:{some:{entryId:input.id}}},select:{departmentId:true,assigneeId:true,participants:{where:{removedAt:null},select:{userId:true}}}}),
    tx.followUp.findMany({where:{deletedAt:null,status:{in:['PENDIENTE','VENCIDO']},sourceEntries:{some:{entryId:input.id}}},select:{ownerId:true}}),
    tx.housekeepingRequest.findMany({where:{status:{notIn:['RESUELTO','CANCELADO']},OR:[{sourceEntryId:input.id},{maintenanceEntryId:input.id}]},select:{departmentId:true,assignedToId:true}}),
    tx.subjectAreaAttention.findMany({where:{entryId:input.id,OR:[{status:{in:['POR_REVISAR','ACLARACION']}},{task:{deletedAt:null,status:{in:TASK_OPEN_STATUSES}}},{housekeeping:{status:{notIn:['RESUELTO','CANCELADO']}}}]},select:{departmentId:true,urgentContactId:true}}),
  ]);
  if([...tasks,...hk,...attentions].some(row=>row.departmentId&&input.hiddenDepartmentIds.includes(row.departmentId))) {
    throw new RuleError('Hay trabajo pendiente vinculado para un área que ocultarías. Derívalo o ciérralo antes de cambiar la visibilidad.');
  }
  const owners=new Set([
    ...tasks.flatMap(task=>[task.assigneeId,...task.participants.map(p=>p.userId)]),
    ...followUps.map(f=>f.ownerId),...hk.map(h=>h.assignedToId),...attentions.map(a=>a.urgentContactId),
  ].filter((id):id is string=>!!id));
  for(const ownerId of owners) {
    try { await assertEntryOwnerVisibility(tx,{ownerId,createdById:input.createdById,hiddenDepartmentIds:input.hiddenDepartmentIds}); }
    catch(error) { if(error instanceof RuleError)throw new RuleError('Un responsable de trabajo pendiente vinculado perdería acceso. Reasigna o cierra ese trabajo antes de ocultar la novedad.');throw error; }
  }
}
