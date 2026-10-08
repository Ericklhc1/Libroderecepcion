import {subjectTaskObligations,subjectFollowUpObligations,subjectHousekeepingObligations} from './subject-obligations';
import {lockSimpleNoveltiesMode} from './settings';
import type {Prisma} from '@prisma/client';
import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
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
export async function lockOpenSubjectForWork(tx:Prisma.TransactionClient,input:{entryId?:string|null;taskId?:string|null;alertId?:string|null;followUpId?:string|null;sourceEntity?:string|null;sourceId?:string|null;origin?:string|null},mode?:boolean){
  if(input.origin?.startsWith('SUPERVISION_'))return [];
  const simpleMode=mode??await lockSimpleNoveltiesMode(tx);
  const taskEntry=input.taskId?(await tx.task.findUnique({where:{id:input.taskId},select:{entryId:true}}))?.entryId:null;
  const ids=new Set([input.entryId,taskEntry,input.sourceEntity==='OperationalEntry'?input.sourceId:null].filter((id):id is string=>!!id));
  if(simpleMode){
    // The same PostgreSQL walker handles every native source kind and casing,
    // including HK, comments, notifications and audit sources, without a second allowlist.
    const roots=[['task',input.taskId],['alert',input.alertId],['followup',input.followUpId],[input.sourceEntity?.toLowerCase(),input.sourceId]];
    for(const [kind,id] of roots)if(kind&&id){
      const origins=await tx.$queryRaw<{entryId:string}[]>`SELECT "entryId" FROM "complete_native_entry_origin_ids"(${kind},${id})`;
      for(const origin of origins)ids.add(origin.entryId);
    }
  }
  const sorted=[...ids].sort();
  for(const id of sorted){
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${id} FOR UPDATE`;
    if(!await readEntries(tx,{engine:'lifecycle'}).count({where:{id,deletedAt:null,status:{notIn:['RESUELTO','CERRADO']}}}))throw new RuleError('Reabre el asunto antes de crear o reactivar una intervención pendiente.');
  }
  return sorted;
}
