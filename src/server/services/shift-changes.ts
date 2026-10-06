import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { coordinationEntries, coordinationTasks, coordinationFollowUps } from './coordination-access';
import { hkWorkVisibility } from './housekeeping-work';
import { isHkFocused } from '@/domain/housekeeping-work';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { summarizeShiftChange, shiftChangeResultLabel } from '@/domain/shift-changes';

const PAGE_SIZE = 20;
export type ShiftChangeItem = {id:string; humanId:number; title:string; href:string; owner:string; status:string; labels:string[]; result:string|null; resultLabel:string; updatedAt:Date};

/** Consulta determinista: usa el último fin real registrado de esta persona, nunca una malla prevista. */
export async function getChangesSinceLastShift(user: CurrentUser, requestedPage = 1, now = new Date()) {
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000) : 1;
  const [reception, supervision] = await Promise.all([
    prisma.shiftAssignment.findFirst({where:{userId:user.id,activatedAt:{not:null},leftAt:{not:null,lte:now},shift:{isDemo:false}},orderBy:{leftAt:'desc'},select:{leftAt:true,shift:{select:{humanId:true}}}}),
    prisma.supervisionShift.findFirst({where:{supervisorId:user.id,finishedAt:{not:null,lte:now}},orderBy:{finishedAt:'desc'},select:{finishedAt:true,humanId:true}}),
  ]);
  const baseline = supervision?.finishedAt && (!reception?.leftAt || supervision.finishedAt > reception.leftAt)
    ? {at:supervision.finishedAt, label:`Turno de Supervisión #${supervision.humanId}`}
    : reception?.leftAt ? {at:reception.leftAt,label:`Participación en turno #${reception.shift.humanId}`} : null;
  if (!baseline) return {baseline:null,now,page,pageSize:PAGE_SIZE,groups:[]};
  const changed = {gt:baseline.at,lte:now};
  const entryWhere: Prisma.OperationalEntryWhereInput = {AND:[coordinationEntries(user)],updatedAt:changed};
  const taskWhere: Prisma.TaskWhereInput = {AND:[coordinationTasks(user)],updatedAt:changed};
  const followWhere: Prisma.FollowUpWhereInput = {AND:[coordinationFollowUps(user), ...(isHkFocused(user) ? [{id:{in:[] as string[]}}] : [])],deletedAt:null,isDemo:false,updatedAt:changed};
  const hkWhere: Prisma.HousekeepingRequestWhereInput = {AND:[canAccessHousekeeping(user) ? await hkWorkVisibility(user) : {id:{in:[]}}],isDemo:false,workflowVersion:1,updatedAt:changed};
  const pagination = {take:PAGE_SIZE,skip:(page-1)*PAGE_SIZE,orderBy:[{updatedAt:'desc' as const},{id:'asc' as const}]};
  const [entries,tasks,followups,hk,entryCount,taskCount,followCount,hkCount] = await Promise.all([
    prisma.operationalEntry.findMany({where:entryWhere,...pagination,select:{id:true,humanId:true,title:true,status:true,createdAt:true,updatedAt:true,workAssignedAt:true,resolvedAt:true,closedAt:true,resolution:true,owner:{select:{name:true}}}}),
    prisma.task.findMany({where:taskWhere,...pagination,select:{id:true,humanId:true,title:true,status:true,createdAt:true,updatedAt:true,workAssignedAt:true,completedAt:true,evidenceProvided:true,assignee:{select:{name:true}}}}),
    prisma.followUp.findMany({where:followWhere,...pagination,select:{id:true,humanId:true,action:true,status:true,createdAt:true,updatedAt:true,completedAt:true,result:true,resolution:true,owner:{select:{name:true}}}}),
    prisma.housekeepingRequest.findMany({where:hkWhere,...pagination,select:{id:true,humanId:true,title:true,status:true,departmentId:true,createdAt:true,updatedAt:true,workAssignedAt:true,resolvedAt:true,resolution:true,assignedTo:{select:{name:true}}}}),
    prisma.operationalEntry.count({where:entryWhere}),prisma.task.count({where:taskWhere}),prisma.followUp.count({where:followWhere}),prisma.housekeepingRequest.count({where:hkWhere}),
  ]);
  const groups: Array<{key:string;label:string;total:number;items:ShiftChangeItem[]}> = [
    {key:'entries',label:'Asuntos',total:entryCount,items:entries.map(row=>({id:row.id,humanId:row.humanId,title:row.title,href:`/libro/${row.id}`,owner:row.owner?.name??'Por asignar',status:row.status,labels:summarizeShiftChange({...row,assignedAt:row.workAssignedAt,completedAt:row.resolvedAt??row.closedAt},baseline.at),result:row.resolution,resultLabel:shiftChangeResultLabel(row.status),updatedAt:row.updatedAt}))},
    {key:'tasks',label:'Tareas',total:taskCount,items:tasks.map(row=>({id:row.id,humanId:row.humanId,title:row.title,href:`/tareas/${row.id}`,owner:row.assignee?.name??'Por asignar',status:row.status,labels:summarizeShiftChange({...row,assignedAt:row.workAssignedAt},baseline.at),result:row.evidenceProvided,resultLabel:shiftChangeResultLabel(row.status),updatedAt:row.updatedAt}))},
    {key:'followups',label:'Seguimientos',total:followCount,items:followups.map(row=>({id:row.id,humanId:row.humanId,title:row.action,href:`/seguimientos?q=${row.humanId}&estado=todos`,owner:row.owner.name,status:row.status,labels:summarizeShiftChange(row,baseline.at),result:row.result??row.resolution,resultLabel:shiftChangeResultLabel(row.status),updatedAt:row.updatedAt}))},
    {key:'housekeeping',label:'Trabajo de Housekeeping',total:hkCount,items:hk.map(row=>({id:row.id,humanId:row.humanId,title:row.title??'Trabajo del área',href:`/housekeeping?area=${row.departmentId??''}&aviso=${row.humanId}`,owner:row.assignedTo?.name??'Por asignar',status:row.status,labels:summarizeShiftChange({...row,assignedAt:row.workAssignedAt,completedAt:row.resolvedAt},baseline.at),result:row.resolution,resultLabel:shiftChangeResultLabel(row.status),updatedAt:row.updatedAt}))},
  ];
  return {baseline,now,page,pageSize:PAGE_SIZE,groups};
}
