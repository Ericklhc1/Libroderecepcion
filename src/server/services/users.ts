import 'server-only';
import { prisma } from '@/lib/prisma';
import { RuleError } from '@/server/errors';
import { ROLE_KEYS } from '@/lib/permissions';

/**
 * Usuarios elegibles para la operación.
 *
 * El Administrador de sistema queda deliberadamente fuera: su rol tiene
 * `operational: false`, por lo que no aparece como responsable, asignado ni en
 * la programación de turnos.
 */
export async function listOperationalUsers() {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      active: true,
      role: { operational: true },
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: { select: { key: true, name: true } },
      department: { select: { id: true, name: true } },
    },
    orderBy: [{ role: { level: 'desc' } }, { name: 'asc' }],
  });
}

/** Valida que un usuario pueda recibir responsabilidad operativa. */
export async function assertAssignable(userId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { active: true, name: true, role: { select: { operational: true, name: true } } },
  });
  if (!user) throw new RuleError('El usuario indicado no existe.');
  if (!user.active) throw new RuleError(`${user.name} está inactivo y no puede recibir asignaciones.`);
  if (!user.role.operational) {
    throw new RuleError(
      `El rol ${user.role.name} está fuera de la operación habitual y no puede figurar como responsable.`,
    );
  }
}

/** Destinatarios de avisos de supervisión (supervisores y auditores activos). */
export async function listSupervisorIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      active: true,
      role: { key: { in: [ROLE_KEYS.SUPERVISOR, ROLE_KEYS.NIGHT_AUDITOR] } },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
