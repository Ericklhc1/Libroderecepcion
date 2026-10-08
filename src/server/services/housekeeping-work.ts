import { readEntries } from '@/server/services/entry-visibility';
import { entryReadWhere, housekeepingEntryReadWhere, assertHousekeepingWorkDestination, assertEntryWorkDestination, assertEntryVisibleForWrite } from './entry-visibility';
import {subjectDistributionEnabled} from './subject-distribution-gate';
import {sourceStakeholders,notifyNativeWork} from './work-notifications';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { maintenanceAllowsContinuation } from '@/domain/housekeeping-continuity';
import { Prisma, type Priority, type Severity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ROLE_KEYS, type PermissionKey } from '@/lib/permissions';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { hkActionPermission, hkHas, hkAllowedActions, hkNextStatus, hkInspectionRequired, HK_NOTE_REQUIRED, type HkWorkAction, type HkWorkKind } from '@/domain/housekeeping-work';
import { buildHkRoomBoard } from '@/domain/housekeeping-room-board';
import { hotelDateKey, hotelWallDateTime, addCalendarDateDays, calendarDateKey } from '@/domain/time';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { ensureIncidentWorkflow } from './incident-workflow';
import { notify } from '@/server/notifications';

const ADMIN = ROLE_KEYS.SYSTEM_ADMIN;
const terminal = ['RESUELTO', 'CANCELADO'];
const nextDate = (date:string,days:number) => calendarDateKey(addCalendarDateDays(new Date(`${date}T00:00:00Z`),days));
const membership = (departmentId: string): Prisma.UserWhereInput => ({ active: true, deletedAt: null, hiddenFromSelectors: false, OR: [{ departmentId }, { scheduleCollaborator: { active: true, memberships: { some: { departmentId, active: true } } } }] });
const workerPermissions = ['housekeeping.work', 'housekeeping.manage'];
const worker = { role: { OR: [{ key: ADMIN }, { permissions: { some: { permission: { key: { in: workerPermissions } } } } }] } } satisfies Prisma.UserWhereInput;
const relations = {
  assignedTo: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, department: { select: { id: true, name: true } },
  room: { select: { id: true, number: true, floor: true } }, zone: { select: { id: true, name: true } }, inspectedBy: { select: { name: true } },
  maintenanceEntry: { select: { id: true, humanId: true, status: true, title: true, resolution: true, updatedAt: true, deletedAt: true } },
  sourceEntry: { select: { id: true, humanId: true, title: true, description: true, updatedAt: true, deletedAt: true, room: { select: { number: true } } } },
  events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' as const }, take: 12 },
} satisfies Prisma.HousekeepingRequestInclude;

