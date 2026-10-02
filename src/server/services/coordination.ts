import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { elapsedMinutes, nextWorkAction, receiptDueAt, type CoordinationKind } from '@/domain/coordination';
import { coordinationEntries, coordinationTasks, coordinationFollowUps, canCoordinate } from './coordination-access';
import { hkWorkVisibility } from './housekeeping-work';
import { coverageSlots, scheduledAt } from '@/domain/schedule';
import { scheduleAreaIds } from './schedule-access';
import { notify } from '@/server/notifications';
import { assertReceptionOperationPermission } from './reception-operation-gate';

const taskClosed = ['VALIDADA','COMPLETADA','CANCELADA'] as const;
export type CoordinationRow = {
  id: string; humanId: number; kind: CoordinationKind; title: string; status: string;
  departmentId: string | null; department: string; ownerId: string | null; owner: string;
  createdAt: Date; updatedAt: Date; dueAt: Date | null; receivedAt: Date | null; assignedAt: Date | null;
  startedAt: Date | null; completedAt: Date | null; nextAction: string; href: string;
  canAssign: boolean; children: { label: string; href: string }[];
};

export async function getCoordinationBoard(user: CurrentUser, input: { departmentId?: string; mine?: boolean; page?: number; history?: boolean } = {}) {
  const page = Math.max(1, Math.min(10000, input.page || 1));
  const area = input.departmentId ? { departmentId: input.departmentId } : {};
  const hkScope = canAccessHousekeeping(user) ? await hkWorkVisibility(user) : { id: { in: [] as string[] } };
  // Linked records are grouped under their source. Hidden source work is never inferred from counts.
  const entryWhere: Prisma.OperationalEntryWhereInput = { AND: [coordinationEntries(user)], ...area,
    ...(input.history ? { status: { in: ['RESUELTO','CERRADO'] } } : { status: { notIn: ['RESUELTO','CERRADO'] } }),
    ...(input.mine ? { ownerId: user.id } : {}), OR: [{ housekeepingRequest: null }, { housekeepingRequest: { NOT: { workflowVersion: 1, isDemo: false, AND: [hkScope] } } }],
  };
  const taskWhere: Prisma.TaskWhereInput = { AND: [coordinationTasks(user)], ...area, OR: [{entryId:null},{entry:{NOT:entryWhere}}],
    status: input.history ? { in: [...taskClosed] } : { notIn: [...taskClosed] }, ...(input.mine ? { assigneeId: user.id } : {}) };
  const hkWhere: Prisma.HousekeepingRequestWhereInput = { AND: [hkScope], ...area, workflowVersion: 1, isDemo: false,
    status: input.history ? { in: ['RESUELTO','CANCELADO'] } : { notIn: ['RESUELTO','CANCELADO'] }, ...(input.mine ? { assignedToId: user.id } : {}) };
  const window = { take: 25, skip: (page-1)*25, orderBy: [{ dueAt: { sort: 'asc' as const, nulls: 'last' as const } }, { id: 'asc' as const }] };
  const [entries,tasks,hk,entryCount,taskCount,hkCount,departments] = await Promise.all([
    prisma.operationalEntry.findMany({ where: entryWhere, ...window, include: {
      owner: { select: { name: true } }, department: { select: { name: true } },
      tasks: { where: coordinationTasks(user), select: { id:true,humanId:true,title:true,status:true,assigneeId:true }, take:20 },
      followUps: { where: coordinationFollowUps(user), select: { id:true,humanId:true,action:true }, take:20 },
    } }),
    prisma.task.findMany({ where: taskWhere, ...window, include: { assignee: { select: { name:true } }, department: { select: { name:true } } } }),
    prisma.housekeepingRequest.findMany({ where: hkWhere, ...window, include: { assignedTo: { select:{name:true} }, department:{select:{name:true}},sourceEntry:{select:{id:true,humanId:true,title:true}},maintenanceEntry:{select:{id:true,humanId:true,status:true}} } }),
    prisma.operationalEntry.count({where:entryWhere}),prisma.task.count({where:taskWhere}),prisma.housekeepingRequest.count({where:hkWhere}),
    prisma.department.findMany({where:{active:true},select:{id:true,name:true},orderBy:{order:'asc'}}),
  ]);
  const rows: CoordinationRow[] = [
    ...entries.map(r=>({id:r.id,humanId:r.humanId,kind:'entry' as const,title:r.title,status:r.status,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.ownerId,owner:r.owner?.name??'Por asignar',createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.workAcknowledgedAt,assignedAt:r.workAssignedAt,startedAt:r.workStartedAt,completedAt:r.closedAt,nextAction:nextWorkAction(r.status,r.ownerId,r.workAcknowledgedAt,r.workNextAction),href:`/libro/${r.id}`,canAssign:user.permissions.includes('entry.edit'),children:[...r.tasks.map(t=>({label:`Tarea #${t.humanId} · ${t.title} · ${t.status}`,href:`/tareas/${t.id}`})),...r.followUps.map(f=>({label:`Seguimiento #${f.humanId} · ${f.action}`,href:`/seguimientos/${f.id}`}))]})),
    ...tasks.map(r=>({id:r.id,humanId:r.humanId,kind:'task' as const,title:r.title,status:r.status,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.assigneeId,owner:r.assignee?.name??'Por asignar',createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.workAcknowledgedAt,assignedAt:r.workAssignedAt,startedAt:r.workStartedAt,completedAt:r.completedAt,nextAction:nextWorkAction(r.status,r.assigneeId,r.workAcknowledgedAt,r.blockedReason||r.workNextAction),href:`/tareas/${r.id}`,canAssign:user.permissions.includes('task.assign'),children:[]})),
    ...hk.map(r=>({id:r.id,humanId:r.humanId,kind:'housekeeping' as const,title:r.sourceEntry?.title??r.title??'Trabajo del área',status:r.status,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.assignedToId,owner:r.assignedTo?.name??'Por asignar',createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.acknowledgedAt,assignedAt:null,startedAt:r.startedAt,completedAt:r.resolvedAt,nextAction:nextWorkAction(r.status,r.assignedToId,r.acknowledgedAt,r.blockReason),href:`/admin/housekeeping?area=${r.departmentId??''}&aviso=${r.humanId}`,canAssign:false,children:[...(r.sourceEntry&&canCoordinate(user)?[{label:`Novedad de origen #${r.sourceEntry.humanId}`,href:`/libro/${r.sourceEntry.id}`}]:[]),...(r.maintenanceEntry&&canCoordinate(user)?[{label:`Mantenimiento #${r.maintenanceEntry.humanId} · ${r.maintenanceEntry.status}`,href:`/libro/${r.maintenanceEntry.id}`}]:[])]})),
  ];
  return {rows,departments,page,total:entryCount+taskCount+hkCount,hasMore:Math.max(entryCount,taskCount,hkCount)>page*25};
}

