import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notificationReadWhere } from './followup-access';

/** Revalidate current role even for a previously queued notification/push. */
export async function notificationWhereForUser(userId:string):Promise<Prisma.NotificationWhereInput> {
  const user=await prisma.user.findFirst({where:{id:userId,active:true,deletedAt:null},select:{id:true,role:{select:{permissions:{where:{permission:{key:'supervision.followup.manage'}},select:{permissionId:true}}}}}});
  if(!user)return {userId,id:{in:[]}};
  return {userId,...notificationReadWhere({id:userId,permissions:user.role.permissions.length?['supervision.followup.manage']:[]})};
}
