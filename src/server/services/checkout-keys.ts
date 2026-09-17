import 'server-only';

import { AuditAction, KeyAction, KeyStatus, KeyType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';

const KEY_STATUSES_WITH_GUEST: KeyStatus[] = [
  KeyStatus.ASIGNADA,
  KeyStatus.COPIA_ADICIONAL,
  KeyStatus.PENDIENTE_DEVOLUCION,
];

async function stayFamily(stayId: string) {
  const stay = await prisma.roomStay.findFirst({
    where: { id: stayId, deletedAt: null },
    select: {
      id: true,
      reservationId: true,
      roomId: true,
      room: { select: { number: true } },
    },
  });
  if (!stay) throw new NotFoundError('Esa estadía no existe o fue eliminada.');
  if (!stay.roomId) return { stay, stayIds: [stay.id] };

  const siblings = await prisma.roomStay.findMany({
    where: {
      roomId: stay.roomId,
      reservationId: stay.reservationId,
      deletedAt: null,
    },
    select: { id: true },
  });
  return { stay, stayIds: siblings.map((row) => row.id) };
}

/**
 * Cuántas llaves tiene físicamente asociadas la ocupación que se va a cerrar.
 * Incluye la fila CHECK_OUT y cualquier fila IN_HOUSE hermana de la misma
 * reserva/habitación: el PMS puede representar ambas fases por separado.
 */
export async function getCheckoutKeyContext(stayId: string): Promise<{
  count: number;
  codes: string[];
}> {
  const { stayIds } = await stayFamily(stayId);
  const keys = await prisma.roomKey.findMany({
    where: {
      stayId: { in: stayIds },
      status: { in: KEY_STATUSES_WITH_GUEST },
    },
    orderBy: { code: 'asc' },
    select: { code: true },
  });
  return { count: keys.length, codes: keys.map((key) => key.code) };
}

/**
 * Después de confirmar el check-out, `confirmCheckOut` deja las llaves como
 * PENDIENTE_DEVOLUCION. Esta función convierte exactamente la cantidad que el
 * recepcionista confirma haber recibido a DISPONIBLE y conserva el resto como
 * pendiente. La llave principal se considera devuelta primero; después las
 * copias adicionales. Como la interfaz sólo solicita cantidad (regla operativa
 * definida para Recepción), el criterio es determinista y auditable.
 */
export async function resolveCheckoutKeyReturn(
  user: CurrentUser,
  input: { stayId: string; returnedCount: number },
): Promise<{ returned: number; pending: number }> {
  if (!Number.isInteger(input.returnedCount) || input.returnedCount < 0) {
    throw new RuleError('La cantidad de llaves devueltas debe ser un número entero válido.');
  }

  const { stay, stayIds } = await stayFamily(input.stayId);
  const keys = await prisma.roomKey.findMany({
    where: {
      stayId: { in: stayIds },
      status: KeyStatus.PENDIENTE_DEVOLUCION,
    },
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      roomId: true,
      stayId: true,
    },
  });

  if (input.returnedCount > keys.length) {
    throw new RuleError(
      `Se intentaron devolver ${input.returnedCount} llave(s), pero la ocupación tiene ${keys.length} pendiente(s).`,
    );
  }

  const ordered = [...keys].sort((a, b) => {
    if (a.type === KeyType.PRINCIPAL && b.type !== KeyType.PRINCIPAL) return -1;
    if (a.type !== KeyType.PRINCIPAL && b.type === KeyType.PRINCIPAL) return 1;
    return a.code.localeCompare(b.code, 'es');
  });
  const returned = ordered.slice(0, input.returnedCount);

  await prisma.$transaction(async (tx) => {
    for (const key of returned) {
      await tx.roomKey.update({
        where: { id: key.id },
        data: {
          status: KeyStatus.DISPONIBLE,
          stayId: null,
          roomId: key.type === KeyType.PRINCIPAL ? key.roomId : null,
          assignedAt: null,
          assignedById: null,
        },
      });
      await tx.keyMovement.create({
        data: {
          keyId: key.id,
          action: key.type === KeyType.PRINCIPAL ? KeyAction.DEVUELTA : KeyAction.COPIA_RECUPERADA,
          fromStatus: KeyStatus.PENDIENTE_DEVOLUCION,
          toStatus: KeyStatus.DISPONIBLE,
          roomId: key.roomId,
          stayId: key.stayId,
          userId: user.id,
          note: 'Devolución confirmada durante el check-out.',
        },
      });
    }

    await recordAudit(
      {
        entity: 'RoomStay',
        entityId: input.stayId,
        action: AuditAction.CAMBIO_ESTADO,
        summary:
          `Resolución de llaves en check-out hab. ${stay.room?.number ?? 'sin número'}: ` +
          `${returned.length} devuelta(s), ${keys.length - returned.length} pendiente(s).`,
        user,
        after: {
          keysAssignedAtCheckout: keys.length,
          keysReturned: returned.length,
          keysPending: keys.length - returned.length,
        },
      },
      tx,
    );
  });

  return { returned: returned.length, pending: keys.length - returned.length };
}
