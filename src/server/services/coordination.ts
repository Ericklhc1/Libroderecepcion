import 'server-only';
import { activeRuleOverrides } from './automation-policy-scope';
import { createHash } from 'node:crypto';
import type { PermissionKey } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { elapsedMinutes, nextWorkAction, receiptDueAt, hkReceiptAvailableAt, RECEIPT_MINUTES, type CoordinationKind } from '@/domain/coordination';
import { coordinationEntries, coordinationTasks, coordinationFollowUps, canCoordinate } from './coordination-access';
import { hkWorkVisibility } from './housekeeping-work';
import { coverageSlots, scheduledAt } from '@/domain/schedule';
import { hotelDateKey } from '@/domain/time';
import { scheduleAreaIds } from './schedule-access';
import { notify } from '@/server/notifications';
import { assertReceptionOperationPermission } from './reception-operation-gate';

const taskClosed = ['VALIDADA','COMPLETADA','CANCELADA'] as const;
const CLARIFICATION_REQUEST_PREFIX='Aclaración requerida:';
const CLARIFICATION_ANSWER_PREFIX='Aclaración recibida:';
export type CoordinationRow = {
  id: string; humanId: number; kind: CoordinationKind; priority?: string; title: string; status: string;
  departmentId: string | null; department: string; ownerId: string | null; owner: string; createdById:string|null;
  createdAt: Date; updatedAt: Date; dueAt: Date | null; receivedAt: Date | null; assignedAt: Date | null;
  availableAt: Date | null; startedAt: Date | null; completedAt: Date | null; nextAction: string; href: string;
  canAssign: boolean; clarificationPending:boolean; children: { label: string; href: string }[];
};