type Tx = Prisma.TransactionClient;
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value) throw new RuleError('Selecciona una fecha válida.');
  return value;
}
function hasAccess(user: CurrentUser) { if (!canAccessHousekeeping(user)) throw new ForbiddenError('Housekeeping no está habilitado para tu rol.'); }
export async function hkAreaIds(user: CurrentUser, tx: Tx = prisma): Promise<string[]> {
  hasAccess(user);
  if (user.roleKey === ADMIN) return (await tx.department.findMany({ where: { active: true }, select: { id: true } })).map(d => d.id);
  const person = await tx.user.findUnique({ where: { id: user.id }, select: { departmentId: true, scheduleCollaborator: { select: { active: true, memberships: { where: { active: true, department: { active: true } }, select: { departmentId: true } } } } } });
  return [...new Set([person?.departmentId, ...(person?.scheduleCollaborator?.active ? person.scheduleCollaborator.memberships.map(m => m.departmentId) : [])].filter((id): id is string => !!id))];
}
export async function hkCapability(user: CurrentUser, departmentId: string, permission: PermissionKey, tx: Tx = prisma, at = new Date()) {
  hasAccess(user);
  if (!(await tx.department.findFirst({ where: { id: departmentId, active: true }, select: { id: true } }))) throw new RuleError('El área ya no está disponible.');
  if (user.roleKey === ADMIN) return true;
  if (!(await hkAreaIds(user, tx)).includes(departmentId)) return false;
  if (hkHas(user, permission)) return true;
  if (['housekeeping.assign', 'housekeeping.inspect'].includes(permission)) {
    const now = at;
    return !!await tx.housekeepingDelegation.findFirst({ where: { userId: user.id, departmentId, permission, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now }, grantedBy: { active: true, deletedAt: null, role: { OR: [{ key: ADMIN }, { permissions: { some: { permission: { key: 'housekeeping.plan' } } } }] } } } });
  }
  return false;
}
async function requireCapability(user: CurrentUser, departmentId: string, permission: PermissionKey, tx: Tx = prisma) { if (!await hkCapability(user, departmentId, permission, tx)) throw new ForbiddenError('Esta función no está habilitada para tu cargo y área.'); }
export async function hkWorkVisibility(user: CurrentUser, tx: Tx = prisma): Promise<Prisma.HousekeepingRequestWhereInput> {
  hasAccess(user);
  if (user.roleKey === ADMIN) return { deletedAt: null, AND:[housekeepingEntryReadWhere(user)] };
  if (user.permissions.includes('housekeeping.view.all')) return { deletedAt: null, isDemo: false, AND:[housekeepingEntryReadWhere(user)] };
  const areas = await hkAreaIds(user, tx);
  const full = hkHas(user, 'housekeeping.view') || hkHas(user, 'housekeeping.assign') || hkHas(user, 'housekeeping.inspect') || hkHas(user, 'housekeeping.plan');
  const delegated = await tx.housekeepingDelegation.findMany({ where: { userId: user.id, departmentId: { in: areas }, revokedAt: null, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, grantedBy: { active: true, deletedAt: null, role: { OR: [{ key: ADMIN }, { permissions: { some: { permission: { key: 'housekeeping.plan' } } } }] } } }, select: { departmentId: true } });
  return { deletedAt: null, isDemo: false, AND:[housekeepingEntryReadWhere(user)], OR: [{ createdById: user.id }, { assignedToId: user.id, departmentId: { in: areas } }, { departmentId: { in: full ? areas : delegated.map(d => d.departmentId) } }] };
}
async function record(tx: Tx, user: CurrentUser, id: string, humanId: number | null, action: string, note: string) {
  await tx.auditLog.create({ data: { entity: 'HousekeepingWork', entityId: id, userId: user.id, sessionId: user.sessionId, action: 'CAMBIO_ESTADO', summary: humanId ? `Housekeeping #${humanId}: ${action}` : `Housekeeping: ${action}`, reason: note } });
}
async function coordinatingTeam(tx: Tx, departmentId: string, permissions: string[]) {
  const now = new Date();
  const delegated = await tx.housekeepingDelegation.findMany({where:{departmentId,permission:{in:permissions},startsAt:{lte:now},endsAt:{gt:now},revokedAt:null,grantedBy:{active:true,deletedAt:null,role:{OR:[{key:ADMIN},{permissions:{some:{permission:{key:'housekeeping.plan'}}}}]}}},select:{userId:true}});
  return tx.user.findMany({where:{...membership(departmentId),AND:[{OR:[{role:{key:ADMIN}},{role:{permissions:{some:{permission:{key:{in:permissions}}}}}},{id:{in:delegated.map(d=>d.userId)}}]}]},select:{id:true}});
}
function sourceScope(user: CurrentUser, departmentId: string, canAssign: boolean): Prisma.OperationalEntryWhereInput {
  const scope = user.roleKey === ADMIN || user.permissions.includes('entry.create') ? { id: { not: '' } } : canAssign ? { OR: [{ departmentId }, { createdById: user.id }, {areaAttentions:{some:{departmentId}}}] } : { createdById: user.id };
  return { AND:[entryReadWhere(user), scope] };
}
export async function notifyHkWork(tx: Tx, request: { id: string; humanId: number; departmentId: string | null; assignedToId: string | null; createdById: string | null; requiresInspection: boolean; status: string }, actorId: string, message: string, previousAssigneeId?:string|null,internalOnly=false) {
  if (!request.departmentId) return;
  internalOnly=internalOnly||!!await tx.subjectAreaAttention.count({where:{housekeepingId:request.id}});
  const permissions = request.status === 'POR_REVISAR' ? ['housekeeping.inspect','housekeeping.plan','housekeeping.manage'] : ['housekeeping.assign','housekeeping.plan','housekeeping.manage'];
  const team = await coordinatingTeam(tx, request.departmentId, permissions);
  const ids = [...new Set([previousAssigneeId,request.assignedToId, request.createdById, ...team.map(u => u.id)].filter((id): id is string => !!id && id !== actorId))];
  const candidates = await tx.user.findMany({ where: { id: { in: ids }, active: true, deletedAt: null }, select: { id: true, departmentId:true, role: {select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}} } });
  const active:Array<{id:string}>=[];
  for (const candidate of candidates) {
    const reader={id:candidate.id,departmentId:candidate.departmentId,roleKey:candidate.role.key,isSystemAdmin:candidate.role.key===ADMIN,permissions:candidate.role.permissions.map(p=>p.permission.key as PermissionKey)} as CurrentUser;
    if (canAccessHousekeeping(reader) && await tx.housekeepingRequest.count({where:{id:request.id,AND:[await hkWorkVisibility(reader,tx)]}})) active.push({id:candidate.id});
  }
  await notify(active.map(u => ({ internalOnly, userId: u.id, type: 'ACTUALIZACION_OPERATIVA' as const, title: `Housekeeping #${request.humanId}: ${message}`, link: `/housekeeping?area=${request.departmentId}&aviso=${request.humanId}`, entity: 'HousekeepingRequest', entityId: request.id })), tx);
  if(previousAssigneeId&&previousAssigneeId!==request.assignedToId&&previousAssigneeId!==actorId&&!active.some(u=>u.id===previousAssigneeId)&&await tx.user.count({where:{id:previousAssigneeId,...membership(request.departmentId),...worker}})){
    // Outgoing staff lose access to the work. Notify only their own ended responsibility.
    await notify({internalOnly:true,userId:previousAssigneeId,type:'RESPONSABLE_CAMBIADO',title:`Tu asignación Housekeeping #${request.humanId} terminó por relevo`,body:'No continúes ejecutando esta asignación. Consulta a la jefatura si necesitas aclaración.',link:'/housekeeping',entity:'HousekeepingRequest',entityId:request.id},tx);
  }
}
export type HkCreateInput = { requestKey: string; title: string; description: string; workKind: HkWorkKind; workDate: string; departmentId: string; roomId?: string; zoneId?: string; location?: string; priority: Priority; dueAt?: Date | null; effortMinutes: number; requiresInspection?: boolean; assignedToId?: string; sourceEntryId?: string };
export async function validateWorker(tx: Tx, departmentId: string, id: string, workDate?: string) {
  if (!await tx.user.findFirst({ where: { id, ...membership(departmentId), ...worker }, select: { id: true } })) throw new RuleError('Selecciona un usuario activo del área con permiso para ejecutar trabajo.');
  if (workDate && (await tx.housekeepingDayMember.findUnique({ where: { departmentId_workDate_userId: { departmentId, workDate, userId: id } } }))?.available === false) throw new RuleError('Esta persona figura como no disponible para ese día.');
}
export async function createHkWork(user: CurrentUser, input: HkCreateInput, client?: Prisma.TransactionClient, internalOnly=false) {
  const db = client ?? prisma;
  hasAccess(user); validDate(input.workDate);
  if (!input.title.trim() || !input.description.trim()) throw new RuleError('Indica qué se necesita y la instrucción.');
  if (!Number.isInteger(input.effortMinutes) || input.effortMinutes < 1 || input.effortMinutes > 480) throw new RuleError('La duración estimada debe estar entre 1 y 480 minutos.');
  const canAssign = await hkCapability(user, input.departmentId, 'housekeeping.assign',db);
  if (!canAssign && !hkHas(user, 'housekeeping.request')) throw new ForbiddenError();
  const area = await db.department.findFirst({ where: { id: input.departmentId, active: true }, select: { key: true } });
  if (!area || (!canAssign && !['HOUSEKEEPING', 'AREAS_PUBLICAS'].includes(area.key))) throw new ForbiddenError('Las solicitudes deben dirigirse a Housekeeping o Áreas públicas.');
  if (input.assignedToId && !canAssign) throw new ForbiddenError('La asignación corresponde al supervisor del área.');
  const repeated = await db.housekeepingRequest.findUnique({ where: { requestKey: input.requestKey } });
  if (repeated) { if (repeated.createdById !== user.id) throw new ForbiddenError(); return repeated; }
  const perform = async (tx: Prisma.TransactionClient) => {
    if(input.sourceEntryId) await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.sourceEntryId} FOR UPDATE`;
    const retry=await tx.housekeepingRequest.findUnique({where:{requestKey:input.requestKey}});
    if(retry){if(retry.createdById!==user.id)throw new ForbiddenError();return retry;}
    if(input.sourceEntryId&&!subjectDistributionEnabled()&&await tx.housekeepingRequest.count({where:{sourceEntryId:input.sourceEntryId}}))throw new RuleError('Esta novedad ya tiene atención especializada. La distribución simultánea todavía no está habilitada.');
    const room = input.roomId ? await tx.room.findFirst({ where: { id: input.roomId, active: true }, select: { id: true, number: true } }) : null;
    const zone = input.zoneId ? await tx.keyArea.findFirst({ where: { id: input.zoneId, active: true }, select: { id: true, name: true } }) : null;
    if ((input.roomId && !room) || (input.zoneId && !zone) || (room && zone)) throw new RuleError('Selecciona una habitación o zona válida.');
    if (input.workKind === 'LIMPIEZA' && !room) throw new RuleError('Selecciona la habitación que requiere limpieza.');
    if (!room && !zone && !input.location?.trim()) throw new RuleError('Indica la habitación o zona donde se hará el trabajo.');
    if (input.assignedToId) await validateWorker(tx, input.departmentId, input.assignedToId, input.workDate);
    const source = input.sourceEntryId ? await readEntries(tx, user).findFirst({ where: { id: input.sourceEntryId, deletedAt: null, status: { notIn: ['CERRADO', 'RESUELTO'] }, ...sourceScope(user, input.departmentId, canAssign) }, select: { id: true, roomId: true } }) : null;
    if(source?.roomId&&room?.id!==source.roomId)throw new RuleError('La habitación debe coincidir con la novedad de origen.');
    if (input.sourceEntryId && !source) throw new RuleError('La novedad ya no está disponible para vincular.');
    if(source)await assertEntryWorkDestination(tx,source.id,input.departmentId,input.assignedToId);
    const request = await tx.housekeepingRequest.create({ data: { ...input, roomId: room?.id, zoneId: zone?.id, location: room?.number ?? zone?.name ?? input.location!.trim(), title: source ? null : input.title.trim(), description: source ? null : input.description.trim(), assignedToId: input.assignedToId || null, workAssignedAt: input.assignedToId ? new Date() : null, sourceEntryId: source?.id, workflowVersion: 1, requiresInspection: hkInspectionRequired(input.workKind, input.requiresInspection), createdById: user.id, events: { create: { actorId: user.id, action: 'CREAR', toStatus: 'PENDIENTE', note: 'Trabajo creado. La planificación no acredita asistencia ni modifica el PMS.' } } } });
    await record(tx, user, request.id, request.humanId, 'CREAR', 'Trabajo del día'); await notifyHkWork(tx, request, user.id, 'Nuevo trabajo',undefined,internalOnly); return request;
  };
  try { return client ? await perform(client) : await prisma.$transaction(perform); } catch (error) {
    if (!client && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const request = await db.housekeepingRequest.findUnique({ where: { requestKey: input.requestKey } });
      if (request?.createdById === user.id) return request;
      throw new RuleError('El registro de origen ya tiene una atención vinculada.');
    } throw error;
  }
}
export async function changeHkWork(user: CurrentUser, input: { id: string; version: number; action: HkWorkAction; note?: string; assignedToId?: string; dueAt?: Date | null; severity?: Severity }, transaction?: Tx, internalOnly=false) {
  hasAccess(user); const note = input.note?.trim() || '';
  if (HK_NOTE_REQUIRED.includes(input.action) && !note) throw new RuleError('Indica el motivo, la instrucción o el resultado.');
  const perform=async (tx:Tx) => {
    const current = await tx.housekeepingRequest.findFirst({ where: { id: input.id, workflowVersion: 1, AND: [await hkWorkVisibility(user, tx)] }, include: { sourceEntry: { select: { updatedAt: true, deletedAt: true, status:true } } } });
    if (!current || !current.departmentId) throw new NotFoundError();
    if (current.version !== input.version) throw new RuleError('El trabajo cambió. Actualiza antes de continuar.');
    const permission = hkActionPermission(input.action, current.requiresInspection); await requireCapability(user, current.departmentId, permission, tx);
    if (permission === 'housekeeping.work' && current.assignedToId !== user.id) throw new ForbiddenError('Sólo puedes ejecutar tus trabajos asignados.');
    if ((permission === 'housekeeping.inspect') && current.assignedToId === user.id) throw new RuleError('La inspección debe realizarla otra persona.');
    if(input.action==='REABRIR'&&current.assignedToId)await validateWorker(tx,current.departmentId,current.assignedToId,current.workDate??undefined);
    if(['REABRIR','ASIGNAR'].includes(input.action))await assertHousekeepingWorkDestination(tx,user,input.action==='ASIGNAR'?{...current,assignedToId:input.assignedToId??null}:current);
    if (current.sourceEntryId) {
      await assertEntryVisibleForWrite(tx,user,current.sourceEntryId,true);
      current.sourceEntry = await readEntries(tx, user).findUnique({ where: { id: current.sourceEntryId }, select: { updatedAt: true, deletedAt: true,status:true } });
    }
    if(input.action==='REABRIR'&&current.sourceEntry&&['RESUELTO','CERRADO'].includes(current.sourceEntry.status))throw new RuleError('Reabre el asunto antes de reactivar su atención especializada.');
    const changed = !!current.acknowledgedAt && !!current.sourceEntry && current.sourceVersion?.getTime() !== current.sourceEntry.updatedAt.getTime();
    if (!hkAllowedActions(current.status, !!current.assignedToId, changed, current.requiresInspection).includes(input.action)) throw new RuleError(changed ? 'La instrucción cambió: el supervisor debe revisarla antes de continuar.' : 'Esta acción no corresponde al estado del trabajo.');
    if (current.sourceEntry?.deletedAt && input.action !== 'CANCELAR') throw new RuleError('El origen fue archivado. Revisa el caso y cancela con motivo.');
    if (input.action === 'ASIGNAR') { if (!input.assignedToId) throw new RuleError('Selecciona un responsable.'); await validateWorker(tx, current.departmentId, input.assignedToId, current.workDate ?? undefined); }
    if (current.maintenanceEntryId && ['COMENZAR','RETOMAR','TERMINAR','RESOLVER','APROBAR'].includes(input.action)) {
      // Lock the dependency before the optimistic request update, as the native result publisher does.
      await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${current.maintenanceEntryId} FOR SHARE`;
      const maintenance=await readEntries(tx, user).findUnique({where:{id:current.maintenanceEntryId},select:{status:true,resolution:true,deletedAt:true}});
      if (!maintenance || !maintenanceAllowsContinuation(maintenance)) throw new RuleError('Mantenimiento debe informar un resultado vigente antes de continuar. El impedimento y la inspección se conservan.');
    }
    let maintenanceEntryId = current.maintenanceEntryId;
    if (input.action === 'MANTENIMIENTO') {
      if (!input.severity) throw new RuleError('Indica la gravedad de la incidencia.');
      if (maintenanceEntryId) throw new RuleError('Ya existe una incidencia vinculada a este trabajo.');
      const area = await tx.department.findUnique({ where: { key: 'MANTENIMIENTO', active: true } });
      if (!area) throw new RuleError('Mantenimiento no está disponible.');
      const entry = await tx.operationalEntry.create({ data: { type: 'INCIDENCIA', title: `Housekeeping #${current.humanId}: ${current.location ?? 'Revisión'}`, description: note, severity: input.severity, departmentId: area.id, roomId: current.roomId, priority: current.priority, createdById: user.id } });
      await ensureIncidentWorkflow(entry.id, tx, { leaveUnassigned: true });
      maintenanceEntryId = entry.id;
      await tx.auditLog.create({ data: { entity: 'OperationalEntry', entityId: entry.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Incidencia #${entry.humanId} desde Housekeeping #${current.humanId}` } });
      const technicians = await tx.user.findMany({ where: { ...membership(area.id), role: { permissions: { some: { permission: { key: { in: ['incident.manage','incident.create','entry.create'] } } } } } }, select: { id: true } });
      await notify(technicians.filter(u => u.id !== user.id).map(u => ({ userId: u.id, type: 'ACTUALIZACION_OPERATIVA' as const, title: `Mantenimiento: incidencia #${entry.humanId}`, link: `/libro/${entry.id}`, entity: 'OperationalEntry', entityId: entry.id })), tx);
    }
    const next = input.action === 'RECONFIRMAR' && changed && current.status === 'POR_REVISAR' ? 'PENDIENTE' : hkNextStatus(current.status, input.action, current.requiresInspection); const now = new Date();
    const data: Prisma.HousekeepingRequestUncheckedUpdateManyInput = { status: next, version: { increment: 1 }, maintenanceEntryId,
      ...(input.action === 'ASIGNAR' ? { assignedToId: input.assignedToId, workAssignedAt: now, acknowledgedAt: null, sourceVersion: null, finishedAt: null, inspectedAt: null, inspectedById: null, startedAt: null, blockReason: current.status === 'BLOQUEADO' ? current.blockReason : null, resolution: null, ...(input.dueAt ? { dueAt: input.dueAt } : {}) } : {}),
      ...(input.action === 'RECIBIR' ? { acknowledgedAt: now, sourceVersion: current.sourceEntry?.updatedAt ?? null } : {}),
      ...(['COMENZAR','RETOMAR'].includes(input.action) ? { startedAt: current.startedAt ?? now, acknowledgedAt: current.acknowledgedAt ?? now, sourceVersion: current.sourceEntry?.updatedAt ?? null, blockReason: null } : {}),
      ...(input.action === 'RECONFIRMAR' ? { acknowledgedAt: now, sourceVersion: current.sourceEntry?.updatedAt ?? null, ...(changed && current.status === 'POR_REVISAR' ? { finishedAt:null,inspectedAt:null,inspectedById:null,resolution:null } : {}) } : {}),
      ...(input.action === 'IMPEDIMENTO' ? { blockReason: note } : {}),
      ...((input.action === 'TERMINAR' || input.action === 'RESOLVER' && !current.requiresInspection) ? { finishedAt: now, resolution: note, blockReason: null } : {}),
      ...((input.action === 'APROBAR' || input.action === 'RESOLVER' && current.requiresInspection) ? { inspectedAt: now, inspectedById: user.id, resolution: `${current.resolution ?? ''}\nRevisión: ${note}`, blockReason: null } : {}),
      ...(input.action === 'CORREGIR' ? { inspectedAt: null, inspectedById: null, finishedAt: null, blockReason: null, resolution: null, description: current.sourceEntryId ? current.description : `${current.description ?? ''}\nCorrección: ${note}` } : {}),
      ...(input.action === 'REABRIR' ? { acknowledgedAt: null, sourceVersion: null, finishedAt: null, inspectedAt: null, inspectedById: null, resolvedAt: null, resolution: null, blockReason: null } : {}),
      ...(terminal.includes(next) ? { resolvedAt: now } : {}),
    };
    if (!(await tx.housekeepingRequest.updateMany({ where: { id: current.id, version: input.version }, data })).count) throw new RuleError('Otra persona actualizó el trabajo. Recarga.');
    await tx.housekeepingEvent.create({ data: { requestId: current.id, actorId: user.id, action: input.action, fromStatus: current.status, toStatus: next, note: input.action === 'ASIGNAR' ? `${note} · Responsable: ${(await tx.user.findUniqueOrThrow({where:{id:input.assignedToId!},select:{name:true}})).name}` : note || null } });
    await record(tx, user, current.id, current.humanId, input.action, note);
    const updated = await tx.housekeepingRequest.findUniqueOrThrow({ where: { id: current.id } });
    await notifyHkWork(tx, updated, user.id, next === 'POR_REVISAR' ? 'Trabajo terminado: requiere inspección' : next === 'RESUELTO' ? 'Resultado disponible' : input.action === 'CORREGIR' ? `Corregir: ${note.slice(0,100)}` : 'Trabajo actualizado',current.assignedToId,internalOnly);
    if(current.sourceEntryId)await notifyNativeWork(tx,{kind:'entry',id:current.sourceEntryId,actorId:user.id,ids:await sourceStakeholders(tx,current.sourceEntryId),title:`Housekeeping #${current.humanId}: ${next==='RESUELTO'?'resultado disponible':'atención actualizada'}`});
    return updated;
  };
  return transaction ? perform(transaction) : prisma.$transaction(perform);
}
/** Historic photographs retain evidence, but use current source visibility on read. */
async function visibleHkHandovers<T extends {snapshot:Prisma.JsonValue}>(user:CurrentUser,rows:T[]):Promise<T[]> {
  const hidden=await prisma.housekeepingRequest.findMany({where:{NOT:housekeepingEntryReadWhere(user)},select:{id:true,humanId:true}});
  const ids=new Set(hidden.map(r=>r.id));const folios=new Set(hidden.map(r=>r.humanId));
  return rows.map(row=>{const snapshot=row.snapshot;if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Array.isArray(snapshot.work))return row;
    return {...row,snapshot:{...snapshot,work:snapshot.work.filter(w=>!w||typeof w!=='object'||Array.isArray(w)||!(typeof w.id==='string'&&ids.has(w.id)||typeof w.humanId==='number'&&folios.has(w.humanId)))}};
  });
}

