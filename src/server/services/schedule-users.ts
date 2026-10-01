import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { scheduleAllowed } from '@/domain/schedule';
import { assertScheduleArea } from './schedule-access';

export const scheduleEligibleUser = { active: true, deletedAt: null, hiddenFromSelectors: false } satisfies Prisma.UserWhereInput;
export const scheduleIdentitySelect = { name: true, active: true, deletedAt: true, hiddenFromSelectors: true, role: { select: { name: true } } } as const;
type Identity = { name: string; active: boolean; deletedAt: Date | null; hiddenFromSelectors: boolean; role: { name: string } };
export function schedulePerson<T extends { name: string; functionName: string; active: boolean; user: Identity | null }>(row: T) {
  const { user, ...profile } = row;
  return { ...profile, name: user?.name ?? row.name, functionName: user?.role.name ?? row.functionName, active: !!user && user.active && !user.deletedAt && !user.hiddenFromSelectors };
}
export function scheduleEmployeeCode(userId: string) {
  return `USR_${createHash('sha256').update(userId).digest('hex').slice(0, 24).toUpperCase()}`;
}

/** Provision only missing scheduling metadata for users in their primary area.
 * Called only by an authorized manager. Reads by staff never provision accounts,
 * change permissions, create assignments, or touch Reception/Cash.
 * Unlinked legacy names are not guessed: an administrator links them explicitly.
 */
export async function ensureScheduleUsers(actor: CurrentUser, departmentId: string) {
  const permission = scheduleAllowed(actor, 'schedule.catalog.manage') ? 'schedule.catalog.manage' : 'schedule.manage';
  await assertScheduleArea(actor, departmentId, permission);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${departmentId} FOR UPDATE`;
    const users = await tx.user.findMany({ where: { ...scheduleEligibleUser, departmentId, department: { active: true } }, select: { id: true, name: true, role: { select: { name: true } } }, orderBy: { id: 'asc' }, take: 500 });
    const profiles = await tx.scheduleCollaborator.findMany({ where: { OR: [{ userId: { in: users.map((u) => u.id) } }, { userId: null, memberships: { some: { departmentId } } }] }, include: { memberships: true } });
    const byUser = new Map(profiles.filter((p) => p.userId).map((p) => [p.userId!, p]));
    const key = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('es');
    const legacyNames = new Set(profiles.filter((p) => !p.userId).map((p) => key(p.name)));
    for (const user of users) {
      const current = byUser.get(user.id);
      if (!current && legacyNames.has(key(user.name))) continue;
      const hasArea = current?.memberships.some((m) => m.departmentId === departmentId && m.active);
      if (current && hasArea) continue;
      const profile = current ?? await tx.scheduleCollaborator.upsert({ where: { userId: user.id }, create: { userId: user.id, employeeCode: scheduleEmployeeCode(user.id), name: user.name, functionName: user.role.name, active: true }, update: {} });
      await tx.scheduleMembership.upsert({ where: { collaboratorId_departmentId: { collaboratorId: profile.id, departmentId } }, create: { collaboratorId: profile.id, departmentId }, update: { active: true } });
      await tx.auditLog.create({ data: { entity: 'ScheduleCatalog', entityId: departmentId, action: 'EDITAR', userId: actor.id, sessionId: actor.sessionId, summary: 'Usuario existente disponible en su malla de área', after: { userId: user.id, profileId: profile.id, departmentId } } });
    }
  }, { maxWait: 10000, timeout: 30000 });
}
