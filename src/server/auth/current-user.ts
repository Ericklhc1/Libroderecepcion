import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE, readSessionToken } from './session';
import type { PermissionKey } from '@/lib/permissions';
import { ROLE_KEYS } from '@/lib/permissions';

export type CurrentUser = {
  id: string;
  name: string;
  sessionId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleLevel: number;
  roleOperational: boolean;
  departmentId: string | null;
  mustChangePassword: boolean;
  permissions: PermissionKey[];
  isSystemAdmin: boolean;
};

/**
 * Usuario de la petición actual. Memoizado por petición con `cache()` para no
 * repetir la consulta en cada componente de servidor.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const payload = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await prisma.user.findFirst({
    where: { id: payload.sub, active: true, deletedAt: null },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    sessionId: payload.sid,
    roleId: user.roleId,
    roleKey: user.role.key,
    roleName: user.role.name,
    roleLevel: user.role.level,
    roleOperational: user.role.operational,
    departmentId: user.departmentId,
    mustChangePassword: user.mustChangePassword,
    permissions: user.role.permissions.map(
      (rp) => rp.permission.key as PermissionKey,
    ),
    isSystemAdmin: user.role.key === ROLE_KEYS.SYSTEM_ADMIN,
  };
});

export function hasPermission(
  user: Pick<CurrentUser, 'permissions'> | null,
  permission: PermissionKey,
): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function hasAnyPermission(
  user: Pick<CurrentUser, 'permissions'> | null,
  permissions: PermissionKey[],
): boolean {
  if (!user) return false;
  return permissions.some((p) => user.permissions.includes(p));
}