export async function getHkWorkday(user: CurrentUser, input: { date?: string; departmentId?: string; view?: string; floor?: string; responsible?: string; page?: number; focusId?: number;q?:string;state?:string } = {}) {
  hasAccess(user); const visibility = await hkWorkVisibility(user);
  const focused = input.focusId ? await prisma.housekeepingRequest.findFirst({where:{humanId:input.focusId,AND:[visibility]},select:{workDate:true,departmentId:true}}) : null;
  const date = validDate(input.date || focused?.workDate || hotelDateKey(new Date()));
  const scopedArea = input.departmentId || focused?.departmentId || (await prisma.department.findUnique({where:{key:'HOUSEKEEPING'},select:{id:true}}))?.id;
  const scope: Prisma.HousekeepingRequestWhereInput = { AND: [visibility], ...(scopedArea ? { departmentId: scopedArea } : {}) };
  const beginning = hotelWallDateTime(date, 0); const end = hotelWallDateTime(nextDate(date,1),0);
  const day: Prisma.HousekeepingRequestWhereInput = { ...scope, OR: [{ status: { notIn: terminal }, OR: [{ workDate: { lte: date } }, { workDate: null, createdAt: { lt: end } }] }, { resolvedAt: { gte: beginning, lt: end } }] };
  const filters: Prisma.HousekeepingRequestWhereInput = input.view === 'revision' ? { status: 'POR_REVISAR' } : input.view === 'impedimentos' ? { status: 'BLOQUEADO' } : input.view === 'solicitudes' ? { assignedToId: null, status: { notIn: terminal } } : input.view === 'mios' ? { assignedToId: user.id } : input.view === 'historial' ? { status: { in: terminal } } : input.view === 'continuidad' ? { status: { notIn: terminal }, OR: [{ workDate: { lt: date } }, { workDate: null, createdAt: { lt: beginning } }] } : {};
  const q=input.q?.trim().slice(0,100);const folio=q&&/^#?\d+$/.test(q)?Number(q.replace('#','')):null;
  const state=['PENDIENTE','RECIBIDO','EN_GESTION','BLOQUEADO','POR_REVISAR','RESUELTO','CANCELADO'].includes(input.state??'')?input.state:null;
  const search:Prisma.HousekeepingRequestWhereInput=q?{OR:[...(folio!==null&&Number.isSafeInteger(folio)&&folio<=2147483647?[{humanId:folio},{sourceEntry:{humanId:folio}}]:[]),{title:{contains:q,mode:'insensitive'}},{sourceEntry:{title:{contains:q,mode:'insensitive'}}},{location:{contains:q,mode:'insensitive'}},{room:{number:{contains:q,mode:'insensitive'}}}]}:{};
  const where: Prisma.HousekeepingRequestWhereInput = { AND: [input.view === 'historial' || input.focusId ? scope : day, filters,search,...(state?[{status:state}]:[])], ...(input.floor ? { room: { floor: Number(input.floor) } } : {}), ...(input.responsible ? { assignedToId: input.responsible } : {}), ...(input.focusId ? { humanId: input.focusId } : {}) };
  const page = Number.isSafeInteger(input.page) ? Math.max(1, Math.min(10000,input.page!)) : 1;
  const [requests, all, total, areas, rooms, zones] = await Promise.all([
    prisma.housekeepingRequest.findMany({ where, include: relations, orderBy: [{ priority: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 30, skip: (page-1)*30 }),
    prisma.housekeepingRequest.findMany({ where: day, select: { id:true, humanId:true, roomId:true, workKind:true, workflowVersion:true, status:true, assignedToId:true, effortMinutes:true, workDate:true, dueAt:true, requiresInspection:true, finishedAt:true, inspectedAt:true } }),
    prisma.housekeepingRequest.count({ where }),
    prisma.department.findMany({ where: { active:true, ...(user.roleKey === ADMIN || user.permissions.includes('housekeeping.view.all') ? {} : { OR:[{id:{in:await hkAreaIds(user)}},{key:{in:['HOUSEKEEPING','AREAS_PUBLICAS']}}] }) }, select:{id:true,name:true,key:true}, orderBy:{order:'asc'} }),
    prisma.room.findMany({where:{active:true},select:{id:true,number:true,floor:true},orderBy:{number:'asc'}}),
    prisma.keyArea.findMany({where:{active:true},select:{id:true,name:true},orderBy:{name:'asc'}}),
  ]);
  const defaultArea = areas.find(d=>d.key==='HOUSEKEEPING')?.id ?? areas[0]?.id;
  const departmentId = scopedArea || defaultArea || '';
  const [canAssign, canInspect, canPlan, canWork] = await Promise.all(['housekeeping.assign','housekeeping.inspect','housekeeping.plan','housekeeping.work'].map(p=>departmentId ? hkCapability(user,departmentId,p as PermissionKey) : false));
  const teamVisible = canAssign || canInspect || canPlan || user.roleKey === ADMIN || (hkHas(user,'housekeeping.view') && (await hkAreaIds(user)).includes(departmentId)) || user.permissions.includes('housekeeping.view.all');
  const startDate = new Date(`${date}T00:00:00Z`); const previousDate = new Date(`${nextDate(date,-1)}T00:00:00Z`);
  const [team, slots, confirmations, routines, handovers, delegations, loans] = await Promise.all([
    teamVisible ? prisma.user.findMany({where:{...membership(departmentId),...worker},select:{id:true,name:true},orderBy:{name:'asc'}}) : Promise.resolve([]),
    teamVisible ? prisma.scheduleSlot.findMany({where:{plan:{departmentId,status:'PUBLICADO'},cancelledAt:null,kind:'TURNO',collaborator:{active:true,user:{active:true,deletedAt:null}},OR:[{date:startDate},{date:previousDate,endAt:{gt:beginning}}]},select:{id:true,code:true,startAt:true,endAt:true,collaborator:{select:{userId:true,user:{select:{name:true}}}}}}) : Promise.resolve([]),
    teamVisible ? prisma.housekeepingDayMember.findMany({where:{departmentId,workDate:date},select:{userId:true,available:true,note:true,updatedAt:true}}) : Promise.resolve([]),
    canPlan || canAssign ? prisma.housekeepingRoutine.findMany({where:{departmentId},orderBy:{createdAt:'asc'}}) : Promise.resolve([]),
    teamVisible ? prisma.housekeepingHandover.findMany({where:{departmentId},include:{createdBy:{select:{name:true}},receivedBy:{select:{name:true}}},orderBy:{createdAt:'desc'},take:5}) : Promise.resolve([]),
    canPlan ? prisma.housekeepingDelegation.findMany({where:{departmentId,revokedAt:null,endsAt:{gt:new Date()}},include:{user:{select:{name:true}}},orderBy:{endsAt:'asc'}}) : Promise.resolve([]),
    prisma.keyStaffLoan.findMany({where:{departmentId, ...(teamVisible?{}:{collaboratorId:user.id}),items:{some:{returnedAt:null}}},select:{id:true,humanId:true,collaboratorName:true,items:{where:{returnedAt:null},select:{keyCode:true,destinationName:true}}},orderBy:{createdAt:'asc'},take:30}),
  ]);
  const active = all.filter(r=>!terminal.includes(r.status));
  const counts = { active:active.length, unassigned:active.filter(r=>!r.assignedToId).length, review:active.filter(r=>r.status==='POR_REVISAR').length, blocked:active.filter(r=>r.status==='BLOQUEADO').length, overdue:active.filter(r=>r.dueAt&&r.dueAt<new Date()).length, completed:all.filter(r=>r.status==='RESUELTO').length, carryover:active.filter(r=>!r.workDate||r.workDate<date).length };
  const workload = team.map(person=>({ ...person, tasks:active.filter(r=>r.assignedToId===person.id).length, estimatedMinutes:active.filter(r=>r.assignedToId===person.id&&r.status!=='POR_REVISAR').reduce((n,r)=>n+r.effortMinutes,0), available:confirmations.find(c=>c.userId===person.id)?.available??null, note:confirmations.find(c=>c.userId===person.id)?.note??null, scheduled:slots.filter(s=>s.collaborator.userId===person.id) }));
  const proposedLoad = new Map(workload.filter(p=>p.available===true).map(p=>[p.id,p.estimatedMinutes]));
  const suggestions = canAssign ? requests.filter(r=>r.workflowVersion===1&&!r.assignedToId&&!terminal.includes(r.status)).flatMap(r=>{const candidates=workload.filter(p=>proposedLoad.has(p.id)).sort((a,b)=>(proposedLoad.get(a.id)!-proposedLoad.get(b.id)!)||a.name.localeCompare(b.name,'es'));const person=candidates[0];if(!person)return[];const before=proposedLoad.get(person.id)!;proposedLoad.set(person.id,before+r.effortMinutes);return[{id:r.id,humanId:r.humanId,version:r.version,title:r.sourceEntry?.title??r.title,location:r.location,userId:person.id,name:person.name,reason:`Disponible confirmado · ${before} min estimados antes de este trabajo`}];}) : [];
  return { date, departmentId, roomBoard: buildHkRoomBoard(rooms, all), suggestions, requests,total,page,counts,areas,rooms,zones,canAssign:!!canAssign,canInspect:!!canInspect,canPlan:!!canPlan,canWork:!!canWork,canRequest:hkHas(user,'housekeeping.request')||canAssign,teamVisible,workload,routines,handovers:await visibleHkHandovers(user,handovers),delegations,loans };
}

export async function saveHkRoutine(user: CurrentUser, input: { departmentId:string;id?:string;version?:number;title:string;description:string;location:string;effortMinutes:number;requiresInspection:boolean;active:boolean }) {
  await requireCapability(user,input.departmentId,'housekeeping.plan');
  if(!input.title.trim()||!input.description.trim()||!input.location.trim()||!Number.isInteger(input.effortMinutes)||input.effortMinutes<1||input.effortMinutes>480) throw new RuleError('Completa la rutina y su duración estimada.');
  return prisma.$transaction(async tx=>{
    const data={title:input.title.trim(),description:input.description.trim(),location:input.location.trim(),effortMinutes:input.effortMinutes,requiresInspection:input.requiresInspection,active:input.active};
    if(input.id){ const changed=await tx.housekeepingRoutine.updateMany({where:{id:input.id,departmentId:input.departmentId,version:input.version},data:{...data,version:{increment:1}}});if(!changed.count)throw new RuleError('La rutina cambió. Actualiza.'); await record(tx,user,input.id,null,'RUTINA',JSON.stringify(data));return {id:input.id}; }
    const routine=await tx.housekeepingRoutine.create({data:{...data,departmentId:input.departmentId}});await record(tx,user,routine.id,null,'RUTINA',JSON.stringify(data));return routine;
  });
}
export async function prepareHkDay(user: CurrentUser, departmentId:string, date:string) {
  validDate(date); await requireCapability(user,departmentId,'housekeeping.assign');
  if(date<hotelDateKey(new Date()))throw new RuleError('Prepara hoy o una fecha futura. Los pendientes anteriores ya conservan su continuidad.');
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`hk_prepare_${departmentId}_${date}`}))::text`;
    const routines=await tx.housekeepingRoutine.findMany({where:{departmentId,active:true},take:300});
    const existing=await tx.housekeepingRequest.findMany({where:{routineId:{in:routines.map(r=>r.id)},workDate:date},select:{routineId:true}});
    const present=new Set(existing.map(r=>r.routineId));const missing=routines.filter(r=>!present.has(r.id));
    if(!missing.length)return{created:0};
    const batchKey=`hk_prepare_${user.id}_${Date.now()}`;
    const result=await tx.housekeepingRequest.createMany({data:missing.map(r=>({id:randomUUID(),requestKey:`hk_routine_${r.id}_${date}`,routineId:r.id,workDate:date,departmentId,workflowVersion:1,workKind:'ZONA_COMUN',title:r.title,description:r.description,location:r.location,effortMinutes:r.effortMinutes,requiresInspection:r.requiresInspection,createdById:user.id,blockReason:null})),skipDuplicates:true});
    // A transaction-scoped advisory lock serializes preparation for this area/day.
    const created=await tx.housekeepingRequest.findMany({where:{requestKey:{in:missing.map(r=>`hk_routine_${r.id}_${date}`)},events:{none:{}}},select:{id:true,humanId:true}});
    if(created.length){await tx.housekeepingEvent.createMany({data:created.map(r=>({requestId:r.id,actorId:user.id,action:'CREAR',toStatus:'PENDIENTE',note:'Rutina incorporada al día tras confirmación del supervisor.'}))});await tx.auditLog.createMany({data:created.map(r=>({entity:'HousekeepingWork',entityId:r.id,action:'CREAR' as const,userId:user.id,sessionId:user.sessionId,summary:`Housekeeping #${r.humanId}: rutina del día`} ))});
    const team=await coordinatingTeam(tx, departmentId, ['housekeeping.assign','housekeeping.plan','housekeeping.manage']);
    await notify(team.filter(u=>u.id!==user.id).map(u=>({userId:u.id,type:'ACTUALIZACION_OPERATIVA' as const,title:`Housekeeping: ${result.count} rutinas preparadas para ${date}`,link:`/housekeeping?area=${departmentId}&fecha=${date}`,entity:'HousekeepingWork',entityId:batchKey})),tx);}
    return{created:result.count};
  },{timeout:15000});
}
export async function confirmHkAvailability(user:CurrentUser,input:{departmentId:string;workDate:string;userId:string;available:boolean;note:string}){
  validDate(input.workDate);await requireCapability(user,input.departmentId,'housekeeping.assign');await validateWorker(prisma,input.departmentId,input.userId);
  if(!input.available&&!input.note.trim())throw new RuleError('Indica por qué la persona no está disponible.');
  // Excludes the handoff reader FOR SHARE, while allowing reciprocal actor FK KEY SHARE.
  return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${input.userId} FOR NO KEY UPDATE`;const row=await tx.housekeepingDayMember.upsert({where:{departmentId_workDate_userId:{departmentId:input.departmentId,workDate:input.workDate,userId:input.userId}},create:{...input,confirmedById:user.id},update:{available:input.available,note:input.note,confirmedById:user.id}});await record(tx,user,row.id,null,'DISPONIBILIDAD',`${input.userId}: ${input.available?'disponible':'no disponible'} · ${input.note}`);return row;});
}
export async function saveHkHandover(user:CurrentUser,input:{requestKey:string;departmentId:string;workDate:string;note:string}){
  validDate(input.workDate);await requireCapability(user,input.departmentId,'housekeeping.assign');if(!input.note.trim())throw new RuleError('Indica las instrucciones para el equipo que recibe.');
  return prisma.$transaction(async tx=>{
    const previous=await tx.housekeepingHandover.findUnique({where:{requestKey:input.requestKey}});if(previous){if(previous.createdById!==user.id)throw new ForbiddenError();return previous;}
    const [work,loans]=await Promise.all([tx.housekeepingRequest.findMany({where:{departmentId:input.departmentId,isDemo:false,AND:[housekeepingEntryReadWhere(user)],status:{notIn:terminal},OR:[{workDate:{lte:input.workDate}},{workDate:null}]},select:{id:true,humanId:true,title:true,sourceEntry:{select:{title:true}},location:true,status:true,blockReason:true,resolution:true,assignedTo:{select:{name:true}},dueAt:true,version:true}}),tx.keyStaffLoan.findMany({where:{departmentId:input.departmentId,items:{some:{returnedAt:null}}},select:{humanId:true,collaboratorName:true,items:{where:{returnedAt:null},select:{keyCode:true,destinationName:true}}}})]);
    const snapshot=JSON.parse(JSON.stringify({work,loans})) as Prisma.InputJsonValue;
    const row=await tx.housekeepingHandover.create({data:{...input,note:input.note.trim(),snapshot,createdById:user.id}});
    const receivers=await coordinatingTeam(tx, input.departmentId, ['housekeeping.assign','housekeeping.plan','housekeeping.manage']);
    await notify(receivers.filter(u=>u.id!==user.id).map(u=>({userId:u.id,type:'ACTUALIZACION_OPERATIVA' as const,title:'Housekeeping: relevo del área por recibir',link:`/housekeeping?area=${input.departmentId}&vista=continuidad`,entity:'HousekeepingHandover',entityId:row.id})),tx);await record(tx,user,row.id,null,'ENTREGAR_CONTINUIDAD',input.note);return row;
  });
}
export async function receiveHkHandover(user:CurrentUser,id:string){
  return prisma.$transaction(async tx=>{const row=await tx.housekeepingHandover.findUnique({where:{id}});if(!row)throw new NotFoundError();await requireCapability(user,row.departmentId,'housekeeping.assign',tx);if(row.createdById===user.id)throw new RuleError('El relevo debe recibirlo otra persona.');if(row.receivedAt)return row;const count=await tx.housekeepingHandover.updateMany({where:{id,receivedAt:null},data:{receivedById:user.id,receivedAt:new Date()}});if(!count.count)throw new RuleError('Otra persona recibió el relevo.');await record(tx,user,id,null,'RECIBIR_CONTINUIDAD','Recepción del relevo; no resuelve los trabajos pendientes.');return {id};});
}
export async function delegateHk(user:CurrentUser,input:{departmentId:string;userId:string;permission:string;startsAt:Date;endsAt:Date;reason:string}){
  await requireCapability(user,input.departmentId,'housekeeping.plan');
  if(!['housekeeping.assign','housekeeping.inspect'].includes(input.permission)||input.startsAt>=input.endsAt||input.endsAt<=new Date()||input.endsAt.getTime()-input.startsAt.getTime()>31*86400000||!input.reason.trim())throw new RuleError('Define una cobertura de hasta 31 días, su función y el motivo.');
  await validateWorker(prisma,input.departmentId,input.userId);if(input.userId===user.id)throw new RuleError('Selecciona a la persona que cubrirá la función.');
  // A↔B delegation must not deadlock when each insert validates grantedById on the other actor.
  return prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${input.userId} FOR NO KEY UPDATE`;const row=await tx.housekeepingDelegation.create({data:{...input,grantedById:user.id}});await record(tx,user,row.id,null,'DELEGAR',`${input.permission} · ${input.reason}`);return row;});
}
export async function revokeHkDelegation(user:CurrentUser,id:string){return prisma.$transaction(async tx=>{const row=await tx.housekeepingDelegation.findUnique({where:{id}});if(!row)throw new NotFoundError();await requireCapability(user,row.departmentId,'housekeeping.plan',tx);await tx.housekeepingDelegation.update({where:{id},data:{revokedAt:new Date()}});await record(tx,user,id,null,'REVOCAR_COBERTURA',row.reason);return{id};});}

