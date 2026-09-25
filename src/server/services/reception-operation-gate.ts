import 'server-only';

import { ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

export type ReceptionOperationMode =
  | 'NO_SHIFT'
  | 'RECEIVING'
  | 'ACTIVE'
  | 'CLOSING';

export type ReceptionOperationGate = {
  mode: ReceptionOperationMode;
  shiftId: string | null;
  shiftStatus: ShiftStatus | null;
};

const SESSION_STATUSES: ShiftStatus[] = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
  ShiftStatus.ENTREGA_ENVIADA,
];

const RECEIVE_ONLY_PERMISSIONS = new Set([
  'shift.receive',
  'cash.count_receive',
]);

const CLOSING_PERMISSIONS = new Set([
  'shift.handover',
  'shift.close',
  'cash.count_declare',
  'cash.treasury_transfer',
  'cash.usd_rate',
  'cash.close',
]);

/**
 * La puerta operativa sólo aplica al rol Recepcionista.
 * Supervisor y Administrador conservan sus propios flujos de control.
 */
export async function getReceptionOperationGate(
  user: Pick<CurrentUser, 'id' | 'roleKey'>,
): Promise<ReceptionOperationGate> {
  if (user.roleKey !== ROLE_KEYS.RECEPTIONIST) {
    return { mode: 'ACTIVE', shiftId: null, shiftStatus: null };
  }

  const assignment = await prisma.shiftAssignment.findFirst({
    where: {
      userId: user.id,
      activatedAt: { not: null },
      leftAt: null,
      shift: {
        status: { in: SESSION_STATUSES },
        archivedAt: null,
      },
    },
    select: {
      shiftId: true,
      shift: { select: { status: true } },
    },
    orderBy: { activatedAt: 'desc' },
  });

  if (!assignment) {
    return { mode: 'NO_SHIFT', shiftId: null, shiftStatus: null };
  }

  const status = assignment.shift.status;
  if (status === ShiftStatus.INICIADO) {
    return { mode: 'RECEIVING', shiftId: assignment.shiftId, shiftStatus: status };
  }
  if (
    status === ShiftStatus.PREPARANDO_ENTREGA ||
    status === ShiftStatus.ENTREGA_ENVIADA
  ) {
    return { mode: 'CLOSING', shiftId: assignment.shiftId, shiftStatus: status };
  }
  return { mode: 'ACTIVE', shiftId: assignment.shiftId, shiftStatus: status };
}

function gateMessage(mode: ReceptionOperationMode): string {
  if (mode === 'NO_SHIFT') {
    return 'Debes iniciar tu turno antes de interactuar con la operación.';
  }
  if (mode === 'RECEIVING') {
    return 'Tu turno está iniciado pero aún no está recibido. Recuenta Caja y confirma la recepción antes de operar.';
  }
  return 'Tu turno está en cierre. Completa Caja, entrega y cierre antes de volver a operar.';
}

export async function assertReceptionOperationPermission(
  user: CurrentUser,
  permission: string,
): Promise<void> {
  if (user.roleKey !== ROLE_KEYS.RECEPTIONIST) return;

  const gate = await getReceptionOperationGate(user);
  if (gate.mode === 'ACTIVE') return;

  if (gate.mode === 'NO_SHIFT') {
    if (permission === 'shift.start') return;
    throw new RuleError(gateMessage(gate.mode));
  }

  if (gate.mode === 'RECEIVING') {
    if (RECEIVE_ONLY_PERMISSIONS.has(permission)) return;
    throw new RuleError(gateMessage(gate.mode));
  }

  if (CLOSING_PERMISSIONS.has(permission)) return;
  throw new RuleError(gateMessage(gate.mode));
}