export type CoordinationView='all'|'reception'|'unassigned'|'unreceived'|'blocked'|'clarification'|'carryover';
export async function getCoordinationBoard(user: CurrentUser, input: { departmentId?: string; mine?: boolean; page?: number; history?: boolean; view?:CoordinationView } = {}) {
  const page = Math.max(1, Math.min(10000, input.page || 1));
  const area = input.departmentId ? { departmentId: input.departmentId } : {};
  const hkScope = canAccessHousekeeping(user) ? await hkWorkVisibility(user) : { id: { in: [] as string[] } };
  const view=input.view??'all';
  const [legacyEntryRows,legacyTaskRows]=await Promise.all([
    prisma.$queryRaw<Array<{id:string}>>`
      SELECT e."id" FROM "OperationalEntry" e
      WHERE e."deletedAt" IS NULL AND e."isDemo"=false AND e."status"='EN_ESPERA'
        AND (e."workNextAction" IS NULL OR e."workNextAction" NOT LIKE 'Aclaración requerida:%')
        AND (SELECT a."summary" FROM "AuditLog" a WHERE a."entity"='OperationalEntry' AND a."entityId"=e."id" ORDER BY a."createdAt" DESC,a."id" DESC LIMIT 1)
          = 'Coordinación #' || e."humanId"::text || ': ACLARACION'
    `,
    prisma.$queryRaw<Array<{id:string}>>`
      SELECT t."id" FROM "Task" t
      WHERE t."deletedAt" IS NULL AND t."isDemo"=false AND t."status"='BLOQUEADA'
        AND (t."workNextAction" IS NULL OR t."workNextAction" NOT LIKE 'Aclaración requerida:%')
        AND (SELECT a."summary" FROM "AuditLog" a WHERE a."entity"='Task' AND a."entityId"=t."id" ORDER BY a."createdAt" DESC,a."id" DESC LIMIT 1)
          = 'Coordinación #' || t."humanId"::text || ': ACLARACION'
    `,
  ]);
  const legacyEntryIds=legacyEntryRows.map(row=>row.id),legacyTaskIds=legacyTaskRows.map(row=>row.id);
  const legacyEntrySet=new Set(legacyEntryIds),legacyTaskSet=new Set(legacyTaskIds);
  const receptionHkIds=view==='reception'?(await prisma.$queryRaw<Array<{id:string}>>`
    SELECT DISTINCT h."id"
    FROM "HousekeepingRequest" h
    LEFT JOIN "OperationalEntry" source ON source."id"=h."sourceEntryId"
    LEFT JOIN "ShiftAssignment" assignment ON assignment."userId"=h."createdById"
    LEFT JOIN "Shift" shift ON shift."id"=assignment."shiftId"
    WHERE source."shiftId" IS NOT NULL
       OR (
         assignment."activatedAt" IS NOT NULL
         AND h."createdAt" >= assignment."activatedAt"
         AND h."createdAt" <= COALESCE(assignment."leftAt", shift."actualEnd", 'infinity'::timestamp)
       )
  `).map(row=>row.id):[];
  const carryoverShiftStatuses=['CERRADO','ANULADO','RECIBIDO','ENTREGA_ENVIADA'] as const;
  const entryView:Prisma.OperationalEntryWhereInput = view==='reception'?{shiftId:{not:null}}:view==='unassigned'?{ownerId:null}:view==='unreceived'?{ownerId:{not:null},workAcknowledgedAt:null}:view==='blocked'?{status:'EN_ESPERA'}:view==='clarification'?{status:'EN_ESPERA',OR:[{workNextAction:{startsWith:CLARIFICATION_REQUEST_PREFIX}},{id:{in:legacyEntryIds}}]}:view==='carryover'?{shift:{status:{in:[...carryoverShiftStatuses]}}}:{};
  const taskView:Prisma.TaskWhereInput = view==='reception'?{shiftId:{not:null}}:view==='unassigned'?{assigneeId:null}:view==='unreceived'?{assigneeId:{not:null},workAcknowledgedAt:null}:view==='blocked'?{status:'BLOQUEADA'}:view==='clarification'?{status:'BLOQUEADA',OR:[{workNextAction:{startsWith:CLARIFICATION_REQUEST_PREFIX}},{id:{in:legacyTaskIds}}]}:view==='carryover'?{shift:{status:{in:[...carryoverShiftStatuses]}}}:{};
  const hkView:Prisma.HousekeepingRequestWhereInput = view==='reception'?{id:{in:receptionHkIds}}:view==='unassigned'?{assignedToId:null}:view==='unreceived'?{assignedToId:{not:null},acknowledgedAt:null}:view==='blocked'?{status:'BLOQUEADO'}:view==='clarification'?{id:{in:[]}}:view==='carryover'?{workDate:{lt:hotelDateKey(new Date())}}:{};
  // Linked records are grouped under their source. Hidden source work is never inferred from counts.
  const entryWhere: Prisma.OperationalEntryWhereInput = { AND: [coordinationEntries(user),entryView], ...area,
    ...(input.history ? { status: { in: ['RESUELTO','CERRADO'] } } : { status: { notIn: ['RESUELTO','CERRADO'] } }),
    ...(input.mine ? { ownerId: user.id } : {}), OR: [{ housekeepingRequest: null }, { housekeepingRequest: { NOT: { workflowVersion: 1, isDemo: false, AND: [hkScope] } } }],
  };
  const taskWhere: Prisma.TaskWhereInput = { AND: [coordinationTasks(user),taskView], ...area, OR: [{entryId:null},{entry:{NOT:entryWhere}}],
    status: input.history ? { in: [...taskClosed] } : { notIn: [...taskClosed] }, ...(input.mine ? { assigneeId: user.id } : {}) };
  const hkWhere: Prisma.HousekeepingRequestWhereInput = { AND: [hkScope,hkView], ...area, workflowVersion: 1, isDemo: false,
    status: input.history ? { in: ['RESUELTO','CANCELADO'] } : { notIn: ['RESUELTO','CANCELADO'] }, ...(input.mine ? { assignedToId: user.id } : {}) };
  const followWhere: Prisma.FollowUpWhereInput = { AND: [coordinationFollowUps(user), ...(view==='all'?[]:[{id:{in:[] as string[]}}]), {OR:[{entryId:null},{entry:{NOT:entryWhere}}]}, {OR:[{taskId:null},{task:{NOT:taskWhere}}]}], isDemo:false, ...(canCoordinate(user)?{}:{id:{in:[]}}), ...(input.departmentId?{owner:{departmentId:input.departmentId}}:{}), ...(input.mine?{ownerId:user.id}:{}), status:input.history?{in:['CUMPLIDO','CANCELADO']}:{in:['PENDIENTE','VENCIDO']} };
  const window = { take: 25, skip: (page-1)*25, orderBy: [{ dueAt: { sort: 'asc' as const, nulls: 'last' as const } }, { id: 'asc' as const }] };
  const [entries,tasks,hk,followups,entryGroups,taskGroups,hkGroups,followGroups,departments] = await Promise.all([
    prisma.operationalEntry.findMany({ where: entryWhere, ...window, include: {
      owner: { select: { name: true } }, department: { select: { name: true } },
      tasks: { where: coordinationTasks(user), select: { id:true,humanId:true,title:true,status:true,assigneeId:true }, take:20 },
      followUps: { where: coordinationFollowUps(user), select: { id:true,humanId:true,action:true }, take:20 },
    } }),
    prisma.task.findMany({ where: taskWhere, ...window, include: { assignee: { select: { name:true } }, department: { select: { name:true } }, followUps:{where:coordinationFollowUps(user),select:{humanId:true,action:true},take:20} } }),
    prisma.housekeepingRequest.findMany({ where: hkWhere, ...window, include: { assignedTo: { select:{name:true} }, department:{select:{name:true}},sourceEntry:{select:{id:true,humanId:true,title:true}},maintenanceEntry:{select:{id:true,humanId:true,status:true}} } }),
    prisma.followUp.findMany({where:followWhere,take:window.take,skip:window.skip,orderBy:[{scheduledAt:{sort:'asc',nulls:'last'}},{id:'asc'}],include:{owner:{select:{name:true,departmentId:true,department:{select:{name:true}}}}}}),
    prisma.operationalEntry.groupBy({by:['departmentId','status'],where:entryWhere,_count:{_all:true}}),prisma.task.groupBy({by:['departmentId','status'],where:taskWhere,_count:{_all:true}}),prisma.housekeepingRequest.groupBy({by:['departmentId','status'],where:hkWhere,_count:{_all:true}}),
    prisma.followUp.groupBy({by:['ownerId','status'],where:followWhere,_count:{_all:true}}),
    prisma.department.findMany({where:{active:true},select:{id:true,name:true},orderBy:{order:'asc'}}),
  ]);
  const count=(groups:Array<{_count:{_all:number}}>)=>groups.reduce((total,g)=>total+g._count._all,0);
  const entryCount=count(entryGroups),taskCount=count(taskGroups),hkCount=count(hkGroups);
  const loads=new Map<string,{departmentId:string;name:string;total:number;blocked:number}>();
  for(const group of [...entryGroups,...taskGroups,...hkGroups]){
    const id=group.departmentId??'';const load=loads.get(id)??{departmentId:id,name:departments.find(d=>d.id===id)?.name??'Sin área',total:0,blocked:0};
    load.total+=group._count._all;if(['BLOQUEADO','BLOQUEADA','EN_ESPERA'].includes(group.status))load.blocked+=group._count._all;loads.set(id,load);
  }
  const followOwners=followGroups.length?await prisma.user.findMany({where:{id:{in:followGroups.map(g=>g.ownerId)}},select:{id:true,departmentId:true}}):[];
  for(const group of followGroups){const id=followOwners.find(u=>u.id===group.ownerId)?.departmentId??'';const load=loads.get(id)??{departmentId:id,name:departments.find(d=>d.id===id)?.name??'Sin área',total:0,blocked:0};load.total+=group._count._all;loads.set(id,load);}
  const byArea=[...loads.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'es'));
  const rows: CoordinationRow[] = [
    ...entries.map(r=>({id:r.id,humanId:r.humanId,kind:'entry' as const,title:r.title,status:r.status,priority:r.priority,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.ownerId,owner:r.owner?.name??'Por asignar',createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.workAcknowledgedAt,assignedAt:r.workAssignedAt,availableAt:null,startedAt:r.workStartedAt,completedAt:r.closedAt,nextAction:nextWorkAction(r.status,r.ownerId,r.workAcknowledgedAt,r.workNextAction),href:`/libro/${r.id}`,canAssign:user.permissions.includes('entry.edit'),clarificationPending:r.status==='EN_ESPERA'&&(!!r.workNextAction?.startsWith(CLARIFICATION_REQUEST_PREFIX)||legacyEntrySet.has(r.id)),children:[...r.tasks.map(t=>({label:`Tarea #${t.humanId} · ${t.title} · ${t.status}`,href:`/tareas/${t.id}`})),...r.followUps.map(f=>({label:`Seguimiento #${f.humanId} · ${f.action}`,href:`/seguimientos?q=${f.humanId}&estado=todos`}))]})),
    ...tasks.map(r=>({id:r.id,humanId:r.humanId,kind:'task' as const,title:r.title,status:r.status,priority:r.priority,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.assigneeId,owner:r.assignee?.name??'Por asignar',createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.workAcknowledgedAt,assignedAt:r.workAssignedAt,availableAt:r.startsAt,startedAt:r.workStartedAt,completedAt:r.completedAt,nextAction:nextWorkAction(r.status,r.assigneeId,r.workAcknowledgedAt,r.blockedReason||r.workNextAction),href:`/tareas/${r.id}`,canAssign:user.permissions.includes('task.assign'),clarificationPending:r.status==='BLOQUEADA'&&(!!r.workNextAction?.startsWith(CLARIFICATION_REQUEST_PREFIX)||legacyTaskSet.has(r.id)),children:r.followUps.map(f=>({label:`Seguimiento #${f.humanId} · ${f.action}`,href:`/seguimientos?q=${f.humanId}&estado=todos`}))})),
    ...hk.map(r=>({id:r.id,humanId:r.humanId,kind:'housekeeping' as const,title:r.sourceEntry?.title??r.title??'Trabajo del área',status:r.status,priority:r.priority,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.assignedToId,owner:r.assignedTo?.name??'Por asignar',createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.acknowledgedAt,assignedAt:r.workAssignedAt,availableAt:hkReceiptAvailableAt(r.workDate),startedAt:r.startedAt,completedAt:r.resolvedAt,nextAction:nextWorkAction(r.status,r.assignedToId,r.acknowledgedAt,r.blockReason),href:`/admin/housekeeping?area=${r.departmentId??''}&aviso=${r.humanId}`,canAssign:false,clarificationPending:false,children:[...(r.sourceEntry&&canCoordinate(user)?[{label:`Novedad de origen #${r.sourceEntry.humanId}`,href:`/libro/${r.sourceEntry.id}`}]:[]),...(r.maintenanceEntry&&canCoordinate(user)?[{label:`Mantenimiento #${r.maintenanceEntry.humanId} · ${r.maintenanceEntry.status}`,href:`/libro/${r.maintenanceEntry.id}`}]:[])]})),
    ...followups.map(r=>({id:r.id,humanId:r.humanId,kind:'followup' as const,title:r.action,status:r.status,priority:r.priority,departmentId:r.owner.departmentId,department:r.owner.department?.name??'Sin área',ownerId:r.ownerId,owner:r.owner.name,createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.scheduledAt,receivedAt:null,assignedAt:null,availableAt:null,startedAt:null,completedAt:r.completedAt,nextAction:r.nextAction??(input.history?'Consultar resultado':'Revisar y registrar siguiente acción'),href:`/seguimientos?q=${r.humanId}&estado=todos`,canAssign:false,clarificationPending:false,children:[]})),
  ];
  return {rows,departments,byArea,page,total:entryCount+taskCount+hkCount+count(followGroups),hasMore:Math.max(entryCount,taskCount,hkCount,count(followGroups))>page*25};
}