export async function getHkSources(user:CurrentUser,departmentId:string,query=''){
  hasAccess(user);const assign=await hkCapability(user,departmentId,'housekeeping.assign');if(!assign&&!hkHas(user,'housekeeping.request'))throw new ForbiddenError();
  const number=/^#?\d+$/.test(query)?Number(query.replace('#','')):undefined;
  return readEntries(prisma, user).findMany({where:{deletedAt:null,housekeepingRequests:{none:{departmentId,deletedAt:null}},status:{notIn:['CERRADO','RESUELTO']},...sourceScope(user,departmentId,assign),...(query.trim()?{AND:[sourceScope(user,departmentId,assign),{OR:[{title:{contains:query.trim(),mode:'insensitive'}},{room:{number:{contains:query.trim()}}},...(number&&Number.isSafeInteger(number)?[{humanId:number}]:[])]}]}:{})},select:{id:true,humanId:true,title:true,description:true,room:{select:{id:true,number:true}}},orderBy:{createdAt:'desc'},take:25});
}
export async function organizeLegacyHkWork(user:CurrentUser,input:{id:string;version:number;departmentId:string;workDate:string;workKind:HkWorkKind;roomId?:string;effortMinutes:number;requiresInspection:boolean;assignedToId?:string;note:string}){
  validDate(input.workDate);await requireCapability(user,input.departmentId,'housekeeping.assign');
  if(!input.note.trim()||!Number.isInteger(input.effortMinutes)||input.effortMinutes<1||input.effortMinutes>480)throw new RuleError('Indica la instrucción y duración estimada.');
  return prisma.$transaction(async tx=>{
    const current=await tx.housekeepingRequest.findFirst({where:{id:input.id,workflowVersion:0,isDemo:false,AND:[await hkWorkVisibility(user,tx)]}});
    if(!current||terminal.includes(current.status))throw new NotFoundError('El aviso ya no está disponible para organizar.');
    if(current.version!==input.version)throw new RuleError('El aviso cambió. Actualiza.');
    if(current.departmentId&&current.departmentId!==input.departmentId)throw new ForbiddenError();
    const room=input.roomId?await tx.room.findFirst({where:{id:input.roomId,active:true},select:{id:true,number:true}}):null;
    if(input.roomId&&!room||input.workKind==='LIMPIEZA'&&!room)throw new RuleError('Selecciona la habitación que requiere limpieza.');
    if(!room&&!current.location?.trim())throw new RuleError('Este aviso no tiene ubicación. Registra un trabajo nuevo con la zona e indica el folio de este aviso.');
    if(input.assignedToId)await validateWorker(tx,input.departmentId,input.assignedToId,input.workDate);
    await assertHousekeepingWorkDestination(tx,user,{...current,departmentId:input.departmentId,assignedToId:input.assignedToId??null});
    const result=await tx.housekeepingRequest.updateMany({where:{id:current.id,version:input.version,workflowVersion:0},data:{workflowVersion:1,departmentId:input.departmentId,workDate:input.workDate,workKind:input.workKind,roomId:room?.id,location:room?.number??current.location,effortMinutes:input.effortMinutes,requiresInspection:hkInspectionRequired(input.workKind,input.requiresInspection),assignedToId:input.assignedToId||null,workAssignedAt:input.assignedToId?new Date():null,status:'PENDIENTE',acknowledgedAt:null,sourceVersion:null,blockReason:null,resolution:null,version:{increment:1}}});
    if(!result.count)throw new RuleError('Otra persona organizó este aviso. Actualiza.');
    await tx.housekeepingEvent.create({data:{requestId:current.id,actorId:user.id,action:'ORGANIZAR',fromStatus:current.status,toStatus:'PENDIENTE',note:input.note}});await record(tx,user,current.id,current.humanId,'ORGANIZAR',input.note);return{id:current.id};
  });
}

