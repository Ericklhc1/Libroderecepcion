import 'server-only';
import type {Prisma,EntryType,EntryStatus} from '@prisma/client';
import {ENTRY_OPEN_STATUSES} from '@/domain/labels';
import {readEntries,receptionHandoverEntryWhere,type EntryReader} from './entry-visibility';
/** Mode-on content changes invalidate the same native handover summary, under its lock. */
export async function invalidateSimpleNoveltyDrafts(tx:Prisma.TransactionClient,entry:{id:string;type:EntryType;isDemo:boolean;status:EntryStatus;shiftId:string|null}) {
  if(entry.isDemo||!['NOVEDAD','INCIDENCIA'].includes(entry.type))return [];
  const drafts=await tx.shiftHandover.findMany({where:{status:'BORRADOR'},select:{id:true,fromShiftId:true,issuedBy:{select:{id:true,departmentId:true,role:{select:{key:true}}}},items:{where:{refId:entry.id},select:{id:true}}}});
  const ids:string[]=[];
  for(const draft of drafts){
    if(draft.items.length){ids.push(draft.id);continue;}
    if(!ENTRY_OPEN_STATUSES.includes(entry.status)&&entry.shiftId!==draft.fromShiftId)continue;
    const reader:EntryReader={id:draft.issuedBy.id,departmentId:draft.issuedBy.departmentId,roleKey:draft.issuedBy.role.key,isSystemAdmin:draft.issuedBy.role.key==='ADMINISTRADOR_SISTEMA',permissions:[]};
    if(await readEntries(tx,reader).count({where:{id:entry.id,AND:[receptionHandoverEntryWhere]}}))ids.push(draft.id);
  }
  if(ids.length)await tx.shiftHandover.updateMany({where:{id:{in:ids},status:'BORRADOR'},data:{receptionSummaryRevision:{increment:1},pendingsReviewedAt:null,finalReviewAt:null,urgentAcknowledgedAt:null}});
  return ids;
}
