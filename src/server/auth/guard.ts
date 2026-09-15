import 'server-only';
import { redirect } from 'next/navigation';
import { AuthError, ForbiddenError } from '@/server/errors';
import type { PermissionKey } from '@/lib/permissions';
import { getCurrentUser, hasPermission, type CurrentUser } from './current-user';

/** Para acciones de servidor: lanza si no hay sesión válida. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

/** Para acciones de servidor: lanza si falta el permiso. */
export async function requirePermission(
  permission: PermissionKey,
): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) {
    throw new ForbiddenError(
      `No tienes el permiso necesario (${permission}) para esta acción.`,
    );
  }
  return user;
}

/** Para páginas: redirige a /login o /sin-permisos en lugar de lanzar. */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requirePagePermission(
  permission: PermissionKey,
): Promise<CurrentUser> {
  const user = await requirePageUser();
  if (!hasPermission(user, permission)) redirect('/sin-permisos');
  return user;
}
