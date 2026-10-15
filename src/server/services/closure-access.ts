import 'server-only';
import type { Prisma } from '@prisma/client';
import { MAINTENANCE_SETTING_KEY } from '@/domain/system-maintenance';
import type { PermissionKey } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError } from '@/server/errors';
import { getMaintenanceState } from '@/server/services/system-maintenance';

/** These are existing permissions, not grants. Ownership and workflow checks still apply. */
export const CLOSURE_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  'shift.handover', 'shift.close', 'shift.receive',
  'cash.count_declare', 'cash.count_receive', 'cash.close',
  'cash.treasury_transfer', 'cash.usd_rate', 'cash.audit', 'cash.guarantee_out',
]);

export async function assertClosureOperation(
  user: Pick<CurrentUser, 'isSystemAdmin'>,
  allowed = false,
): Promise<void> {
  if (user.isSystemAdmin || allowed) return;
  if ((await getMaintenanceState()).closure) {
    throw new RuleError('Estamos finalizando la operación. Continúa únicamente con Caja, custodia y cierre desde Mi turno.');
  }
}

/** Serialize starts against the explicit availability transition, including sysadmin starts. */
export async function assertNewOperationalWorkdayAllowed(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'setting:' + MAINTENANCE_SETTING_KEY}))::text`;
  if ((await getMaintenanceState(tx)).closure) {
    throw new RuleError('La operación está finalizando. No se pueden iniciar turnos ni jornadas nuevas.');
  }
}
