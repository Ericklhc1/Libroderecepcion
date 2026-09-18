import 'server-only';
import { redirect } from 'next/navigation';
import { AuthError, ForbiddenError } from '@/server/errors';
import type { PermissionKey } from '@/lib/permissions';
import { getCurrentUser, hasPermission, type CurrentUser } from './current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';

/** Autenticación pura para los flujos previos al acceso: contraseña y términos. */
export async function requireAuthenticatedUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

/**
 * Para acciones operativas: además de sesión válida exige completar los
 * requisitos de primer acceso. Esto evita saltarse la pantalla llamando una
 * Server Action directamente.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await requireAuthenticatedUser();
  if (user.mustChangePassword) {
    throw new ForbiddenError('Debes definir tu contraseña personal antes de continuar.');
  }
  if (!(await hasAcceptedCurrentTerms(user.id))) {
    throw new ForbiddenError('Debes aceptar los términos vigentes antes de utilizar el Libro.');
  }
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

/**
 * Permite la acción a quien tiene el permiso, O a quien es responsable del
 * registro concreto.
 *
 * Existe por el rol de Gerencia: sólo consulta, salvo sobre aquello de lo que
 * se le asignó como responsable. Eso no se puede conceder con un permiso
 * —sería un permiso sobre todos los registros— así que se comprueba la
 * propiedad del registro que se está tocando.
 *
 * El orden importa: primero el permiso, y sólo si falta se va a la base a
 * cargar el registro. Quien tiene el permiso no paga una consulta extra.
 *
 * `ownerIds` son los identificadores que cuentan como «responsable». Se pasa
 * una lista porque un registro puede tener más de uno —la tarea tiene
 * asignado, la incidencia tiene responsable— y porque un nulo no es dueño de
 * nada: los nulos se descartan acá y no en cada llamada.
 */
export async function requirePermissionOrOwner(
  permission: PermissionKey,
  loadOwnerIds: () => Promise<Array<string | null | undefined>>,
): Promise<CurrentUser> {
  const user = await requireUser();
  if (hasPermission(user, permission)) return user;

  const ownerIds = await loadOwnerIds();
  if (ownerIds.some((id) => id && id === user.id)) return user;

  throw new ForbiddenError(
    `No tienes el permiso necesario (${permission}) y no eres el responsable de este registro.`,
  );
}

/**
 * Para páginas: redirige antes de que la página empiece a cargar servicios
 * operativos. Next puede renderizar layout y page en paralelo; por eso la
 * puerta de primer acceso no puede vivir sólo en el layout.
 *
 * `allowIncompleteAccess` se usa exclusivamente en las dos pantallas previas
 * al acceso operativo: cambiar contraseña y aceptar términos.
 */
export async function requirePageUser(
  options: { allowIncompleteAccess?: boolean } = {},
): Promise<CurrentUser> {
  const user = await requireAuthenticatedUser().catch(() => null);
  if (!user) redirect('/login');

  if (!options.allowIncompleteAccess) {
    if (user.mustChangePassword) redirect('/cambiar-contrasena');
    if (!(await hasAcceptedCurrentTerms(user.id))) redirect('/aceptar-terminos');
  }

  return user;
}

export async function requirePagePermission(
  permission: PermissionKey,
): Promise<CurrentUser> {
  const user = await requirePageUser();
  if (!hasPermission(user, permission)) redirect('/sin-permisos');
  return user;
}

/**
 * Basta uno de los permisos para entrar.
 *
 * Se usa donde una pantalla la miran roles distintos por motivos distintos:
 * quien consulta y quien edita. Antes ver la ficha de un huésped exigía el
 * permiso de EDITARLO, así que un rol de sólo lectura no podía ni mirar.
 * La pantalla decide después qué botones muestra.
 */
export async function requirePageAnyPermission(
  permissions: PermissionKey[],
): Promise<CurrentUser> {
  const user = await requirePageUser();
  if (!permissions.some((permission) => hasPermission(user, permission))) {
    redirect('/sin-permisos');
  }
  return user;
}
