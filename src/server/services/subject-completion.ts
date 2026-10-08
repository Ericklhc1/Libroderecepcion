import {subjectTaskObligations,subjectFollowUpObligations,subjectHousekeepingObligations} from './subject-obligations';
import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import type {Prisma} from '@prisma/client';
import {RuleError} from '@/server/errors';

/** Called under the source row lock, shared by resolve and close. */
export async function assertSubjectCanFinish(tx:Prisma.TransactionClient,entryId:string,simpleNovelties=false){
  const [tasks,hk,followups,areas]=await Promise.all([
    tx.task.count({where:subjectTaskObligations(entryId,simpleNovelties)}),
    tx.housekeepingRequest.count({where:subjectHousekeepingObligations(entryId,simpleNovelties)}),
    tx.followUp.count({where:subjectFollowUpObligations(entryId,simpleNovelties)}),
    tx.subjectAreaAttention.count({where:{entryId,status:{in:['POR_REVISAR','ACLARACION']}}}),
  ]);
  const reasons=[tasks&&`${tasks} trabajo(s) pendiente(s)`,hk&&`${hk} atención(es) de Housekeeping pendiente(s)`,followups&&`${followups} seguimiento(s) operativo(s) sin resolver`,areas&&`${areas} área(s) por revisar o aclarar`].filter(Boolean);
  if(reasons.length)throw new RuleError(`No puedes resolver ni cerrar el asunto: ${reasons.join('; ')}. Abre sus vínculos y completa, valida o cancela con motivo cada intervención que corresponda.`);
}

/** Writers that add/reactivate an obligation serialize against global source completion. */
export async function lockOpenSubjectForWork(tx:Prisma.TransactionClient,input:{entryId?:string|null;taskId?:string|null;sourceEntity?:string|null;sourceId?:string|null;origin?:string|null}){
  if(input.origin?.startsWith('SUPERVISION_'))return;
  const taskEntry=input.taskId?(await tx.task.findUnique({where:{id:input.taskId},select:{entryId:true}}))?.entryId:null;
  const ids=[...new Set([input.entryId,taskEntry,input.sourceEntity==='OperationalEntry'?input.sourceId:null].filter((id):id is string=>!!id))].sort();
  for(const id of ids){
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${id} FOR UPDATE`;
    if(!await readEntries(tx, {engine:"lifecycle"}).count({where:{id,deletedAt:null,status:{notIn:['RESUELTO','CERRADO']}}}))throw new RuleError('Reabre el asunto antes de crear o reactivar una intervención pendiente.');
  }
}
