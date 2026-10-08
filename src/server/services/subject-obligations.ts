import 'server-only';
import type {Prisma} from '@prisma/client';
/** One native obligation definition for the simple detail and its completion barrier.
 * Passing false preserves the pre-existing completion predicates when the trial is off. */
export function subjectTaskObligations(entryId:string,transitive=true):Prisma.TaskWhereInput{
  return {deletedAt:null,isDemo:false,status:{notIn:['COMPLETADA','VALIDADA','CANCELADA']},...(transitive?{OR:[{entryId},{sourceEntries:{some:{entryId}}}]}:{entryId})};
}
export function subjectFollowUpObligations(entryId:string,transitive=true):Prisma.FollowUpWhereInput{
  return {deletedAt:null,isDemo:false,status:{in:['PENDIENTE','VENCIDO']},OR:[{entryId},{task:{entryId}},{sourceEntity:'OperationalEntry',sourceId:entryId},...(transitive?[{sourceEntries:{some:{entryId}}}]:[])],AND:[{OR:[{origin:null},{origin:{not:{startsWith:'SUPERVISION_'}}}]}]};
}
export function subjectHousekeepingObligations(entryId:string,transitive=true):Prisma.HousekeepingRequestWhereInput{
  return {isDemo:false,status:{notIn:['RESUELTO','CANCELADO']},...(transitive?{deletedAt:null,OR:[{sourceEntryId:entryId},{maintenanceEntryId:entryId}]}:{sourceEntryId:entryId})};
}
