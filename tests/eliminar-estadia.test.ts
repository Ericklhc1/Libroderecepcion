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
import { resetRoom, softDeleteStay } from '@/server/services/rooms';
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

/**
 * Resetear una habitación atascada por duplicidad.
 *
 * Es la salida cuando la misma reserva aparece dos veces y el mesón no puede
 * confirmar el check-in ni el check-out. Lo importante de estas pruebas es lo
 * que el reseteo NO hace: no borra la habitación, no borra las estadías
 * legítimas, y no inventa una segunda lógica de llaves.
 */
describe('resetear una habitación atascada', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  async function stay(
    roomNumber: string,
    reservationId: string,
    status: RoomStayStatus,
    stage: RoomStayStage = RoomStayStage.PENDIENTE,
  ) {
    const room = await prisma.room.findFirstOrThrow({ where: { number: roomNumber } });
    return prisma.roomStay.create({
      data: {
        roomId: room.id,
        reservationId,
        guestNames: ['Huésped de prueba'],
        status,
        stage,
        businessDate: new Date(2026, 8, 14),
        sourceReport: status === RoomStayStatus.IN_HOUSE ? 'IN_HOUSE' : 'ENTRADAS',
      },
    });
  }

  it('el permiso lo tienen el administrador y el supervisor, y nadie más', () => {
    const conPermiso = Object.entries(ROLE_PERMISSIONS)
      .filter(([, permissions]) => (permissions as readonly string[]).includes('room.reset'))
      .map(([role]) => role)
      .sort();
    expect(conPermiso).toEqual([ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.SUPERVISOR].sort());
  });

  it('colapsa la duplicidad conservando la estadía más avanzada', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const entrada = await stay('405', '900001', RoomStayStatus.CHECK_IN);
    const dentro = await stay('405', '900001', RoomStayStatus.IN_HOUSE, RoomStayStage.CONFIRMADO);

    const result = await resetRoom(supervisor, {
      roomNumber: '405',
      reason: 'No deja confirmar la salida.',
    });

    expect(result.collapsed).toBe(1);
    expect(result.remaining).toBe(1);

    // Sobrevive quien está dentro; la llegada redundante queda eliminada.
    const viva = await prisma.roomStay.findUniqueOrThrow({ where: { id: dentro.id } });
    const muerta = await prisma.roomStay.findUniqueOrThrow({ where: { id: entrada.id } });
    expect(viva.deletedAt).toBeNull();
    expect(muerta.deletedAt).not.toBeNull();
    expect(muerta.deletionReason).toContain('No deja confirmar la salida.');
  });

  it('una salida y una llegada de la misma reserva NO son duplicidad', async () => {
    /*
      Es el caso de la 610: una reserva que sale y vuelve a entrar el mismo
      día. Son dos hechos distintos y el reseteo no debe fusionarlos, porque
      el mesón tiene que hacer las dos cosas.
    */
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await stay('406', '900002', RoomStayStatus.CHECK_OUT);
    await stay('406', '900002', RoomStayStatus.CHECK_IN);

    const result = await resetRoom(supervisor, { roomNumber: '406', reason: 'Revisión.' });

    expect(result.collapsed).toBe(0);
    expect(result.remaining).toBe(2);
  });

  it('dos reservas distintas en la misma habitación se conservan las dos', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await stay('407', '900003', RoomStayStatus.CHECK_OUT);
    await stay('407', '900004', RoomStayStatus.CHECK_IN);

    const result = await resetRoom(supervisor, { roomNumber: '407', reason: 'Revisión.' });

    expect(result.collapsed).toBe(0);
    expect(
      await prisma.roomStay.count({
        where: { room: { number: '407' }, deletedAt: null },
      }),
    ).toBe(2);
  });

  it('sin duplicidad no toca nada, y lo dice', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await stay('409', '900005', RoomStayStatus.IN_HOUSE, RoomStayStage.CONFIRMADO);

    const result = await resetRoom(supervisor, { roomNumber: '409', reason: 'Por si acaso.' });

    expect(result.collapsed).toBe(0);
    expect(result.remaining).toBe(1);
  });

  it('libera la llave huérfana y vuelve a aplicar la regla de la llave', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const entrada = await stay('410', '900006', RoomStayStatus.CHECK_IN);
    await stay('410', '900006', RoomStayStatus.IN_HOUSE, RoomStayStage.CONFIRMADO);

    // La llave había quedado con la estadía equivocada: la redundante.
    const llave = await prisma.roomKey.findFirstOrThrow({
      where: { room: { number: '410' }, type: 'PRINCIPAL' },
    });
    await prisma.roomKey.update({
      where: { id: llave.id },
      data: { stayId: entrada.id, status: KeyStatus.ASIGNADA },
    });

    await resetRoom(supervisor, { roomNumber: '410', reason: 'Llave en la estadía fantasma.' });

    /*
      La llave no queda suelta: `reconcilePrincipalKeys` —la única
      implementación de la regla— la entrega a quien está dentro.
    */
    const despues = await prisma.roomKey.findUniqueOrThrow({ where: { id: llave.id } });
    const dentro = await prisma.roomStay.findFirstOrThrow({
      where: { room: { number: '410' }, deletedAt: null, status: RoomStayStatus.IN_HOUSE },
    });
    expect(despues.stayId).toBe(dentro.id);
    expect(despues.status).toBe(KeyStatus.ASIGNADA);
  });

  it('una habitación que no existe se rechaza', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await expect(
      resetRoom(supervisor, { roomNumber: '999', reason: 'Motivo.' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('queda en la auditoría con el recuento y el motivo', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await stay('411', '900007', RoomStayStatus.CHECK_IN);
    await stay('411', '900007', RoomStayStatus.IN_HOUSE, RoomStayStage.CONFIRMADO);

    await resetRoom(supervisor, { roomNumber: '411', reason: 'Duplicidad del informe.' });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Room', action: 'CONFIGURAR' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.summary).toContain('411');
    expect(log.summary).toContain('1 estadía(s) duplicada(s)');
    expect(log.summary).toContain('Duplicidad del informe.');
  });
});
