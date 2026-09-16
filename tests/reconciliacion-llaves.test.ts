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
import { reconcilePrincipalKeys } from '@/server/services/keys';
import { getRoomDetail, listRoomsWithState } from '@/server/services/rooms';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Reconciliación del inventario de llaves.
 *
 * Existe por una inconsistencia real de producción: había 75 estadías activas
 * importadas **antes** de que existiera la asignación automática, así que las
 * 101 llaves seguían en el inventario y el tablero no reflejaba la ocupación.
 *
 * La reconciliación no es una segunda lógica: llama a la misma función que la
 * importación, sin acotar el día para alcanzar también lo antiguo.
 */
describe('reconciliación del inventario de llaves', () => {
  let user: CurrentUser;

  /** Reproduce el estado histórico: estadías activas y todas las llaves libres. */
  async function estadoHistorico(options: { businessDate?: Date } = {}) {
    const businessDate = options.businessDate ?? new Date(2026, 8, 15);
    const room = async (number: string) =>
      prisma.room.findFirstOrThrow({ where: { number }, select: { id: true } });

    const stay = async (
      number: string,
      status: RoomStayStatus,
      stage: RoomStayStage,
      reservationId: string,
    ) =>
      prisma.roomStay.create({
        data: {
          businessDate,
          roomId: (await room(number)).id,
          reservationId,
          guestNames: [`Huésped ${reservationId}`],
          status,
          stage,
          sourceReport: 'IN_HOUSE',
        },
        select: { id: true },
      });

    const dentro = await stay('404', RoomStayStatus.IN_HOUSE, RoomStayStage.CONFIRMADO, '7484708');
    // 408: sale sin confirmar y alguien espera. La llave es de quien sale.
    const sale = await stay('408', RoomStayStatus.CHECK_OUT, RoomStayStage.PENDIENTE, '7529545');
    const espera = await stay('408', RoomStayStatus.CHECK_IN, RoomStayStage.PENDIENTE, '7508240');
    // 403: entrada lista sin confirmar, habitación vacía.
    const lista = await stay('403', RoomStayStatus.CHECK_IN, RoomStayStage.PENDIENTE, '7528553');
    // 405: salida ya finalizada.
    const ida = await stay('405', RoomStayStatus.CHECK_OUT, RoomStayStage.FINALIZADO, '7523544');

    // Estado histórico: ninguna llave asignada, ningún movimiento.
    await prisma.roomKey.updateMany({
      data: { status: KeyStatus.DISPONIBLE, stayId: null },
    });
    await prisma.keyMovement.deleteMany();

    return { dentro, sale, espera, lista, ida };
  }

  const reconciliar = (options: { businessDate?: Date } = {}) =>
    prisma.$transaction((tx) =>
      reconcilePrincipalKeys(tx, user, { ...options, note: 'prueba' }),
    );

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('parte del estado histórico y lo deja consistente', async () => {
    const { dentro, sale } = await estadoHistorico();

    const antes = await prisma.roomKey.count({ where: { status: KeyStatus.DISPONIBLE } });
    expect(antes).toBe(101);

    const asignadas = await reconciliar();
    expect(asignadas).toBe(2); // 404 in house + 408 salida pendiente

    // IN_HOUSE confirmado → llave principal asignada
    const r404 = await getRoomDetail('404');
    expect(r404.snapshot.mainKey?.status).toBe(KeyStatus.ASIGNADA);
    expect(r404.snapshot.mainKey?.stayId).toBe(dentro.id);

    // CHECK_OUT pendiente → llave pendiente de devolución, ligada a quien sale
    const r408 = await getRoomDetail('408');
    expect(r408.snapshot.mainKey?.status).toBe(KeyStatus.PENDIENTE_DEVOLUCION);
    expect(r408.snapshot.mainKey?.stayId).toBe(sale.id);
  });

  it('CHECK_IN pendiente se queda con cero llaves', async () => {
    const { espera, lista } = await estadoHistorico();
    await reconciliar();

    // 403: entrada lista, habitación vacía. La llave no sale del inventario.
    const r403 = await getRoomDetail('403');
    expect(r403.snapshot.keysOut).toEqual([]);
    expect(r403.snapshot.mainKey?.status).toBe(KeyStatus.DISPONIBLE);
    expect(r403.snapshot.mainKey?.stayId).toBeNull();

    // 408: quien espera nunca recibe la llave, aunque la habitación sí la tenga fuera.
    const r408 = await getRoomDetail('408');
    expect(r408.snapshot.mainKey?.stayId).not.toBe(espera.id);
    expect(r408.snapshot.mainKey?.stayId).not.toBe(lista.id);
  });

  it('CHECK_OUT finalizado deja la llave liberada', async () => {
    await estadoHistorico();
    await reconciliar();

    const r405 = await getRoomDetail('405');
    expect(r405.snapshot.mainKey?.status).toBe(KeyStatus.DISPONIBLE);
    expect(r405.snapshot.mainKey?.stayId).toBeNull();
    expect(r405.snapshot.keysOut).toEqual([]);
  });

  it('es idempotente: repetirla no escribe nada', async () => {
    await estadoHistorico();
    expect(await reconciliar()).toBe(2);

    const movimientos = await prisma.keyMovement.count();
    expect(await reconciliar()).toBe(0);
    expect(await prisma.keyMovement.count()).toBe(movimientos);
  });

  it('registra un movimiento por llave, con su origen', async () => {
    await estadoHistorico();
    await reconciliar();

    const movimientos = await prisma.keyMovement.findMany({
      select: { action: true, fromStatus: true, toStatus: true, note: true, userId: true },
      orderBy: { at: 'asc' },
    });
    expect(movimientos).toHaveLength(2);
    for (const movimiento of movimientos) {
      expect(movimiento.fromStatus).toBe(KeyStatus.DISPONIBLE);
      expect(movimiento.userId).toBe(user.id);
      expect(movimiento.note).toContain('prueba');
    }
    expect(movimientos.map((m) => m.toStatus).sort()).toEqual(
      [KeyStatus.ASIGNADA, KeyStatus.PENDIENTE_DEVOLUCION].sort(),
    );
  });

  it('no le quita la llave a otra estadía', async () => {
    const { dentro, sale } = await estadoHistorico();
    // Alguien entregó a mano la llave de la 408 a la estadía equivocada.
    const key408 = await prisma.roomKey.findFirstOrThrow({
      where: { code: 'P-408' },
      select: { id: true },
    });
    await prisma.roomKey.update({
      where: { id: key408.id },
      data: { status: KeyStatus.ASIGNADA, stayId: dentro.id },
    });

    await reconciliar();

    const despues = await prisma.roomKey.findUniqueOrThrow({ where: { id: key408.id } });
    expect(despues.stayId).toBe(dentro.id);
    expect(despues.stayId).not.toBe(sale.id);
  });

  it('no asigna una llave extraviada ni una fuera de servicio', async () => {
    await estadoHistorico();
    for (const [code, status] of [
      ['P-404', KeyStatus.EXTRAVIADA],
      ['P-408', KeyStatus.FUERA_DE_SERVICIO],
    ] as const) {
      const key = await prisma.roomKey.findFirstOrThrow({ where: { code } });
      await prisma.roomKey.update({ where: { id: key.id }, data: { status, stayId: null } });
    }

    expect(await reconciliar()).toBe(0);

    for (const [number, status] of [
      ['404', KeyStatus.EXTRAVIADA],
      ['408', KeyStatus.FUERA_DE_SERVICIO],
    ] as const) {
      const room = await getRoomDetail(number);
      expect(room.snapshot.mainKey?.status).toBe(status);
      expect(room.snapshot.mainKey?.stayId).toBeNull();
    }
  });

  it('sin acotar el día alcanza estadías de fechas anteriores', async () => {
    /*
      Es el caso de producción: el lote aplicado era del día anterior. La
      importación acota al día de su lote; la reconciliación no, y por eso
      sirve para arreglar el histórico.
    */
    const ayer = new Date(2026, 8, 14);
    await estadoHistorico({ businessDate: ayer });

    // Acotada al día de hoy no encuentra nada…
    expect(await reconciliar({ businessDate: new Date(2026, 8, 15) })).toBe(0);
    // …y sin acotar, sí.
    expect(await reconciliar()).toBe(2);
  });

  it('ninguna habitación ocupada queda sin llave tras reconciliar', async () => {
    await estadoHistorico();
    await reconciliar();

    const rooms = await listRoomsWithState();
    const ocupadasSinLlave = rooms.filter(
      (room) =>
        (room.snapshot.current || room.snapshot.outgoing) && room.snapshot.keysOut.length === 0,
    );
    expect(ocupadasSinLlave).toEqual([]);
  });
});
