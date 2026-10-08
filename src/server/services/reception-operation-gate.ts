import 'server-only';

import { HandoverStatus, ShiftStatus, type Prisma } from '@prisma/client';
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
  client: Prisma.TransactionClient = prisma,
): Promise<ReceptionOperationGate> {
  if (!isReceptionDeskRole(user.roleKey)) {
    return { mode: 'ACTIVE', shiftId: null, shiftStatus: null, handoverId: null };
  }

  const assignment = await client.shiftAssignment.findFirst({
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
    const pendingOwnClosure = await client.shift.findFirst({
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

    const pendingHandover = await client.shiftHandover.findFirst({
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
          // Una entrega cerrada pendiente bloquea por igual a cualquier
          // recepcionista autorizado que vaya a continuar la operación, aunque
          // también haya participado en el turno saliente. La participación
          // anterior ya terminó con el cierre; el siguiente turno conserva su
          // propio inicio, recuento y trazabilidad.
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

/** Physical cash return is the only general-Caja exception while preparing a handover. */
export async function assertReceptionCashGuaranteeReturn(
  user: CurrentUser,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (!isReceptionDeskRole(user.roleKey)) return;
  const gate = await getReceptionOperationGate(user, client);
  if (
    gate.mode === 'ACTIVE' ||
    (gate.mode === 'CLOSING' && gate.shiftStatus === ShiftStatus.PREPARANDO_ENTREGA)
  ) return;
  throw new RuleError(gateMessage(gate.mode));
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

export async function authorizeReceptionOperation(
  user: CurrentUser,
  permission: string,
  client: Prisma.TransactionClient = prisma,
): Promise<ReceptionOperationGate> {
  const gate = await getReceptionOperationGate(user, client);
  if (gate.mode === 'ACTIVE') return gate;

  if (gate.mode === 'NO_SHIFT') {
    if (permission === 'shift.start') return gate;
    throw new RuleError(gateMessage(gate.mode));
  }

  if (gate.mode === 'HANDOVER_PENDING' || gate.mode === 'RECEIVING') {
    if (RECEIVE_ONLY_PERMISSIONS.has(permission)) return gate;
    throw new RuleError(gateMessage(gate.mode));
  }

  if (CLOSING_PERMISSIONS.has(permission)) return gate;
  throw new RuleError(gateMessage(gate.mode));
}

/** Existing assertion contract delegates to the same authorization snapshot. */
export async function assertReceptionOperationPermission(user:CurrentUser,permission:string,client:Prisma.TransactionClient=prisma):Promise<void>{
  await authorizeReceptionOperation(user,permission,client);
}
