import { getSettingBool, lockSimpleNoveltiesMode } from './settings';
import { entryReadSql } from './entry-visibility';
import { readEntries } from '@/server/services/entry-visibility';
import {incidentResolutionAt} from '@/domain/operational-metrics';
import {assertTaskAssignable,canReceiveGenericTask} from './task-assignment-access';
import {notifyNativeWork,sourceStakeholders} from './work-notifications';
import {assertTaskSourceRecipients} from './tasks';
import 'server-only';
import { activeRuleOverrides } from './automation-policy-scope';
import { createHash } from 'node:crypto';
import type { PermissionKey } from '@/lib/permissions';
import type { Prisma, EntryType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { elapsedMinutes, nextWorkAction, receiptDueAt, hkReceiptAvailableAt, RECEIPT_MINUTES, COORDINATION_PAGE_SIZE, COORDINATION_MAX_PAGE, type CoordinationKind } from '@/domain/coordination';
import { coordinationEntries, coordinationTasks, coordinationFollowUps, canCoordinate } from './coordination-access';
import { hkWorkVisibility } from './housekeeping-work';
import { coverageSlots, scheduledAt } from '@/domain/schedule';
import { hotelDateKey, hotelWallDateTime, addHotelCalendarDays } from '@/domain/time';
import { scheduleAreaIds } from './schedule-access';
import { notify } from '@/server/notifications';
import { assertReceptionOperationPermission } from './reception-operation-gate';

const taskClosed = ['VALIDADA','COMPLETADA','CANCELADA'] as const;
export type CoordinationRow = {
  id: string; humanId: number; kind: CoordinationKind; priority?: string; title: string; status: string;
  departmentId: string | null; department: string; ownerId: string | null; owner: string; createdById:string|null;
  createdAt: Date; updatedAt: Date; dueAt: Date | null; receivedAt: Date | null; assignedAt: Date | null;
  availableAt: Date | null; startedAt: Date | null; completedAt: Date | null; nextAction: string; href: string;
  source?: {humanId:number;href:string}; canAssign: boolean; children: { label: string; href: string }[];
};

export type CoordinationView='all'|'reception'|'unassigned'|'unreceived'|'blocked'|'clarification'|'carryover';
export type CoordinationState='abierto'|'atencion'|'bloqueado'|'revision'|'resuelto';
const COORDINATION_IDENTITY_SCAN_LIMIT=5000;
export async function getCoordinationBoard(user: CurrentUser, input: { departmentId?: string; mine?: boolean; page?: number; history?: boolean; view?:CoordinationView;q?:string;ownerId?:string;state?:CoordinationState;date?:string } = {}) {
  const simple = await getSettingBool('book.simpleNovelties',false);
  const states:Record<CoordinationState,{entry:Prisma.EnumEntryStatusFilter['in'];task:Prisma.EnumTaskStatusFilter['in'];hk:string[];follow:Prisma.EnumFollowUpStatusFilter['in']}>= {
    abierto:{entry:['ABIERTO'],task:['PENDIENTE','ACEPTADA','DEVUELTA'],hk:['PENDIENTE','RECIBIDO'],follow:['PENDIENTE','VENCIDO']},
    atencion:{entry:['EN_CURSO'],task:['EN_CURSO'],hk:['EN_GESTION'],follow:[]},
    bloqueado:{entry:['EN_ESPERA'],task:['BLOQUEADA'],hk:['BLOQUEADO'],follow:[]},
    revision:{entry:[],task:['REALIZADA'],hk:['POR_REVISAR'],follow:[]},
    resuelto:{entry:['RESUELTO','CERRADO'],task:['VALIDADA','COMPLETADA'],hk:['RESUELTO'],follow:['CUMPLIDO']},
  };
  const state=input.state&&states[input.state];
  const history=input.state?input.state==='resuelto':input.history;
  const owner=input.ownerId||(input.mine?user.id:undefined);
  const q=input.q?.trim().slice(0,100);
  const folio=q&&/^#?\d+$/.test(q)?Number(q.replace('#','')):null;
  const human=folio!==null&&Number.isSafeInteger(folio)&&folio<=2147483647?{humanId:folio}:null;
  const date=(()=>{try{return input.date&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)?hotelWallDateTime(input.date,0):null;}catch{return null;}})();
  const due=date&&!Number.isNaN(date.getTime())&&hotelDateKey(date)===input.date?{gte:date,lt:addHotelCalendarDays(date,1)}:undefined;
  const page = Math.max(1, Math.min(COORDINATION_MAX_PAGE, input.page || 1));
  const area = input.departmentId ? { departmentId: input.departmentId } : {};
  const hkScope = canAccessHousekeeping(user) ? await hkWorkVisibility(user) : { id: { in: [] as string[] } };
  const view=input.view??'all';
  const receptionHkIds=view==='reception'?(await prisma.$queryRaw<Array<{id:string}>>`
    SELECT DISTINCT h."id"
    FROM "HousekeepingRequest" h
    LEFT JOIN "OperationalEntry" e ON e."id"=h."sourceEntryId" AND (${entryReadSql(user)})
    LEFT JOIN "ShiftAssignment" assignment ON assignment."userId"=h."createdById"
    LEFT JOIN "Shift" shift ON shift."id"=assignment."shiftId"
    WHERE e."shiftId" IS NOT NULL
       OR (
         assignment."activatedAt" IS NOT NULL
         AND h."createdAt" >= assignment."activatedAt"
         AND h."createdAt" <= COALESCE(assignment."leftAt", shift."actualEnd", 'infinity'::timestamp)
       )
  `).map(row=>row.id):[];
  const carryoverShiftStatuses=['CERRADO','ANULADO','RECIBIDO','ENTREGA_ENVIADA'] as const;
  const entryView:Prisma.OperationalEntryWhereInput = view==='reception'?{shiftId:{not:null}}:view==='unassigned'?{ownerId:null}:view==='unreceived'?{ownerId:{not:null},workAcknowledgedAt:null}:view==='blocked'?{status:'EN_ESPERA'}:view==='clarification'?{status:'EN_ESPERA',workNextAction:{startsWith:'Aclaración requerida:'}}:view==='carryover'?{shift:{status:{in:[...carryoverShiftStatuses]}}}:{};
  const taskView:Prisma.TaskWhereInput = view==='reception'?{shiftId:{not:null}}:view==='unassigned'?{assigneeId:null}:view==='unreceived'?{assigneeId:{not:null},workAcknowledgedAt:null}:view==='blocked'?{status:'BLOQUEADA'}:view==='clarification'?{status:'BLOQUEADA',workNextAction:{startsWith:'Aclaración requerida:'}}:view==='carryover'?{shift:{status:{in:[...carryoverShiftStatuses]}}}:{};
  const hkView:Prisma.HousekeepingRequestWhereInput = view==='reception'?{id:{in:receptionHkIds}}:view==='unassigned'?{assignedToId:null}:view==='unreceived'?{assignedToId:{not:null},acknowledgedAt:null}:view==='blocked'?{status:'BLOQUEADO'}:view==='clarification'?{id:{in:[]}}:view==='carryover'?{workDate:{lt:hotelDateKey(new Date())}}:{};
  // Linked records are grouped under their source. Hidden source work is never inferred from counts.
  const entryWhere: Prisma.OperationalEntryWhereInput = { AND: [coordinationEntries(user),...(simple?[{type:{notIn:['NOVEDAD','INCIDENCIA'] as EntryType[]}}]:[]),entryView,...(state?[{status:{in:state.entry}}]:[]),...(q?[{OR:[...(human?[human]:[]),{title:{contains:q,mode:'insensitive' as const}},{room:{number:{contains:q,mode:'insensitive' as const}}}]}]:[])], ...area,
    ...(history ? { status: { in: ['RESUELTO','CERRADO'] } } : { status: { notIn: ['RESUELTO','CERRADO'] } }),
    ...(owner ? { ownerId:owner } : {}),...(due?{dueAt:due}:{}), tasks:{none:{AND:[coordinationTasks(user)],...(owner?{assigneeId:owner}:{}),...area,status:{notIn:[...taskClosed]}}}, housekeepingRequests:{none:{deletedAt:null,...(owner?{assignedToId:owner}:{}),...area,workflowVersion:1,isDemo:false,status:{notIn:['RESUELTO','CANCELADO']},AND:[hkScope]}},
  };
  const taskWhere: Prisma.TaskWhereInput = { AND: [coordinationTasks(user),taskView,...(state?[{status:{in:state.task}}]:[]),...(q?[{OR:[...(human?[human,{entry:human}]:[]),{title:{contains:q,mode:'insensitive' as const}},{entry:{title:{contains:q,mode:'insensitive' as const}}},{room:{number:{contains:q,mode:'insensitive' as const}}}]}]:[])], ...area, OR: [{entryId:null},{entry:{NOT:entryWhere}}],
    status: history ? { in: [...taskClosed] } : { notIn: [...taskClosed] }, ...(owner ? { assigneeId:owner } : {}),...(due?{dueAt:due}:{}) };
  const hkWhere: Prisma.HousekeepingRequestWhereInput = { AND: [hkScope,hkView,...(state?[{status:{in:state.hk}}]:[]),...(q?[{OR:[...(human?[human,{sourceEntry:human}]:[]),{title:{contains:q,mode:'insensitive' as const}},{sourceEntry:{title:{contains:q,mode:'insensitive' as const}}},{room:{number:{contains:q,mode:'insensitive' as const}}},{location:{contains:q,mode:'insensitive' as const}}]}]:[])], ...area, workflowVersion: 1, isDemo: false,
    status: history ? { in: ['RESUELTO','CANCELADO'] } : { notIn: ['RESUELTO','CANCELADO'] }, ...(owner ? { assignedToId:owner } : {}),...(due?{dueAt:due}:{}) };
  const followWhere: Prisma.FollowUpWhereInput = { AND: [coordinationFollowUps(user), ...(view==='all'?[]:[{id:{in:[] as string[]}}]),...(state?[{status:{in:state.follow}}]:[]),...(q?[{OR:[...(human?[human]:[]),{action:{contains:q,mode:'insensitive' as const}}]}]:[]), {OR:[{entryId:null},{entry:{NOT:entryWhere}}]}, {OR:[{taskId:null},{task:{NOT:taskWhere}}]}], isDemo:false, ...(canCoordinate(user)?{}:{id:{in:[]}}), ...(input.departmentId?{owner:{departmentId:input.departmentId}}:{}), ...(owner?{ownerId:owner}:{}),...(due?{scheduledAt:due}:{}), status:history?{in:['CUMPLIDO','CANCELADO']}:{in:['PENDIENTE','VENCIDO']} };
  // Group authorized identities before paging, so one source never inflates rows or totals.
  const identity={id:true,humanId:true,departmentId:true,status:true,dueAt:true} as const;
  // Keep the coordination read bounded in PostgreSQL. The UI is an operational inbox,
  // not an export: at most 100 pages are browsable; older/deeper history remains
  // reachable through the existing search/date/area filters. Fetch one extra row per
  // source to know whether totals are exact without materializing hotel lifetime data.
  const scanTake=COORDINATION_IDENTITY_SCAN_LIMIT+1;
  const [entryRefsRaw,taskRefsRaw,hkRefsRaw,followRefsRaw]=await Promise.all([
    readEntries(prisma, user).findMany({where:entryWhere,select:identity,orderBy:[{dueAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take:scanTake}),
    prisma.task.findMany({where:taskWhere,select:{...identity,entryId:true},orderBy:[{dueAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take:scanTake}),
    prisma.housekeepingRequest.findMany({where:hkWhere,select:{...identity,sourceEntryId:true},orderBy:[{dueAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take:scanTake}),
    prisma.followUp.findMany({where:followWhere,select:{id:true,humanId:true,status:true,scheduledAt:true,entryId:true,task:{select:{entryId:true}},owner:{select:{departmentId:true}}},orderBy:[{scheduledAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take:scanTake}),
  ]);
  const identityWindowTruncated=[entryRefsRaw,taskRefsRaw,hkRefsRaw,followRefsRaw].some(rows=>rows.length>COORDINATION_IDENTITY_SCAN_LIMIT);
  const entryRefs=entryRefsRaw.slice(0,COORDINATION_IDENTITY_SCAN_LIMIT);
  const taskRefs=taskRefsRaw.slice(0,COORDINATION_IDENTITY_SCAN_LIMIT);
  const hkRefs=hkRefsRaw.slice(0,COORDINATION_IDENTITY_SCAN_LIMIT);
  const followRefs=followRefsRaw.slice(0,COORDINATION_IDENTITY_SCAN_LIMIT);
  type Identity={id:string;humanId:number;kind:CoordinationKind;sourceId:string|null;departmentId:string|null;status:string;dueAt:Date|null};
  const identities:Identity[]=[
    ...entryRefs.map(r=>({...r,kind:'entry' as const,sourceId:r.id})),
    ...taskRefs.map(r=>({...r,kind:'task' as const,sourceId:r.entryId})),
    ...hkRefs.map(r=>({...r,kind:'housekeeping' as const,sourceId:r.sourceEntryId})),
    ...followRefs.map(r=>({...r,kind:'followup' as const,sourceId:r.entryId??r.task?.entryId??null,departmentId:r.owner.departmentId,dueAt:r.scheduledAt})),
  ];
  identities.sort((a,b)=>(a.dueAt?.getTime()??Infinity)-(b.dueAt?.getTime()??Infinity)||a.id.localeCompare(b.id));
  const subjectGroups=new Map<string,Identity[]>();
  for(const row of identities){const key=row.sourceId?`entry:${row.sourceId}`:`${row.kind}:${row.id}`;const group=subjectGroups.get(key)??[];group.push(row);subjectGroups.set(key,group);}
  const representative=(group:Identity[])=>[...group].sort((a,b)=>{
    const rank=(row:Identity)=>row.kind==='entry'?0:row.kind==='task'?1:row.kind==='housekeeping'?2:3;
    return rank(a)-rank(b)||(a.dueAt?.getTime()??Infinity)-(b.dueAt?.getTime()??Infinity)||a.id.localeCompare(b.id);
  })[0]!;
  const groups=[...subjectGroups.values()].sort((a,b)=>(a[0]?.dueAt?.getTime()??Infinity)-(b[0]?.dueAt?.getTime()??Infinity)||(representative(a).id.localeCompare(representative(b).id)));
  const pageGroups=groups.slice((page-1)*COORDINATION_PAGE_SIZE,page*COORDINATION_PAGE_SIZE);
  const pageIds=(kind:CoordinationKind)=>pageGroups.map(representative).filter(row=>row.kind===kind).map(row=>row.id);
  const orderBy=[{dueAt:{sort:'asc' as const,nulls:'last' as const}},{id:'asc' as const}];
  const [entries,tasks,hk,followups,departments] = await Promise.all([
    readEntries(prisma, user).findMany({ where: {AND:[entryWhere],id:{in:pageIds('entry')}}, orderBy, include: {
      owner: { select: { name: true } }, department: { select: { name: true } },
      tasks: { where: coordinationTasks(user), select: { id:true,humanId:true,title:true,status:true,assigneeId:true,procedureOccurrenceKey:true }, take:20 },
      housekeepingRequests: {where:{deletedAt:null,workflowVersion:1,isDemo:false},select:{humanId:true,status:true,departmentId:true}},
      followUps: { where: coordinationFollowUps(user), select: { id:true,humanId:true,action:true }, take:20 },
    } }),
    prisma.task.findMany({ where: {AND:[taskWhere],id:{in:pageIds('task')}}, orderBy, include: { assignee: { select: { name:true } }, department: { select: { name:true } }, followUps:{where:coordinationFollowUps(user),select:{humanId:true,action:true},take:20} } }),
    prisma.housekeepingRequest.findMany({ where: {AND:[hkWhere],id:{in:pageIds('housekeeping')}}, orderBy, include: { assignedTo: { select:{name:true} }, department:{select:{name:true}},sourceEntry:{select:{id:true,humanId:true,title:true}},maintenanceEntry:{select:{id:true,humanId:true,status:true}} } }),
    prisma.followUp.findMany({where:{AND:[followWhere],id:{in:pageIds('followup')}},orderBy:[{scheduledAt:{sort:'asc',nulls:'last'}},{id:'asc'}],include:{owner:{select:{name:true,departmentId:true,department:{select:{name:true}}}}}}),
    prisma.department.findMany({where:{active:true},select:{id:true,name:true},orderBy:{order:'asc'}}),
  ]);
  const loads=new Map<string,{departmentId:string;name:string;total:number;blocked:number}>();
  for(const group of groups){
    const blocked=group.some(row=>['BLOQUEADO','BLOQUEADA','EN_ESPERA'].includes(row.status));
    const areaIds=[...new Set(group.map(row=>row.departmentId??'').filter(Boolean))];
    if(!areaIds.length)areaIds.push('');
    for(const id of areaIds){
      const load=loads.get(id)??{departmentId:id,name:departments.find(d=>d.id===id)?.name??'Sin área',total:0,blocked:0};
      load.total+=1;if(blocked)load.blocked+=1;loads.set(id,load);
    }
  }
  const byArea=[...loads.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'es'));
  const sourceIds=[...new Set([...tasks.map(t=>t.entryId),...hk.map(h=>h.sourceEntryId)].filter((id):id is string=>Boolean(id)))];
  const visibleSources=sourceIds.length?await readEntries(prisma, user).findMany({where:{id:{in:sourceIds},OR:[{AND:[coordinationEntries(user)]},{tasks:{some:{id:{in:tasks.map(t=>t.id)}}}}]},select:{id:true,humanId:true}}):[];
  const sources=new Map(visibleSources.map(entry=>[entry.id,{humanId:entry.humanId,href:`/libro/${entry.id}`} ]));
  const rows: CoordinationRow[] = [
    ...entries.map(r=>({id:r.id,humanId:r.humanId,kind:'entry' as const,title:r.title,status:r.status,priority:r.priority,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.ownerId,owner:r.owner?.name??'Por asignar',createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.workAcknowledgedAt,assignedAt:r.workAssignedAt,availableAt:null,startedAt:r.workStartedAt,completedAt:incidentResolutionAt(r),nextAction:r.housekeepingRequests.some(h=>['RESUELTO','CANCELADO'].includes(h.status))||r.tasks.some(t=>['VALIDADA','COMPLETADA'].includes(t.status))?'Revisar resultados y pendientes del asunto':nextWorkAction(r.status,r.ownerId,r.workAcknowledgedAt,r.workNextAction),href:`/libro/${r.id}`,canAssign:user.permissions.includes('entry.edit'),children:[...r.tasks.map(t=>({label:`Tarea #${t.humanId} · ${t.title} · ${t.status}`,href:`/tareas/${t.id}`})),...r.followUps.map(f=>({label:`Seguimiento #${f.humanId} · ${f.action}`,href:`/seguimientos?q=${f.humanId}&estado=todos`}))]})),
    ...tasks.map(r=>({id:r.id,humanId:r.humanId,source:r.entryId?sources.get(r.entryId):undefined,kind:'task' as const,title:r.title,status:r.status,priority:r.priority,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.assigneeId,owner:r.assignee?.name??'Por asignar',createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.workAcknowledgedAt,assignedAt:r.workAssignedAt,availableAt:r.startsAt,startedAt:r.workStartedAt,completedAt:r.completedAt,nextAction:nextWorkAction(r.status,r.assigneeId,r.workAcknowledgedAt,r.blockedReason||r.workNextAction),href:`/tareas/${r.id}`,canAssign:user.permissions.includes('task.assign'),children:[...(r.entryId&&sources.has(r.entryId)?[{label:`Asunto de origen #${sources.get(r.entryId)!.humanId}`,href:sources.get(r.entryId)!.href}]:[]),...r.followUps.map(f=>({label:`Seguimiento #${f.humanId} · ${f.action}`,href:`/seguimientos?q=${f.humanId}&estado=todos`}))]})),
    ...hk.map(r=>({id:r.id,humanId:r.humanId,source:r.sourceEntryId?sources.get(r.sourceEntryId):undefined,kind:'housekeeping' as const,title:r.sourceEntry?.title??r.title??'Trabajo del área',status:r.status,priority:r.priority,departmentId:r.departmentId,department:r.department?.name??'Sin área',ownerId:r.assignedToId,owner:r.assignedTo?.name??'Por asignar',createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.dueAt,receivedAt:r.acknowledgedAt,assignedAt:r.workAssignedAt,availableAt:hkReceiptAvailableAt(r.workDate),startedAt:r.startedAt,completedAt:r.resolvedAt,nextAction:nextWorkAction(r.status,r.assignedToId,r.acknowledgedAt,r.blockReason),href:`/housekeeping?area=${r.departmentId??''}&aviso=${r.humanId}`,canAssign:false,children:[...(r.sourceEntry&&canCoordinate(user)?[{label:`Novedad de origen #${r.sourceEntry.humanId}`,href:`/libro/${r.sourceEntry.id}`}]:[]),...(r.maintenanceEntry&&canCoordinate(user)?[{label:`Mantenimiento #${r.maintenanceEntry.humanId} · ${r.maintenanceEntry.status}`,href:`/libro/${r.maintenanceEntry.id}`}]:[])]})),
    ...followups.map(r=>({id:r.id,humanId:r.humanId,kind:'followup' as const,title:r.action,status:r.status,priority:r.priority,departmentId:r.owner.departmentId,department:r.owner.department?.name??'Sin área',ownerId:r.ownerId,owner:r.owner.name,createdById:r.createdById,createdAt:r.createdAt,updatedAt:r.updatedAt,dueAt:r.scheduledAt,receivedAt:null,assignedAt:null,availableAt:null,startedAt:null,completedAt:r.completedAt,nextAction:r.nextAction??(input.history?'Consultar resultado':'Revisar y registrar siguiente acción'),href:`/seguimientos?q=${r.humanId}&estado=todos`,canAssign:false,children:[]})),
  ];
  const groupedRows=pageGroups.flatMap(group=>{
    const first=representative(group);const row=rows.find(r=>r.kind===first.kind&&r.id===first.id);if(!row)return[];
    for(const child of group.filter(candidate=>candidate.id!==first.id||candidate.kind!==first.kind)){
      const href=child.kind==='task'?`/tareas/${child.id}`:child.kind==='housekeeping'?`/housekeeping?area=${child.departmentId??''}&aviso=${child.humanId}`:child.kind==='entry'?`/libro/${child.id}`:`/seguimientos?q=${child.humanId}&estado=todos`;
      if(!row.children.some(link=>link.href===href))row.children.push({label:`${child.kind==='task'?'Tarea':child.kind==='housekeeping'?'Housekeeping':child.kind==='entry'?'Asunto':'Seguimiento'} #${child.humanId} · ${child.status}`,href});
    }
    return[row];
  });
  const totalExact=!identityWindowTruncated;
  return {rows:groupedRows,departments,byArea,page,total:groups.length,totalExact,hasMore:groups.length>page*COORDINATION_PAGE_SIZE||identityWindowTruncated};
}

export async function getCoordinationTeam(user: CurrentUser, departmentId: string, now = new Date()) {
  if (!canCoordinate(user)) return [];
  const team = await prisma.user.findMany({where:{active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true},OR:[{departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId,active:true}}}}]},select:{id:true,name:true,role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}},orderBy:{name:'asc'},take:200});
  const areas = user.permissions.some(p=>['schedule.view','schedule.view.all','schedule.manage'].includes(p)) ? await scheduleAreaIds(user,true) : [];
  const slots = areas===null||areas.includes(departmentId) ? await prisma.scheduleSlot.findMany({where:{plan:{departmentId,status:'PUBLICADO'},cancelledAt:null,kind:'TURNO',extraStatus:{not:'RECHAZADO'},startAt:{lte:now},endAt:{gt:now},collaborator:{active:true,userId:{in:team.map(p=>p.id)}}},include:{collaborator:{select:{userId:true}}},take:300}) : [];
  return team.filter(p=>canReceiveGenericTask(p.role)).map(p=>({...p,scheduled:coverageSlots(slots).some(s=>s.collaborator.userId===p.id&&scheduledAt(s,now)),scheduleVisible:areas===null||areas.includes(departmentId)}));
}

type Mutation = { kind:'entry'|'task'; id:string; updatedAt:Date; requestKey:string; action:'RECIBIR'|'ASIGNAR'|'SIGUIENTE'|'ACLARACION'|'RESPONDER_ACLARACION'; ownerId?:string; nextAction:string };
export async function coordinateWork(user: CurrentUser, input: Mutation, transaction?: Prisma.TransactionClient) {
  await assertReceptionOperationPermission(user, input.kind==='task'?'task.edit':'entry.edit', transaction ?? prisma);
  if (!input.nextAction.trim()) throw new RuleError('Indica la siguiente acción para quien continúa.');
  const perform = async (tx:Prisma.TransactionClient)=>{
    const simpleMode=input.kind==='entry'?await lockSimpleNoveltiesMode(tx):false;
    // Lock before checking revision and permissions: no stale assignment or receipt can win.
    if(input.kind==='entry') await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id"=${input.id} FOR UPDATE`;
    const entry=input.kind==='entry'?await readEntries(tx, user).findFirst({where:{id:input.id,AND:[coordinationEntries(user)]}}):null;
    const task=input.kind==='task'?await tx.task.findFirst({where:{id:input.id,AND:[coordinationTasks(user)]}}):null;
    const current=entry??task;if(!current)throw new NotFoundError();
    if(entry&&['NOVEDAD','INCIDENCIA'].includes(entry.type)&&simpleMode)throw new RuleError('En novedades simples se elige el área relacionada; no se asignan ni reciben novedades individualmente.');
    const ownerId=entry?entry.ownerId:task!.assigneeId;
    const assign=user.permissions.includes(input.kind==='entry'?'entry.edit':'task.assign');
    const responding=input.action==='RESPONDER_ACLARACION';
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
      if(task)await assertTaskAssignable(nextOwner,tx);
      if(task)await assertTaskSourceRecipients(tx,[user.id,nextOwner],task,true);
    }
    if(input.action==='ACLARACION'&&((entry&&entry.status==='EN_ESPERA')||(task&&task.status==='BLOQUEADA')))throw new RuleError('Este trabajo ya tiene un impedimento o espera activa. Resuélvelo antes de solicitar otra aclaración.');
    if(input.action==='RESPONDER_ACLARACION'&&!((entry&&entry.status==='EN_ESPERA'&&entry.workNextAction?.startsWith('Aclaración requerida:'))||(task&&task.status==='BLOQUEADA'&&task.workNextAction?.startsWith('Aclaración requerida:'))))throw new RuleError('No hay una aclaración pendiente en este trabajo.');
    const now=new Date();
    const clarificationQuestion=input.action==='ACLARACION'?`Aclaración requerida: ${input.nextAction.trim()}`:null;
    const clarificationAnswer=input.action==='RESPONDER_ACLARACION'?`Aclaración recibida: ${input.nextAction.trim()}`:null;
    const data={updatedAt:new Date(Math.max(now.getTime(),current.updatedAt.getTime()+1)),workNextAction:clarificationQuestion??clarificationAnswer??input.nextAction.trim(),workRequestKey:keyPrefix+requestHash,
      ...(input.action==='ASIGNAR'?{workAssignedAt:now,workAcknowledgedAt:null,workAcknowledgedById:null,workStartedAt:null,workEscalatedAt:null}:{}),
      ...(input.action==='RECIBIR'?{workAcknowledgedAt:current.workAcknowledgedAt??now,workAcknowledgedById:user.id}:{}),
    };
    if(entry)await tx.operationalEntry.update({where:{id:entry.id},data:{...data,...(input.action==='ASIGNAR'?{ownerId:nextOwner}: {}),...(input.action==='ACLARACION'?{status:'EN_ESPERA'}:{}),...(input.action==='RESPONDER_ACLARACION'?{status:'EN_ESPERA'}:{})}});
    else{
      await tx.task.update({where:{id:task!.id},data:{...data,...(input.action==='ASIGNAR'?{assigneeId:nextOwner}: {}),...(input.action==='RECIBIR'&&task!.status==='PENDIENTE'?{status:'ACEPTADA'}:{}),...(input.action==='ACLARACION'?{status:'BLOQUEADA',blockedReason:clarificationQuestion}: {}),...(input.action==='RESPONDER_ACLARACION'?{status:'BLOQUEADA',blockedReason:clarificationAnswer}: {})}});
      if(input.action==='ASIGNAR'){
        await tx.taskAssignment.updateMany({where:{taskId:input.id,role:'PRINCIPAL',removedAt:null},data:{removedAt:now,removalReason:input.nextAction}});
        await tx.taskAssignment.upsert({where:{taskId_userId:{taskId:input.id,userId:nextOwner}},create:{taskId:input.id,userId:nextOwner,role:'PRINCIPAL',assignedById:user.id},update:{role:'PRINCIPAL',assignedById:user.id,assignedAt:now,removedAt:null,removalReason:null}});
      }
    }
    await tx.auditLog.create({data:{entity:entry?'OperationalEntry':'Task',entityId:input.id,action:input.action==='ASIGNAR'?'CAMBIO_RESPONSABLE':'EDITAR',userId:user.id,sessionId:user.sessionId,summary:`Coordinación #${current.humanId}: ${input.action}`,reason:input.nextAction,before:{ownerId},after:{ownerId:nextOwner,received:input.action==='RECIBIR',clarification:input.action==='ACLARACION',clarificationAnswered:input.action==='RESPONDER_ACLARACION'}}});
    if(input.action==='ASIGNAR')await notifyNativeWork(tx,{kind:input.kind,id:input.id,actorId:user.id,ids:[ownerId,nextOwner,current.createdById,...await sourceStakeholders(tx,entry?.id??task?.entryId)],title:`Responsable actualizado en #${current.humanId}; nueva recepción pendiente`,body:input.nextAction.trim()});
    if(input.action==='ACLARACION'&&current.createdById!==user.id)await notify([{userId:current.createdById,type:'ACCION_REQUERIDA',title:`Aclaración necesaria en #${current.humanId}`,body:input.nextAction.trim(),link:'/coordinacion?vista=clarification',entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
    if(input.action==='RESPONDER_ACLARACION'&&ownerId&&ownerId!==user.id)await notify([{userId:ownerId,type:'ACTUALIZACION_OPERATIVA',title:`Aclaración respondida en #${current.humanId}`,body:input.nextAction.trim(),link:'/coordinacion?mios=1',entity:entry?'OperationalEntry':'Task',entityId:input.id}],tx);
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
    const rows=kind==='entry'?await readEntries(prisma, {engine:"coordination"}).findMany({where:{...where,ownerId:{not:null},status:{notIn:['RESUELTO','CERRADO']}},take:100,orderBy:{workAssignedAt:'asc'}}):await prisma.task.findMany({where:{...where,assigneeId:{not:null},status:{notIn:[...taskClosed]},OR:[{startsAt:null},{startsAt:{lte:cutoff}}]},take:100,orderBy:{workAssignedAt:'asc'}});
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
        const visible=kind==='entry'?await readEntries(tx, reader).count({where:{id:row.id,AND:[coordinationEntries(reader)]}}):await tx.task.count({where:{id:row.id,AND:[coordinationTasks(reader)]}});
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