export async function getCoordinationTeam(user: CurrentUser, departmentId: string, now = new Date()) {
  if (!canCoordinate(user)) return [];
  const team = await prisma.user.findMany({where:{active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true},OR:[{departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId,active:true}}}}]},select:{id:true,name:true},orderBy:{name:'asc'},take:200});
  const areas = user.permissions.some(p=>['schedule.view','schedule.view.all','schedule.manage'].includes(p)) ? await scheduleAreaIds(user,true) : [];
  const slots = areas===null||areas.includes(departmentId) ? await prisma.scheduleSlot.findMany({where:{plan:{departmentId,status:'PUBLICADO'},cancelledAt:null,kind:'TURNO',extraStatus:{not:'RECHAZADO'},startAt:{lte:now},endAt:{gt:now},collaborator:{active:true,userId:{in:team.map(p=>p.id)}}},include:{collaborator:{select:{userId:true}}},take:300}) : [];
  return team.map(p=>({...p,scheduled:coverageSlots(slots).some(s=>s.collaborator.userId===p.id&&scheduledAt(s,now)),scheduleVisible:areas===null||areas.includes(departmentId)}));
}

type Mutation = { kind:'entry'|'task'; id:string; updatedAt:Date; requestKey:string; action:'RECIBIR'|'ASIGNAR'|'SIGUIENTE'|'ACLARACION'|'RESPONDER_ACLARACION'|'RETOMAR_ACLARACION'; ownerId?:string; nextAction:string };
export async function coordinateWork(user: CurrentUser, input: Mutation, transaction?: Prisma.TransactionClient) {
  await assertReceptionOperationPermission(user, input.kind==='task'?'task.edit':'entry.edit');
  if (!input.nextAction.trim()) throw new RuleError('Indica la siguiente acción para quien continúa.');
  const perform = async (tx:Prisma.TransactionClient)=>{
    // Lock before checking revision and permissions: no stale assignment or receipt can win.
    if(input.kind==='entry') await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id"=${input.id} FOR UPDATE`;
    const entry=input.kind==='entry'?await tx.operationalEntry.findFirst({where:{id:input.id,AND:[coordinationEntries(user)]}}):null;
    const task=input.kind==='task'?await tx.task.findFirst({where:{id:input.id,AND:[coordinationTasks(user)]}}):null;
    const current=entry??task;if(!current)throw new NotFoundError();
    const ownerId=entry?entry.ownerId:task!.assigneeId;
    const assign=user.permissions.includes(input.kind==='entry'?'entry.edit':'task.assign');
    const responding=input.action==='RESPONDER_ACLARACION';const resuming=input.action==='RETOMAR_ACLARACION';
    if(input.action==='ASIGNAR'?!assign:responding?!(current.createdById===user.id||assign):ownerId!==user.id)throw new ForbiddenError(responding?'La aclaración debe responderla quien solicitó el trabajo o un coordinador autorizado.':'Esta acción corresponde al responsable o al coordinador autorizado.');
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
    if(input.action==='ACLARACION'&&((entry&&entry.status==='EN_ESPERA')||(task&&task.status==='BLOQUEADA')))throw new RuleError('Este trabajo ya tiene un impedimento o espera activa. Resuélvelo antes de solicitar otra aclaración.');
    if(responding){
      const prefixed=(entry?.status==='EN_ESPERA'&&entry.workNextAction?.startsWith(CLARIFICATION_REQUEST_PREFIX))||(task?.status==='BLOQUEADA'&&task.workNextAction?.startsWith(CLARIFICATION_REQUEST_PREFIX));
      let legacy=false;
      if(!prefixed&&((entry&&entry.status==='EN_ESPERA')||(task&&task.status==='BLOQUEADA'))){
        const entity=entry?'OperationalEntry':'Task';
        const last=await tx.auditLog.findFirst({where:{entity,entityId:input.id},select:{summary:true},orderBy:[{createdAt:'desc'},{id:'desc'}]});
        legacy=last?.summary===`Coordinación #${current.humanId}: ACLARACION`;
      }
      if(!prefixed&&!legacy)throw new RuleError('No hay una aclaración pendiente en este trabajo.');
    }
    if(resuming){
      const answer=entry?.workNextAction??task?.workNextAction??task?.blockedReason;
      if(!((entry&&entry.status==='EN_ESPERA')||(task&&task.status==='BLOQUEADA'))||!answer?.startsWith(CLARIFICATION_ANSWER_PREFIX))throw new RuleError('No hay una aclaración respondida pendiente de retomar.');
    }
    const now=new Date();
    const clarificationQuestion=input.action==='ACLARACION'?`${CLARIFICATION_REQUEST_PREFIX} ${input.nextAction.trim()}`:null;
    const clarificationAnswer=input.action==='RESPONDER_ACLARACION'?`${CLARIFICATION_ANSWER_PREFIX} ${input.nextAction.trim()}`:null;
    const data={updatedAt:new Date(Math.max(now.getTime(),current.updatedAt.getTime()+1)),workNextAction:clarificationQuestion??clarificationAnswer??input.nextAction.trim(),workRequestKey:keyPrefix+requestHash,
      ...(input.action==='ASIGNAR'?{workAssignedAt:now,workAcknowledgedAt:null,workAcknowledgedById:null,workStartedAt:null,workEscalatedAt:null}:{}),
      ...(input.action==='RECIBIR'?{workAcknowledgedAt:current.workAcknowledgedAt??now,workAcknowledgedById:user.id}:{}),
    };
    if(entry)await tx.operationalEntry.update({where:{id:entry.id},data:{...data,...(input.action==='ASIGNAR'?{ownerId:nextOwner}: {}),...(input.action==='ACLARACION'?{status:'EN_ESPERA'}:{}),...(input.action==='RESPONDER_ACLARACION'?{status:'EN_ESPERA'}:{}),...(resuming?{status:entry.workStartedAt?'EN_CURSO':'ABIERTO'}:{})}});
    else{
      await tx.task.update({where:{id:task!.id},data:{...data,...(input.action==='ASIGNAR'?{assigneeId:nextOwner}: {}),...(input.action==='RECIBIR'&&task!.status==='PENDIENTE'?{status:'ACEPTADA'}:{}),...(input.action==='ACLARACION'?{status:'BLOQUEADA',blockedReason:clarificationQuestion}: {}),...(input.action==='RESPONDER_ACLARACION'?{status:'BLOQUEADA',blockedReason:clarificationAnswer}: {}),...(resuming?{status:task!.workStartedAt?'EN_CURSO':task!.workAcknowledgedAt?'ACEPTADA':'PENDIENTE',blockedReason:null}: {})}});
      if(input.action==='ASIGNAR'){
        await tx.taskAssignment.updateMany({where:{taskId:input.id,role:'PRINCIPAL',removedAt:null},data:{removedAt:now,removalReason:input.nextAction}});
        await tx.taskAssignment.upsert({where:{taskId_userId:{taskId:input.id,userId:nextOwner}},create:{taskId:input.id,userId:nextOwner,role:'PRINCIPAL',assignedById:user.id},update:{role:'PRINCIPAL',assignedById:user.id,assignedAt:now,removedAt:null,removalReason:null}});
      }
    }
    await tx.auditLog.create({data:{entity:entry?'OperationalEntry':'Task',entityId:input.id,action:input.action==='ASIGNAR'?'CAMBIO_RESPONSABLE':'EDITAR',userId:user.id,sessionId:user.sessionId,summary:`Coordinación #${current.humanId}: ${input.action}`,reason:input.nextAction,before:{ownerId},after:{ownerId:nextOwner,received:input.action==='RECIBIR',clarification:input.action==='ACLARACION',clarificationAnswered:input.action==='RESPONDER_ACLARACION',clarificationResumed:resuming}}});
    if(input.action==='ASIGNAR'&&nextOwner!==user.id)await notify([{userId:nextOwner,type:'ACCION_REQUERIDA',title:`Trabajo #${current.humanId} por recibir`,link:'/coordinacion?mios=1',entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
    if(input.action==='ACLARACION'&&current.createdById!==user.id)await notify([{userId:current.createdById,type:'ACCION_REQUERIDA',title:`Aclaración necesaria en #${current.humanId}`,body:input.nextAction.trim(),link:'/coordinacion?vista=clarification',entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
    if(input.action==='RESPONDER_ACLARACION'&&ownerId&&ownerId!==user.id)await notify([{userId:ownerId,type:'ACTUALIZACION_OPERATIVA',title:`Aclaración respondida en #${current.humanId}`,body:input.nextAction.trim(),link:'/coordinacion?mios=1',entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
    if(resuming&&current.createdById!==user.id)await notify([{userId:current.createdById,type:'ACTUALIZACION_OPERATIVA',title:`Trabajo #${current.humanId} retomado tras aclaración`,body:input.nextAction.trim(),link:entry?`/libro/${input.id}`:`/tareas/${input.id}`,entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
    return {id:input.id};
  };
  return transaction ? perform(transaction) : prisma.$transaction(perform);
}

/** Explicitly assigned work only; historic rows are not given invented response deadlines. */
export async function escalateUnreceivedWork(now = new Date(), usePolicyOverrides = true) {
  const cutoff=new Date(now.getTime()-RECEIPT_MINUTES*60000);
  let escalated=0;
  for(const kind of ['entry','task'] as const){
    const overrides=usePolicyOverrides?await activeRuleOverrides(kind,'UNRECEIVED',now):[];
    const where={...(overrides.length?{NOT:{OR:overrides}}:{}),workAssignedAt:{lte:cutoff},workAcknowledgedAt:null,workEscalatedAt:null,deletedAt:null,isDemo:false};
    const rows=kind==='entry'?await prisma.operationalEntry.findMany({where:{...where,ownerId:{not:null},status:{notIn:['RESUELTO','CERRADO']}},take:100,orderBy:{workAssignedAt:'asc'}}):await prisma.task.findMany({where:{...where,assigneeId:{not:null},status:{notIn:[...taskClosed]},OR:[{startsAt:null},{startsAt:{lte:cutoff}}]},take:100,orderBy:{workAssignedAt:'asc'}});
    for(const row of rows)await prisma.$transaction(async tx=>{
      const claim={id:row.id,workAssignedAt:row.workAssignedAt,workAcknowledgedAt:null,workEscalatedAt:null,updatedAt:row.updatedAt};
      const result=kind==='entry'?await tx.operationalEntry.updateMany({where:claim,data:{workEscalatedAt:now}}):await tx.task.updateMany({where:claim,data:{workEscalatedAt:now}});
      if(!result.count)return;
      // Include coordinators who can act in the destination area, including cross-area requests.
      // Reuse source visibility before exposing even the existence of reserved work.
      const candidates=await tx.user.findMany({where:{active:true,deletedAt:null,hiddenFromSelectors:false,OR:[{id:row.createdById},...(row.departmentId?[{AND:[{OR:[{departmentId:row.departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId:row.departmentId,active:true}}}}]},{role:{permissions:{some:{permission:{key:kind==='entry'?'entry.edit':'task.assign'}}}}}]}]:[])]},select:{id:true,role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}});
      const recipients:string[]=[];
      for(const candidate of candidates){
        const reader={id:candidate.id,roleKey:candidate.role.key,permissions:candidate.role.permissions.map(p=>p.permission.key as PermissionKey)};
        const visible=kind==='entry'?await tx.operationalEntry.count({where:{id:row.id,AND:[coordinationEntries(reader)]}}):await tx.task.count({where:{id:row.id,AND:[coordinationTasks(reader)]}});
        if(visible)recipients.push(candidate.id);
      }
      await notify(recipients.map(userId=>({userId,type:'ACCION_REQUERIDA' as const,title:'Hay trabajo asignado sin confirmar recepción',link:'/coordinacion',entity:kind==='entry'?'OperationalEntry':'Task',entityId:row.id})),tx);
      escalated++;
    });
  }
  return {escalated};
}

export function coordinationMetrics(rows: CoordinationRow[], now = new Date()) {
  const average=(values:Array<number|null>)=>{const valid=values.filter((n):n is number=>n!==null);return {minutes:valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length):null,samples:valid.length};};
  return {pending:rows.length,unassigned:rows.filter(r=>!r.ownerId).length,unreceived:rows.filter(r=>r.kind!=='followup'&&r.ownerId&&!r.receivedAt).length,
    overdue:rows.filter(r=>r.dueAt&&r.dueAt<now).length,blocked:rows.filter(r=>['BLOQUEADO','BLOQUEADA','EN_ESPERA'].includes(r.status)).length,
    confirmation:average(rows.map(r=>elapsedMinutes(r.assignedAt,r.receivedAt))),attention:average(rows.map(r=>elapsedMinutes(r.receivedAt,r.startedAt))),resolution:average(rows.map(r=>elapsedMinutes(r.startedAt,r.completedAt))),
    receiptLate:rows.filter(r=>!r.receivedAt&&receiptDueAt(r.assignedAt,r.availableAt)&&receiptDueAt(r.assignedAt,r.availableAt)!<now).length};
}
