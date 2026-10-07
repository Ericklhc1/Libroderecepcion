import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notificationReadWhere } from './followup-access';
import type { EntryReader } from './entry-visibility';
import { closureValidationAlertWhere, entryReadWhere } from './entry-visibility';

/** Revalidate current role even for a previously queued notification/push. */
export async function notificationWhereForUser(userId:string):Promise<Prisma.NotificationWhereInput> {
  const user=await prisma.user.findFirst({where:{id:userId,active:true,deletedAt:null},select:{id:true,departmentId:true,role:{select:{key:true,permissions:{where:{permission:{key:'supervision.followup.manage'}},select:{permissionId:true}}}}}});
  if(!user)return {userId,id:{in:[]}};
  const reader:EntryReader={id:userId,departmentId:user.departmentId,roleKey:user.role.key,isSystemAdmin:user.role.key==='ADMINISTRADOR_SISTEMA',permissions:user.role.permissions.length?['supervision.followup.manage']:[]};
  const [hiddenEntries,legacyAlerts,legacyTasks]=await Promise.all([
    prisma.operationalEntry.findMany({where:{NOT:entryReadWhere(reader)},select:{id:true}}),
    prisma.alert.findMany({where:closureValidationAlertWhere,select:{id:true}}),
    prisma.task.findMany({where:{sourceAlert:closureValidationAlertWhere},select:{id:true}}),
  ]);
  const entryIds=hiddenEntries.map(e=>e.id);
  const [linkedTasks,linkedAlerts,linkedFollowUps]=entryIds.length?await Promise.all([
    prisma.task.findMany({where:{OR:[{entryId:{in:entryIds}},{sourceAlert:{entryId:{in:entryIds}}},{sourceFollowUps:{some:{followUp:{entryId:{in:entryIds}}}}}]},select:{id:true}}),
    prisma.alert.findMany({where:{OR:[{entryId:{in:entryIds}},{task:{entryId:{in:entryIds}}},{followUp:{entryId:{in:entryIds}}},{sourceFollowUps:{some:{followUp:{entryId:{in:entryIds}}}}} ]},select:{id:true}}),
    prisma.followUp.findMany({where:{OR:[{entryId:{in:entryIds}},{task:{entryId:{in:entryIds}}},{sourceEntity:'OperationalEntry',sourceId:{in:entryIds}},{sourceFollowUps:{some:{followUp:{entryId:{in:entryIds}}}}}]},select:{id:true}}),
  ]):[[],[],[]];
  const legacyVisible=reader.roleKey==='SUPERVISOR'||reader.isSystemAdmin;
  const hidden=[['OperationalEntry',hiddenEntries],['Task',[...linkedTasks,...(legacyVisible?[]:legacyTasks)]],['Alert',[...linkedAlerts,...(legacyVisible?[]:legacyAlerts)]],['FollowUp',linkedFollowUps]] as const;
  return {userId,deletedAt:null,...notificationReadWhere(reader),AND:hidden.filter(([,rows])=>rows.length).map(([entity,rows])=>({OR:[{entity:null},{entityId:null},{NOT:{entity,entityId:{in:rows.map(row=>row.id)}}}]}))};
}

/** Only visible notices may be acknowledged, including bulk and direct-id requests. */
export async function markReadableNotifications(userId:string, id?:string) {
  return prisma.notification.updateMany({
    where:{...await notificationWhereForUser(userId),readAt:null,...(id?{id}:{})},
    data:{readAt:new Date()},
  });
}
