import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { FrontiStep } from '@/domain/fronti-execution';
import { canonicalJson } from '@/domain/fronti-execution';

/** No snapshot content is exposed to the model or placed in audit logs. */
export async function revisionForStep(step: FrontiStep): Promise<string | null> {
  const field = (key: string) => typeof step.fields[key] === 'string' ? step.fields[key] as string : undefined;
  let row: unknown = undefined;
  if (field('guaranteeId')) row = await prisma.guarantee.findUnique({ where: { id: field('guaranteeId')! } });
  else if (field('keyId')) row = await prisma.roomKey.findUnique({ where: { id: field('keyId')! } });
  else if (step.action === 'updateUserAction') row = await prisma.user.findUnique({ where: { id: field('id')! }, select: { id: true, name: true, roleId: true, active: true, departmentId: true, updatedAt: true } });
  else if (step.action === 'updateRolePermissionsAction') row = await prisma.rolePermission.findMany({ where: { roleId: field('roleId')! }, orderBy: { permissionId: 'asc' } });
  else if (step.action === 'saveSettingAction') row = await prisma.systemSetting.findUnique({ where: { key: field('key')! } });
  else if (step.action === 'changeTaskStatusAction') row = await prisma.task.findUnique({ where: { id: field('id')! }, select: { updatedAt: true, status: true, assigneeId: true, dueAt: true } });
  else if (step.action === 'changeEntryStatusAction') row = await prisma.operationalEntry.findUnique({ where: { id: field('id')! }, select: { updatedAt: true, status: true, ownerId: true, dueAt: true } });
  // Versioned coordination/HK/schedules already compare inside the native transaction.
  return row === undefined ? null : createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(row)))).digest('hex');
}
