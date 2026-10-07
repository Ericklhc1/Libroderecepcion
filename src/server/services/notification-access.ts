import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notificationReadWhere } from './followup-access';

/** Revalidate current role even for a previously queued notification/push. */
export async function notificationWhereForUser(userId:string):Promise<Prisma.NotificationWhereInput> {
  const user=await prisma.user.findFirst({where:{id:userId,active:true,deletedAt:null},select:{id:true,role:{select:{permissions:{where:{permission:{key:'supervision.followup.manage'}},select:{permissionId:true}}}}}});
  if(!user)return {userId,id:{in:[]}};
  return {userId,deletedAt:null,...notificationReadWhere({id:userId,permissions:user.role.permissions.length?['supervision.followup.manage']:[]})};
}

/** Only visible notices may be acknowledged, including bulk and direct-id requests. */
export async function markReadableNotifications(userId:string, id?:string) {
  return prisma.notification.updateMany({
    where:{...await notificationWhereForUser(userId),readAt:null,...(id?{id}:{})},
    data:{readAt:new Date()},
  });
}
