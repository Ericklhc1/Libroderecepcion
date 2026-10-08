import {getMyActiveShift} from './shifts';
import 'server-only';
import type {Prisma} from '@prisma/client';
import {lockReceptionSummary} from './handover-snapshot';
import {lockSimpleNoveltiesMode} from './settings';
import {invalidateSimpleNoveltyDrafts} from './simple-novelty-drafts';
/** Native creators acquire this before their domain locks, in summary → mode order. */
export async function lockNativeNoveltyCreation(tx:Prisma.TransactionClient){
  await lockReceptionSummary(tx);
  return lockSimpleNoveltiesMode(tx);
}
export async function createNativeEntry(tx:Prisma.TransactionClient,input:{data:Prisma.OperationalEntryUncheckedCreateInput}){
  const novelty=['NOVEDAD','INCIDENCIA'].includes(input.data.type);
  const simple=novelty?await lockNativeNoveltyCreation(tx):false;
  const shiftId=simple?(input.data.shiftId??(await getMyActiveShift(input.data.createdById,tx))?.id??null):input.data.shiftId;
  const entry=await tx.operationalEntry.create({data:simple?{...input.data,shiftId,ownerId:null,requiresFollowUp:false}:input.data});
  if(simple){const drafts=await invalidateSimpleNoveltyDrafts(tx,entry);if(drafts.length)await tx.auditLog.create({data:{entity:'OperationalEntry',entityId:entry.id,action:'CREAR',userId:entry.createdById,summary:'Creación nativa: revisión de novedades pendiente de regenerar',after:{invalidatedDrafts:drafts}}});}
  return entry;
}
export async function createNativeEntries(tx:Prisma.TransactionClient,input:{data:Prisma.OperationalEntryUncheckedCreateInput[]}){
  for(const data of input.data)await createNativeEntry(tx,{data});
  return {count:input.data.length};
}
