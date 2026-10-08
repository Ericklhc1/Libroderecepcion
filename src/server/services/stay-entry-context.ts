import 'server-only';
import type {Prisma} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { recordAudit } from '@/server/audit';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import { readEntries } from './entry-visibility';
import { lockNativeNoveltyCreation } from './native-entry-creation';
import { invalidateSimpleNoveltyDrafts } from './simple-novelty-drafts';

/** Checkout keeps historical reservation context using the same summary lock. */
export async function inheritPendingStayContext(stayId:string,user:CurrentUser){
  await prisma.$transaction(async tx=>{
    const simpleMode=await lockNativeNoveltyCreation(tx);
    const stay=await tx.roomStay.findUnique({where:{id:stayId},select:{roomId:true,reservationRefId:true,reservationRef:{select:{guestId:true}}}});
    if(!stay?.roomId)return;
    const where={roomId:stay.roomId,deletedAt:null,status:{in:ENTRY_OPEN_STATUSES},...(stay.reservationRefId?{OR:[{reservationId:stay.reservationRefId},{reservationId:null}]}:{})};
    const data={roomId:null,...(stay.reservationRefId?{reservationId:stay.reservationRefId}:{}),...(stay.reservationRef?.guestId?{guestId:stay.reservationRef.guestId}:{})};
    await updatePhotographedEntryContext(tx,user,where,data,simpleMode);
  });
}

/** Caller holds the native summary/mode lock; OFF retains its bulk mutation. */
export async function updatePhotographedEntryContext(tx:Prisma.TransactionClient,user:CurrentUser,where:Prisma.OperationalEntryWhereInput,data:Prisma.OperationalEntryUncheckedUpdateManyInput,simpleMode:boolean){
    const photographed=simpleMode?await readEntries(tx,{engine:'lifecycle'}).findMany({where,select:{id:true,humanId:true,type:true,isDemo:true,status:true,shiftId:true,roomId:true,reservationId:true,guestId:true}}):[];
    const result=await tx.operationalEntry.updateMany({where,data});
    for(const entry of photographed){
      const invalidatedDrafts=await invalidateSimpleNoveltyDrafts(tx,entry);
      await recordAudit({user,entity:'OperationalEntry',entityId:entry.id,action:'EDITAR',summary:`Contexto de estadía heredado en #${entry.humanId}`,before:{roomId:entry.roomId,reservationId:entry.reservationId,guestId:entry.guestId},after:{...data,invalidatedDrafts}},tx);
    }
    return result;
}
