import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notificationReadWhere } from './followup-access';
import type {PermissionKey} from '@/lib/permissions';
import type { EntryReader } from './entry-visibility';
import { closureValidationAlertWhere } from './entry-visibility';

/** Revalidate current role even for a previously queued notification/push. */
export async function notificationWhereForUser(userId:string):Promise<Prisma.NotificationWhereInput> {
  const user=await prisma.user.findFirst({where:{id:userId,active:true,deletedAt:null},select:{id:true,departmentId:true,role:{select:{key:true,permissions:{where:{permission:{key:{in:['supervision.followup.manage','shift.manage']}}},select:{permission:{select:{key:true}}}}}}}});
  if(!user)return {userId,id:{in:[]}};
  const reader:EntryReader={id:userId,departmentId:user.departmentId,roleKey:user.role.key,isSystemAdmin:user.role.key==='ADMINISTRADOR_SISTEMA',permissions:user.role.permissions.map(p=>p.permission.key as PermissionKey)};
  const legacyVisible=reader.permissions.includes('shift.manage')&&(reader.roleKey==='SUPERVISOR'||reader.isSystemAdmin);
  const [legacyAlerts,legacyTasks]=legacyVisible?[[],[]]:await Promise.all([
    prisma.alert.findMany({where:closureValidationAlertWhere,select:{id:true}}),
    prisma.task.findMany({where:{sourceAlert:closureValidationAlertWhere},select:{id:true}}),
  ]);
  const legacy=[['Alert',legacyAlerts],['Task',legacyTasks]] as const;
  return {userId,deletedAt:null,...notificationReadWhere(reader),AND:[...legacy.filter(([,rows])=>rows.length).map(([entity,rows])=>({OR:[{entity:null},{entityId:null},{NOT:{entity,entityId:{in:rows.map(row=>row.id)}}}]}))]};
}

/** Only visible notices may be acknowledged, including bulk and direct-id requests. */
export async function markReadableNotifications(userId:string, id?:string) {
  return prisma.notification.updateMany({
    where:{...await notificationWhereForUser(userId),readAt:null,...(id?{id}:{})},
    data:{readAt:new Date()},
  });
}
