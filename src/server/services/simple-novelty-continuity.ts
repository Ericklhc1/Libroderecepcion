import {subjectTaskObligations,subjectFollowUpObligations,subjectHousekeepingObligations} from './subject-obligations';
import 'server-only';
import {prisma} from '@/lib/prisma';
import type {CurrentUser} from '@/server/auth/current-user';
import {readEntries,housekeepingEntryReadWhere} from './entry-visibility';
import {taskFollowUpReadWhere,followUpReadWhere} from './followup-access';
import {NotFoundError} from '@/server/errors';
/** Read the current native obligations; never replace or cancel legacy work on mode changes. */
export async function getSimpleNoveltyContinuity(entryId:string,user:CurrentUser){
  if(!await readEntries(prisma,user).count({where:{id:entryId,deletedAt:null}}))throw new NotFoundError();
  const [tasks,followups,housekeeping,dependentHousekeeping]=await Promise.all([
    prisma.task.findMany({where:{...subjectTaskObligations(entryId),AND:[taskFollowUpReadWhere(user)]},select:{id:true,humanId:true,title:true,status:true,assignee:{select:{name:true}}},orderBy:{createdAt:'asc'}}),
    prisma.followUp.findMany({where:{AND:[subjectFollowUpObligations(entryId),followUpReadWhere(user)]},select:{id:true,humanId:true,action:true,status:true,owner:{select:{name:true}}},orderBy:{createdAt:'asc'}}),
    prisma.housekeepingRequest.findMany({where:{...subjectHousekeepingObligations(entryId),AND:[housekeepingEntryReadWhere(user)]},select:{id:true,humanId:true,title:true,status:true,departmentId:true},orderBy:{createdAt:'asc'}}),
    prisma.housekeepingRequest.findMany({where:{deletedAt:null,isDemo:false,maintenanceEntryId:entryId,OR:[{sourceEntryId:null},{sourceEntryId:{not:entryId}}],status:{notIn:['RESUELTO','CANCELADO']},AND:[housekeepingEntryReadWhere(user)]},select:{id:true,humanId:true,title:true,status:true,departmentId:true},orderBy:{createdAt:'asc'}}),
  ]);
  return{tasks,followups,housekeeping,dependentHousekeeping};
}
