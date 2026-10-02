import 'server-only';
import { actionDefinition } from './catalog';
import { authorizedRevision } from '@/server/security/authorized-revision';
import { prisma } from '@/lib/prisma';
import type { FrontiStep } from '@/domain/fronti-execution';

/** No snapshot content is exposed to the model or placed in audit logs. */
export async function revisionForStep(step: FrontiStep): Promise<string | null> {
  const field = (key: string) => typeof step.fields[key] === 'string' ? step.fields[key] as string : undefined;
  let row: unknown = undefined;
  if (['saveAutomationAction','setAutomationStateAction','simulateAutomationAction'].includes(step.action)&&field('id')) row = await prisma.operationalAutomation.findUnique({where:{id:field('id')!},select:{version:true,enabled:true,revokedAt:true,expiresAt:true}});
  else if (field('guaranteeId')) row = await prisma.guarantee.findUnique({ where: { id: field('guaranteeId')! } });
  else if (field('keyId')) row = await prisma.roomKey.findUnique({ where: { id: field('keyId')! } });
  else if (step.action === 'updateUserAction' && field('id')) row = await prisma.user.findUnique({ where: { id: field('id')! }, select: { id: true, name: true, roleId: true, active: true, departmentId: true, updatedAt: true } });
  else if (step.action === 'updateRolePermissionsAction' && field('roleId')) row = await prisma.rolePermission.findMany({ where: { roleId: field('roleId')! }, orderBy: { permissionId: 'asc' } });
  else if (step.action === 'saveSettingAction' && field('key')) row = await prisma.systemSetting.findUnique({ where: { key: field('key')! } });
  else if (step.action === 'changeTaskStatusAction' && field('id')) row = await prisma.task.findUnique({ where: { id: field('id')! }, select: { updatedAt: true, status: true, assigneeId: true, dueAt: true } });
  else if (step.action === 'changeEntryStatusAction' && field('id')) row = await prisma.operationalEntry.findUnique({ where: { id: field('id')! }, select: { updatedAt: true, status: true, ownerId: true, dueAt: true } });
  else if(field('id')&&actionDefinition(step.action).module==='tasks')row=await prisma.task.findUnique({where:{id:field('id')!}});
  else if(field('id')&&actionDefinition(step.action).module==='entries')row=await prisma.operationalEntry.findUnique({where:{id:field('id')!}});
  else if(field('id')&&actionDefinition(step.action).module==='followups')row=await prisma.followUp.findUnique({where:{id:field('id')!}});
  else if(field('id')&&actionDefinition(step.action).module==='references')row=await prisma.guarantee.findUnique({where:{id:field('id')!}});
  else if(field('id')&&['resetUserPasswordAction','deleteUserAction','restoreUserAction'].includes(step.action))row=await prisma.user.findUnique({where:{id:field('id')!},select:{id:true,updatedAt:true,roleId:true,active:true,deletedAt:true}});
  // Versioned coordination/HK/schedules already compare inside the native transaction.
  return row === undefined ? null : authorizedRevision(row);
}