export async function getCoordinationTeam(user: CurrentUser, departmentId: string, now = new Date()) {
  if (!canCoordinate(user)) return [];
  const team = await prisma.user.findMany({where:{active:true,deletedAt:null,hiddenFromSelectors:false,OR:[{departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId,active:true}}}}]},select:{id:true,name:true},orderBy:{name:'asc'},take:200});
  const areas = user.permissions.some(p=>['schedule.view','schedule.view.all','schedule.manage'].includes(p)) ? await scheduleAreaIds(user,true) : [];
  const slots = areas===null||areas.includes(departmentId) ? await prisma.scheduleSlot.findMany({where:{plan:{departmentId,status:'PUBLICADO'},cancelledAt:null,kind:'TURNO',extraStatus:{not:'RECHAZADO'},startAt:{lte:now},endAt:{gt:now},collaborator:{active:true,userId:{in:team.map(p=>p.id)}}},include:{collaborator:{select:{userId:true}}},take:300}) : [];
  return team.map(p=>({...p,scheduled:coverageSlots(slots).some(s=>s.collaborator.userId===p.id&&scheduledAt(s,now)),scheduleVisible:areas===null||areas.includes(departmentId)}));
}

type Mutation = { kind:'entry'|'task'; id:string; updatedAt:Date; requestKey:string; action:'RECIBIR'|'ASIGNAR'|'SIGUIENTE'; ownerId?:string; nextAction:string };
export async function coordinateWork(user: CurrentUser, input: Mutation) {
  await assertReceptionOperationPermission(user, input.kind==='task'?'task.edit':'entry.edit');
  if (!input.nextAction.trim()) throw new RuleError('Indica la siguiente acción para quien continúa.');
  return prisma.$transaction(async tx=>{
    // Lock before checking revision and permissions: no stale assignment or receipt can win.
    if(input.kind==='entry') await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id"=${input.id} FOR UPDATE`;
    const entry=input.kind==='entry'?await tx.operationalEntry.findFirst({where:{id:input.id,AND:[coordinationEntries(user)]}}):null;
    const task=input.kind==='task'?await tx.task.findFirst({where:{id:input.id,AND:[coordinationTasks(user)]}}):null;
    const current=entry??task;if(!current)throw new NotFoundError();
    const ownerId=entry?entry.ownerId:task!.assigneeId;
    const assign=user.permissions.includes(input.kind==='entry'?'entry.edit':'task.assign');
    if(input.action==='ASIGNAR'?!assign:ownerId!==user.id)throw new ForbiddenError('Esta acción corresponde al responsable o al coordinador autorizado.');
    const keyPrefix=`${user.id}:${input.requestKey}:`;
    const requestHash=createHash('sha256').update(JSON.stringify({...input,updatedAt:input.updatedAt.toISOString()})).digest('hex');
    if(current.workRequestKey?.startsWith(keyPrefix)){
      if(current.workRequestKey!==keyPrefix+requestHash)throw new RuleError('El identificador de reintento pertenece a otra operación.');
      return current;
    }
    if(current.updatedAt.getTime()!==input.updatedAt.getTime())throw new RuleError('El trabajo cambió. Actualiza antes de continuar.');
    if(['RESUELTO','CERRADO',...taskClosed].includes(current.status))throw new RuleError('El trabajo ya está cerrado.');
    if(task?.startsAt&&task.startsAt>new Date())throw new RuleError('El trabajo todavía no comienza según su programación.');
    const nextOwner=input.action==='ASIGNAR'?input.ownerId:ownerId;
    if(!nextOwner)throw new RuleError('Selecciona un responsable.');
    if(input.action==='ASIGNAR'){
      if(!current.departmentId)throw new RuleError('Define el área en el registro antes de asignar.');
      const person=await tx.user.findFirst({where:{id:nextOwner,active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true},OR:[{departmentId:current.departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId:current.departmentId,active:true}}}}]},select:{id:true}});
      if(!person)throw new RuleError('El responsable debe ser un usuario operativo activo del área.');
    }
    const now=new Date();
    const data={updatedAt:new Date(Math.max(now.getTime(),current.updatedAt.getTime()+1)),workNextAction:input.nextAction.trim(),workRequestKey:keyPrefix+requestHash,
      ...(input.action==='ASIGNAR'?{workAssignedAt:now,workAcknowledgedAt:null,workAcknowledgedById:null,workStartedAt:null,workEscalatedAt:null}:{}),
      ...(input.action==='RECIBIR'?{workAcknowledgedAt:current.workAcknowledgedAt??now,workAcknowledgedById:user.id}:{}),
    };
    if(entry)await tx.operationalEntry.update({where:{id:entry.id},data:{...data,...(input.action==='ASIGNAR'?{ownerId:nextOwner}: {})}});
    else{
      await tx.task.update({where:{id:task!.id},data:{...data,...(input.action==='ASIGNAR'?{assigneeId:nextOwner}: {}),...(input.action==='RECIBIR'&&task!.status==='PENDIENTE'?{status:'ACEPTADA'}:{})}});
      if(input.action==='ASIGNAR'){
        await tx.taskAssignment.updateMany({where:{taskId:input.id,role:'PRINCIPAL',removedAt:null},data:{removedAt:now,removalReason:input.nextAction}});
        await tx.taskAssignment.upsert({where:{taskId_userId:{taskId:input.id,userId:nextOwner}},create:{taskId:input.id,userId:nextOwner,role:'PRINCIPAL',assignedById:user.id},update:{role:'PRINCIPAL',assignedById:user.id,assignedAt:now,removedAt:null,removalReason:null}});
      }
    }
    await tx.auditLog.create({data:{entity:entry?'OperationalEntry':'Task',entityId:input.id,action:input.action==='ASIGNAR'?'CAMBIO_RESPONSABLE':'EDITAR',userId:user.id,sessionId:user.sessionId,summary:`Coordinación #${current.humanId}: ${input.action}`,reason:input.nextAction,before:{ownerId},after:{ownerId:nextOwner,received:input.action==='RECIBIR'}}});
    if(input.action==='ASIGNAR'&&nextOwner!==user.id)await notify([{userId:nextOwner,type:'ACCION_REQUERIDA',title:`Trabajo #${current.humanId} por recibir`,link:'/coordinacion?mios=1',entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
    return {id:input.id};
  });
}