/** Receipt records transfer of information; acceptance records responsibility for reviewing it. */
export async function acceptHkHandover(user: CurrentUser, id: string) {
  return prisma.$transaction(async tx => {
    const row = await tx.housekeepingHandover.findUnique({ where: { id } });
    if (!row) throw new NotFoundError();
    await requireCapability(user, row.departmentId, 'housekeeping.assign', tx);
    if (row.receivedById !== user.id) throw new ForbiddenError('La aceptación corresponde a quien recibió el relevo.');
    if (row.acceptedAt) return row;
    const changed = await tx.housekeepingHandover.updateMany({ where: { id, receivedById: user.id, acceptedAt: null }, data: { acceptedAt: new Date(), acceptedById: user.id } });
    if (!changed.count) throw new RuleError('El relevo cambió. Actualiza.');
    await record(tx, user, id, null, 'ACEPTAR_CONTINUIDAD', 'Pendientes y custodias revisados. Cada trabajo conserva responsable, recepción y resultado propios.');
    return { id };
  });
}

/** Administrative repair: preserve the private pilot and its source snapshot before freeing the live relation. */
export async function releasePilotHkSource(user:CurrentUser,input:{id:string;version:number;note:string}) {
  if(user.roleKey!==ADMIN)throw new ForbiddenError();
  if(!input.note.trim())throw new RuleError('Describe el motivo de la regularización.');
  return prisma.$transaction(async tx=>{
    const initial=await tx.housekeepingRequest.findUnique({where:{id:input.id},select:{sourceEntryId:true}});
    if(!initial?.sourceEntryId)throw new RuleError('El vínculo ya fue regularizado o no existe.');
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${initial.sourceEntryId} FOR UPDATE`;
    const current=await tx.housekeepingRequest.findFirst({where:{id:input.id,isDemo:true,version:input.version,sourceEntryId:initial.sourceEntryId},include:{sourceEntry:{select:{id:true,humanId:true,title:true,description:true}}}});
    if(!current?.sourceEntry)throw new RuleError('La prueba cambió o no admite esta regularización.');
    const before={sourceEntryId:current.sourceEntryId,title:current.title,description:current.description,version:current.version,source:current.sourceEntry};
    const updated=await tx.housekeepingRequest.update({where:{id:current.id,version:input.version},data:{sourceEntryId:null,title:current.title??current.sourceEntry.title,description:current.description??current.sourceEntry.description,version:{increment:1}}});
    await tx.housekeepingEvent.create({data:{requestId:current.id,actorId:user.id,action:'REGULARIZAR_PILOTO',fromStatus:current.status,toStatus:current.status,note:`Vínculo anterior: asunto #${current.sourceEntry.humanId} (${current.sourceEntry.id}). ${input.note.trim()}`}});
    await tx.auditLog.create({data:{entity:'HousekeepingRequest',entityId:current.id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',isDemo:true,summary:`Regularización de vínculo piloto #${current.humanId}`,reason:input.note.trim(),before,after:{sourceEntryId:null,title:updated.title,description:updated.description,version:updated.version}}});
    return updated;
  });
}
