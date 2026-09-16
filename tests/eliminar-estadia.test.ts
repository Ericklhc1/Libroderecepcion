import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyStatus, RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { softDeleteStay } from '@/server/services/rooms';
import { NotFoundError } from '@/server/errors';
import { ROLE_PERMISSIONS } from '@/lib/permissions';

/**
 * Eliminar una estadía es REPARACIÓN, no operación.
 *
 * Existe para desatascar un conflicto de llaves que dejó un estado histórico
 * incoherente —una estadía duplicada, una cargada antes de que una regla
 * existiera—, de modo que nadie tenga que tocar la base a mano. Por eso es del
 * Administrador de sistema y no contradice que quede fuera de la operación
 * habitual: no confirma salidas ni entradas.
 */
describe('eliminar una estadía para resolver conflictos', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  async function seedStay() {
    const room = await prisma.room.findFirstOrThrow({ where: { number: '629' } });
    const stay = await prisma.roomStay.create({
      data: {
        roomId: room.id,
        reservationId: '7528281',
        guestNames: ['Karla Paula Baya'],
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        businessDate: new Date(2026, 8, 14),
        sourceReport: 'IN_HOUSE',
      },
    });
    const key = await prisma.roomKey.findFirstOrThrow({
      where: { roomId: room.id, type: 'PRINCIPAL' },
    });
    await prisma.roomKey.update({
      where: { id: key.id },
      data: { stayId: stay.id, status: KeyStatus.ASIGNADA },
    });
    return { room, stay, keyId: key.id };
  }

  it('el permiso es del Administrador de sistema y de nadie más', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const tiene = (permissions as readonly string[]).includes('stay.delete');
      expect(tiene, `${role} ${tiene ? 'tiene' : 'no tiene'} stay.delete`).toBe(
        role === ROLE_KEYS.SYSTEM_ADMIN,
      );
    }
  });

  it('elimina lógicamente: la fila se conserva con motivo y autor', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const { stay } = await seedStay();

    await softDeleteStay(admin, {
      stayId: stay.id,
      reason: 'Estadía duplicada: la misma reserva llegó en dos informes.',
    });

    // Nada se borra de verdad.
    const after = await prisma.roomStay.findUniqueOrThrow({ where: { id: stay.id } });
    expect(after.deletedAt).not.toBeNull();
    expect(after.deletedById).toBe(admin.id);
    expect(after.deletionReason).toContain('duplicada');
  });

  it('devuelve la llave al inventario: es el conflicto que viene a resolver', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const { stay, keyId } = await seedStay();

    const result = await softDeleteStay(admin, {
      stayId: stay.id,
      reason: 'Conflicto de llave por estadía fantasma.',
    });

    expect(result.releasedKeys).toBe(1);
    const key = await prisma.roomKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(key.stayId).toBeNull();
    expect(key.status).toBe(KeyStatus.DISPONIBLE);
  });

  it('la estadía eliminada desaparece del estado de la habitación', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const { room, stay } = await seedStay();

    await softDeleteStay(admin, { stayId: stay.id, reason: 'Duplicada.' });

    const activas = await prisma.roomStay.count({
      where: { roomId: room.id, deletedAt: null },
    });
    expect(activas).toBe(0);
  });

  it('queda en la auditoría, con la habitación y las llaves liberadas', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const { stay } = await seedStay();

    await softDeleteStay(admin, { stayId: stay.id, reason: 'Duplicada por doble informe.' });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'RoomStay', entityId: stay.id, action: 'ELIMINAR' },
    });
    expect(log.summary).toContain('7528281');
    expect(log.summary).toContain('629');
    expect(log.summary).toContain('1 llave(s) liberada(s)');
    expect(log.summary).toContain('Duplicada por doble informe.');
  });

  it('no se puede eliminar dos veces ni eliminar una estadía inexistente', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const { stay } = await seedStay();

    await softDeleteStay(admin, { stayId: stay.id, reason: 'Primera.' });

    await expect(
      softDeleteStay(admin, { stayId: stay.id, reason: 'Segunda.' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      softDeleteStay(admin, { stayId: 'no-existe', reason: 'Motivo.' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