/** Explicitly assigned work only; historic rows are not given invented response deadlines. */
export async function escalateUnreceivedWork(now = new Date()) {
  const cutoff=new Date(now.getTime()-30*60000);
  let escalated=0;
  for(const kind of ['entry','task'] as const){
    const where={workAssignedAt:{lte:cutoff},workAcknowledgedAt:null,workEscalatedAt:null,deletedAt:null,isDemo:false};
    const rows=kind==='entry'?await prisma.operationalEntry.findMany({where:{...where,status:{notIn:['RESUELTO','CERRADO']}},take:100,orderBy:{workAssignedAt:'asc'}}):await prisma.task.findMany({where:{...where,status:{notIn:[...taskClosed]},OR:[{startsAt:null},{startsAt:{lte:cutoff}}]},take:100,orderBy:{workAssignedAt:'asc'}});
    for(const row of rows)await prisma.$transaction(async tx=>{
      const claim={id:row.id,workAssignedAt:row.workAssignedAt,workAcknowledgedAt:null,workEscalatedAt:null,updatedAt:row.updatedAt};
      const result=kind==='entry'?await tx.operationalEntry.updateMany({where:claim,data:{workEscalatedAt:now}}):await tx.task.updateMany({where:claim,data:{workEscalatedAt:now}});
      if(!result.count)return;
      // No private content is copied into escalation; destination rechecks source access.
      await notify([{userId:row.createdById,type:'ACCION_REQUERIDA',title:'Hay trabajo asignado sin confirmar recepción',link:'/coordinacion',entity:kind==='entry'?'OperationalEntry':'Task',entityId:row.id}],tx);
      escalated++;
    });
  }
  return {escalated};
}

export function coordinationMetrics(rows: CoordinationRow[], now = new Date()) {
  const average=(values:Array<number|null>)=>{const valid=values.filter((n):n is number=>n!==null);return {minutes:valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length):null,samples:valid.length};};
  return {pending:rows.length,unassigned:rows.filter(r=>!r.ownerId).length,unreceived:rows.filter(r=>r.ownerId&&!r.receivedAt).length,
    overdue:rows.filter(r=>r.dueAt&&r.dueAt<now).length,blocked:rows.filter(r=>['BLOQUEADO','BLOQUEADA'].includes(r.status)).length,
    confirmation:average(rows.map(r=>elapsedMinutes(r.assignedAt,r.receivedAt))),attention:average(rows.map(r=>elapsedMinutes(r.receivedAt,r.startedAt))),resolution:average(rows.map(r=>elapsedMinutes(r.startedAt,r.completedAt))),
    receiptLate:rows.filter(r=>!r.receivedAt&&receiptDueAt(r.assignedAt)&&receiptDueAt(r.assignedAt)!<now).length};
}
