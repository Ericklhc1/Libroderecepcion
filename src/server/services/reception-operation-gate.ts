import 'server-only';

import { HandoverStatus, ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isReceptionDeskRole } from '@/lib/permissions';
import { RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

export type ReceptionOperationMode =
  | 'NO_SHIFT'
  | 'HANDOVER_PENDING'
  | 'RECEIVING'
  | 'ACTIVE'
  | 'CLOSING';

export type ReceptionOperationGate = {
  mode: ReceptionOperationMode;
  shiftId: string | null;
  shiftStatus: ShiftStatus | null;
  handoverId: string | null;
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
 * La puerta operativa aplica a todos los perfiles que trabajan en el mesón:
 * Recepcionista y Auditor nocturno. Supervisor y Administrador conservan sus
 * propios flujos de control.
 */
export async function getReceptionOperationGate(
  user: Pick<CurrentUser, 'id' | 'roleKey'>,
): Promise<ReceptionOperationGate> {
  if (!isReceptionDeskRole(user.roleKey)) {
    return { mode: 'ACTIVE', shiftId: null, shiftStatus: null, handoverId: null };
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
    /*
     * Una apertura de emergencia termina la participación activa del saliente
     * para que el nuevo turno pueda operar. Eso NO significa que su cierre
     * desaparezca: si dejó una entrega ENVIADA, debe conservar acceso
     * exclusivamente a Caja/entrega/cierre sin tener que abrir otro turno.
     *
     * Este caso se evalúa antes que una entrega entrante pendiente porque es
     * responsabilidad propia del usuario y evita el callejón sin salida
     * «debes iniciar turno» al intentar cerrar la Caja del turno anterior.
     */
    const pendingOwnClosure = await prisma.shift.findFirst({
      where: {
        status: ShiftStatus.ENTREGA_ENVIADA,
        archivedAt: null,
        assignments: { some: { userId: user.id } },
        handoverOut: {
          is: {
            status: HandoverStatus.ENVIADA,
            receivedAt: null,
          },
        },
      },
      select: {
        id: true,
        status: true,
        handoverOut: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (pendingOwnClosure) {
      return {
        mode: 'CLOSING',
        shiftId: pendingOwnClosure.id,
        shiftStatus: pendingOwnClosure.status,
        handoverId: pendingOwnClosure.handoverOut?.id ?? null,
      };
    }

    const pendingHandover = await prisma.shiftHandover.findFirst({
      where: {
        status: HandoverStatus.ENVIADA,
        receivedAt: null,
        toShiftId: null,
        fromShift: {
          status: ShiftStatus.CERRADO,
          // No filtramos por archivedAt aquí: la pantalla de entrega y
          // getPendingHandover() consideran recepcionable una entrega ENVIADA
          // y no recibida aunque el turno de origen haya sido archivado. El
          // gate debe reconocer exactamente el mismo relevo o la UI muestra
          // formularios que luego responden «Debes iniciar tu turno».
          // La entrega sólo debe bloquear a alguien que realmente pueda
          // recibirla. Cualquier participante del turno saliente está
          // excluido por la regla de recepción y, si lo incluyéramos acá,
          // vería una instrucción imposible: «recibe tu propia entrega».
          assignments: {
            none: { userId: user.id },
          },
        },
      },
      select: { id: true },
    });

    if (pendingHandover) {
      return {
        mode: 'HANDOVER_PENDING',
        shiftId: null,
        shiftStatus: null,
        handoverId: pendingHandover.id,
      };
    }

    return { mode: 'NO_SHIFT', shiftId: null, shiftStatus: null, handoverId: null };
  }

  const status = assignment.shift.status;
  if (status === ShiftStatus.INICIADO) {
    return {
      mode: 'RECEIVING',
      shiftId: assignment.shiftId,
      shiftStatus: status,
      handoverId: null,
    };
  }
  if (
    status === ShiftStatus.PREPARANDO_ENTREGA ||
    status === ShiftStatus.ENTREGA_ENVIADA
  ) {
    return {
      mode: 'CLOSING',
      shiftId: assignment.shiftId,
      shiftStatus: status,
      handoverId: null,
    };
  }
  return {
    mode: 'ACTIVE',
    shiftId: assignment.shiftId,
    shiftStatus: status,
    handoverId: null,
  };
}

function gateMessage(mode: ReceptionOperationMode): string {
  if (mode === 'NO_SHIFT') {
    return 'Debes iniciar tu turno antes de interactuar con la operación.';
  }
  if (mode === 'HANDOVER_PENDING') {
    return 'Hay una entrega cerrada pendiente. Recibe la entrega y recuenta Caja antes de iniciar el turno siguiente.';
  }
  if (mode === 'RECEIVING') {
    return 'Hay una recepción de turno pendiente. Completa la validación desde Mi turno antes de operar.';
  }
  return 'Tu turno está en cierre. Completa Caja, entrega y cierre antes de volver a operar.';
}

export async function assertReceptionOperationPermission(
  user: CurrentUser,
  permission: string,
): Promise<void> {
  if (!isReceptionDeskRole(user.roleKey)) return;

  const gate = await getReceptionOperationGate(user);
  if (gate.mode === 'ACTIVE') return;

  if (gate.mode === 'NO_SHIFT') {
    if (permission === 'shift.start') return;
    throw new RuleError(gateMessage(gate.mode));
  }

  if (gate.mode === 'HANDOVER_PENDING' || gate.mode === 'RECEIVING') {
    if (RECEIVE_ONLY_PERMISSIONS.has(permission)) return;
    throw new RuleError(gateMessage(gate.mode));
  }

  if (CLOSING_PERMISSIONS.has(permission)) return;
  throw new RuleError(gateMessage(gate.mode));
}
