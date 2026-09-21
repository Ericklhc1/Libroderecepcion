import { KeyStatus, PmsImportStatus, RoomStayStage, RoomStayStatus } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { applyImport, summarizeActivity } from '@/server/services/pms-import';
import { buildRoomSnapshot } from '@/domain/rooms';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Importar «Habitaciones con actividad».
 *
 * Las pruebas llaman a `applyImport` de verdad: arman el lote con su carga y
 * lo aplican, igual que hace la pantalla tras confirmar. Lo único que se saltan
 * es la lectura del PDF, que se prueba aparte en `pms-actividad.test.ts` contra
 * la geometría real del informe.
 *
 * Lo que se cuida acá es la línea que separa las dos verdades: FNS aporta
 * contexto del PMS y el Libro conserva sus procesos. Una importación no puede
 * devolver una llave, resolver una garantía ni dar por cerrada una salida.
 */

let user: CurrentUser;
let businessDate: Date;

/** Un borrador de estancia tal como lo deja el lector del informe. */
function draft(input: {
  reservationId: string;
  externalId?: string | null;
  roomNumber: string;
  status: RoomStayStatus | null;
  guestNames?: string[];
  channel?: string;
  arrival?: string;
  departure?: string;
  guestCount?: number | null;
  total?: number | null;
  pending?: number | null;
  currency?: 'CLP' | 'USD' | null;
  paymentType?: string | null;
  paymentTypeRaw?: string | null;
  pmsStatus?: string;
  issues?: string[];
}) {
  return {
    reservationId: input.reservationId,
    externalId: input.externalId ?? null,
    roomNumber: input.roomNumber,
    guestNames: input.guestNames ?? ['Huésped Ejemplo'],
    channel: input.channel ?? 'Booking',
    arrivalDate: input.arrival ? new Date(input.arrival).toISOString() : null,
    departureDate: input.departure ? new Date(input.departure).toISOString() : null,
    pmsStatus: input.pmsStatus ?? null,
    sourceReport: 'ACTIVIDAD' as const,
    status: input.status,
    guestCount: input.guestCount ?? null,
    totalAmount: input.total ?? null,
    pendingAmount: input.pending ?? null,
    currency: input.currency ?? null,
    paymentType: input.paymentType ?? null,
    paymentTypeRaw: input.paymentTypeRaw ?? null,
    issues: input.issues ?? [],
  };
}

type Draft = ReturnType<typeof draft>;

/** Crea el lote en BORRADOR, como lo deja `prepareImport`. */
async function batchWith(drafts: Draft[]) {
  const batch = await prisma.pmsImportBatch.create({
    data: {
      businessDate,
      status: PmsImportStatus.BORRADOR,
      reports: [],
      payload: drafts,
      summary: {},
      createdById: user.id,
    },
    select: { id: true },
  });
  return batch.id;
}

async function importar(drafts: Draft[]) {
  return applyImport(user, await batchWith(drafts));
}

async function staysOf(roomNumber: string) {
  return prisma.roomStay.findMany({
    where: { room: { number: roomNumber }, deletedAt: null },
    orderBy: { reservationId: 'asc' },
  });
}

async function snapshotOf(roomNumber: string) {
  const room = await prisma.room.findFirstOrThrow({
    where: { number: roomNumber },
    include: {
      stays: { where: { deletedAt: null, stage: { not: RoomStayStage.FINALIZADO } } },
      keys: true,
    },
  });
  return buildRoomSnapshot(
    room.stays.map((stay) => ({
      id: stay.id,
      reservationId: stay.reservationId,
      guestNames: stay.guestNames,
      status: stay.status,
      stage: stay.stage,
      arrivalDate: stay.arrivalDate,
      departureDate: stay.departureDate,
      channel: stay.channel,
    })),
    room.keys.map((key) => ({
      id: key.id,
      code: key.code,
      type: key.type,
      status: key.status,
      stayId: key.stayId,
    })),
  );
}

beforeAll(async () => {
  await resetOperationalData();
  await resetRoomsAndKeys();
  await seedCatalog();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetOperationalData();
  user = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
  businessDate = new Date('2026-09-16T00:00:00.000Z');
});

describe('los tres tipos de actividad', () => {
  it('una habitación ocupada queda dentro y con su llave', async () => {
    await importar([
      draft({
        reservationId: '7000001',
        roomNumber: '404',
        status: RoomStayStatus.IN_HOUSE,
        guestCount: 2,
        total: 916300,
        pending: 0,
        currency: 'CLP',
        paymentType: 'AL_HOTEL',
        paymentTypeRaw: 'Al Hotel',
      }),
    ]);

    const snapshot = await snapshotOf('404');
    expect(snapshot.state).toBe('OCUPADA');
    expect(snapshot.current?.reservationId).toBe('7000001');
    // La llave principal queda asignada a quien está dentro: es un hecho
    // físico, no una decisión del mesón.
    expect(snapshot.mainKey?.status).toBe(KeyStatus.ASIGNADA);
  });

  it('una llegada queda lista para check-in, SIN llave', async () => {
    await importar([
      draft({ reservationId: '7000002', roomNumber: '405', status: RoomStayStatus.CHECK_IN }),
    ]);

    const snapshot = await snapshotOf('405');
    expect(snapshot.state).toBe('CHECK_IN_LISTO');
    /*
      Que el informe diga «Check-in» significa que hay una llegada esperada, no
      que el check-in esté hecho. Nadie recibe llave hasta que una persona lo
      confirme en el Libro.
    */
    expect(snapshot.mainKey?.stayId).toBeNull();
    expect(snapshot.incoming?.stage).toBe(RoomStayStage.PENDIENTE);
  });

  it('una salida queda pendiente de confirmar, conservando la llave', async () => {
    await importar([
      draft({ reservationId: '7000003', roomNumber: '406', status: RoomStayStatus.CHECK_OUT }),
    ]);

    const snapshot = await snapshotOf('406');
    expect(snapshot.state).toBe('CHECK_OUT_PENDIENTE');
    /*
      Que el informe diga «Check-out» significa que hay una salida que
      corresponde a hoy, no una salida cerrada. La llave sigue fuera y hay que
      recuperarla: el Libro no la devuelve solo.
    */
    expect(snapshot.mainKey?.status).toBe(KeyStatus.PENDIENTE_DEVOLUCION);
  });

  it('un tipo incierto queda como excepción y no se aplica', async () => {
    const result = await importar([
      draft({
        reservationId: '7000004',
        roomNumber: '408',
        status: null,
        pmsStatus: 'Pendiente de asignar',
        issues: ['El tipo de actividad «Pendiente de asignar» no se reconoce.'],
      }),
    ]);

    expect(result.skipped).toBe(1);
    expect(await staysOf('408')).toHaveLength(0);
  });
});

describe('salida y entrada en la misma habitación el mismo día', () => {
  const cola = () => [
    draft({
      reservationId: '7525612',
      roomNumber: '407',
      status: RoomStayStatus.CHECK_OUT,
      guestCount: 2,
      total: 60703,
      pending: 0,
      currency: 'CLP',
    }),
    draft({
      reservationId: '7532338',
      roomNumber: '407',
      status: RoomStayStatus.CHECK_IN,
      total: 53.98,
      pending: 53.98,
      currency: 'USD',
    }),
  ];

  it('produce DOS estancias y las pone en cola', async () => {
    await importar(cola());

    const stays = await staysOf('407');
    expect(stays).toHaveLength(2);

    const snapshot = await snapshotOf('407');
    expect(snapshot.outgoing?.reservationId).toBe('7525612');
    expect(snapshot.incoming?.reservationId).toBe('7532338');
    // La entrante espera: no puede ocupar mientras la salida siga sin cerrar.
    expect(snapshot.incomingState).toBe('EN_COLA');
    expect(snapshot.state).toBe('PENDIENTE_LIBERACION');
  });

  it('la llave se queda con la saliente, no con la entrante', async () => {
    await importar(cola());

    const snapshot = await snapshotOf('407');
    expect(snapshot.mainKey?.status).toBe(KeyStatus.PENDIENTE_DEVOLUCION);
    expect(snapshot.mainKey?.stayId).toBe(snapshot.outgoing?.id);
  });

  it('la cola es idempotente: reimportar no la altera', async () => {
    await importar(cola());
    const antes = await snapshotOf('407');

    const segunda = await importar(cola());

    const stays = await staysOf('407');
    expect(stays).toHaveLength(2);
    // Segunda pasada: nada nuevo y ninguna escritura de estancia.
    expect(segunda.created).toBe(0);
    expect(segunda.updated).toBe(0);
    expect(segunda.unchanged).toBe(2);

    const despues = await snapshotOf('407');
    expect(despues.state).toBe(antes.state);
    expect(despues.outgoing?.id).toBe(antes.outgoing?.id);
    expect(despues.incoming?.id).toBe(antes.incoming?.id);
    expect(despues.mainKey?.stayId).toBe(antes.mainKey?.stayId);
  });
});

describe('una reserva en varias habitaciones', () => {
  /*
    En el informe real una sola reserva ocupa ocho habitaciones, con importes y
    saldos distintos en cada una. Por eso el saldo pertenece a la estancia: una
    puede tener saldo cero y otra de la misma reserva no.
  */
  const enOchoMenosCinco = () => [
    draft({
      reservationId: '7484708',
      roomNumber: '404',
      status: RoomStayStatus.IN_HOUSE,
      total: 916300,
      pending: 0,
      currency: 'CLP',
    }),
    draft({
      reservationId: '7484708',
      roomNumber: '409',
      status: RoomStayStatus.IN_HOUSE,
      total: 931300,
      pending: 15000,
      currency: 'CLP',
    }),
    draft({
      reservationId: '7484708',
      roomNumber: '410',
      status: RoomStayStatus.IN_HOUSE,
      total: 811580,
      pending: 0,
      currency: 'CLP',
    }),
  ];

  it('crea una estancia por habitación, sin duplicar la reserva', async () => {
    await importar(enOchoMenosCinco());

    const stays = await prisma.roomStay.findMany({
      where: { reservationId: '7484708', deletedAt: null },
      include: { room: { select: { number: true } } },
      orderBy: { room: { number: 'asc' } },
    });
    expect(stays).toHaveLength(3);
    expect(stays.map((s) => s.room?.number)).toEqual(['404', '409', '410']);
  });

  it('cada habitación conserva SU saldo', async () => {
    await importar(enOchoMenosCinco());

    const stays = await prisma.roomStay.findMany({
      where: { reservationId: '7484708', deletedAt: null },
      include: { room: { select: { number: true } } },
      orderBy: { room: { number: 'asc' } },
    });
    expect(stays.map((s) => Number(s.pendingAmount))).toEqual([0, 15000, 0]);
    expect(stays.map((s) => s.currency)).toEqual(['CLP', 'CLP', 'CLP']);
  });
});

describe('importes y forma de pago', () => {
  it('guarda el saldo en pesos con su moneda', async () => {
    await importar([
      draft({
        reservationId: '7000010',
        roomNumber: '517',
        status: RoomStayStatus.CHECK_IN,
        total: 117622,
        pending: 117622,
        currency: 'CLP',
      }),
    ]);
    const [stay] = await staysOf('517');
    expect(Number(stay!.pendingAmount)).toBe(117622);
    expect(stay!.currency).toBe('CLP');
  });

  it('guarda el saldo en dólares con sus centavos', async () => {
    await importar([
      draft({
        reservationId: '7000011',
        roomNumber: '418',
        status: RoomStayStatus.CHECK_IN,
        total: 57.2,
        pending: 57.2,
        currency: 'USD',
      }),
    ]);
    const [stay] = await staysOf('418');
    expect(Number(stay!.pendingAmount)).toBeCloseTo(57.2, 2);
    expect(stay!.currency).toBe('USD');
  });

  it('las tres formas de pago se guardan normalizadas y con su texto', async () => {
    await importar([
      draft({
        reservationId: '7000020',
        roomNumber: '401',
        status: RoomStayStatus.IN_HOUSE,
        paymentType: 'AL_HOTEL',
        paymentTypeRaw: 'Al Hotel',
      }),
      draft({
        reservationId: '7000021',
        roomNumber: '402',
        status: RoomStayStatus.IN_HOUSE,
        paymentType: 'PREPAGO_COMISION',
        paymentTypeRaw: 'Prepago Comision',
      }),
      draft({
        reservationId: '7000022',
        roomNumber: '403',
        status: RoomStayStatus.IN_HOUSE,
        paymentType: 'CREDITO_EMPRESA',
        paymentTypeRaw: 'Credito Empresa',
      }),
    ]);

    const [a] = await staysOf('401');
    const [b] = await staysOf('402');
    const [c] = await staysOf('403');
    expect([a!.paymentType, b!.paymentType, c!.paymentType]).toEqual([
      'AL_HOTEL',
      'PREPAGO_COMISION',
      'CREDITO_EMPRESA',
    ]);
    // El texto original se conserva: de esto depende si el mesón cobra.
    expect([a!.paymentTypeRaw, b!.paymentTypeRaw, c!.paymentTypeRaw]).toEqual([
      'Al Hotel',
      'Prepago Comision',
      'Credito Empresa',
    ]);
  });
});

describe('la importación NO pisa el estado operativo del Libro', () => {
  it('no pierde las llaves al reimportar', async () => {
    await importar([
      draft({ reservationId: '7000030', roomNumber: '404', status: RoomStayStatus.IN_HOUSE }),
    ]);
    const antes = await snapshotOf('404');
    expect(antes.mainKey?.status).toBe(KeyStatus.ASIGNADA);

    await importar([
      draft({ reservationId: '7000030', roomNumber: '404', status: RoomStayStatus.IN_HOUSE }),
    ]);

    const despues = await snapshotOf('404');
    expect(despues.mainKey?.id).toBe(antes.mainKey?.id);
    expect(despues.mainKey?.status).toBe(KeyStatus.ASIGNADA);
    expect(despues.mainKey?.stayId).toBe(antes.mainKey?.stayId);
  });

  it('no pierde las garantías al reimportar', async () => {
    await importar([
      draft({ reservationId: '7000031', roomNumber: '405', status: RoomStayStatus.IN_HOUSE }),
    ]);

    const reference = await prisma.reservationReference.create({
      data: { code: '7000031', roomNumber: '405' },
      select: { id: true },
    });
    const guarantee = await prisma.guarantee.create({
      data: {
        reservationReferenceId: reference.id,
        kind: 'EFECTIVO',
        state: 'VIGENTE',
        amount: 50000,
        currency: 'CLP',
        createdById: user.id,
      },
      select: { id: true, state: true },
    });

    await importar([
      draft({ reservationId: '7000031', roomNumber: '405', status: RoomStayStatus.CHECK_OUT }),
    ]);

    /*
      Que FNS declare la salida no significa que la garantía esté resuelta. La
      importación no la toca: sigue retenida hasta que alguien la devuelva en
      el Libro.
    */
    const after = await prisma.guarantee.findUniqueOrThrow({ where: { id: guarantee.id } });
    expect(after.state).toBe('VIGENTE');
  });

  it('una estancia confirmada a mano no se deshace', async () => {
    await importar([
      draft({ reservationId: '7000032', roomNumber: '406', status: RoomStayStatus.CHECK_IN }),
    ]);

    // Alguien confirma el check-in en el Libro.
    const [stay] = await staysOf('406');
    await prisma.roomStay.update({
      where: { id: stay!.id },
      data: { stage: RoomStayStage.CONFIRMADO, touchedManually: true },
    });

    const result = await importar([
      draft({ reservationId: '7000032', roomNumber: '406', status: RoomStayStatus.CHECK_IN }),
    ]);

    // Informe idéntico: no se escribió nada, y el avance manual sigue en pie.
    expect(result.unchanged).toBe(1);
    const [after] = await staysOf('406');
    expect(after!.stage).toBe(RoomStayStage.CONFIRMADO);
    expect(after!.touchedManually).toBe(true);
  });

  it('el estado avanza, nunca retrocede', async () => {
    await importar([
      draft({ reservationId: '7000033', roomNumber: '409', status: RoomStayStatus.IN_HOUSE }),
    ]);

    // Un informe que vuelve a listarla como llegada no puede mandarla atrás:
    // le quitaría la llave a quien está dentro.
    await importar([
      draft({ reservationId: '7000033', roomNumber: '409', status: RoomStayStatus.CHECK_IN }),
    ]);

    const stays = await staysOf('409');
    expect(stays).toHaveLength(1);
    expect(stays[0]!.status).toBe(RoomStayStatus.IN_HOUSE);
  });

  it('no reemplaza la estancia en curso de una habitación', async () => {
    await importar([
      draft({ reservationId: '7239753', roomNumber: '405', status: RoomStayStatus.IN_HOUSE }),
    ]);
    const antes = await snapshotOf('405');

    // Llega una entrada para la misma habitación: se pone en cola, no sustituye.
    await importar([
      draft({ reservationId: '7999999', roomNumber: '405', status: RoomStayStatus.CHECK_IN }),
    ]);

    const despues = await snapshotOf('405');
    expect(despues.current?.id).toBe(antes.current?.id);
    expect(despues.current?.reservationId).toBe('7239753');
    expect(despues.incoming?.reservationId).toBe('7999999');
    expect(despues.incomingState).toBe('EN_COLA');
  });
});

describe('conciliación de una misma estancia entre informes', () => {
  const occurrence = (status: RoomStayStatus) =>
    draft({
      reservationId: '7100001',
      externalId: 'LOC-7100001',
      roomNumber: '416',
      status,
      guestNames: ['Ana Pérez'],
      arrival: '2026-09-16T00:00:00.000Z',
      departure: '2026-09-18T00:00:00.000Z',
    });

  it('CHECK_IN → IN_HOUSE → CHECK_OUT actualiza una sola RoomStay', async () => {
    await importar([occurrence(RoomStayStatus.CHECK_IN)]);
    await importar([occurrence(RoomStayStatus.IN_HOUSE)]);
    await importar([occurrence(RoomStayStatus.CHECK_OUT)]);

    const stays = await staysOf('416');
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({
      reservationId: '7100001',
      externalId: 'LOC-7100001',
      status: RoomStayStatus.CHECK_OUT,
      stage: RoomStayStage.PENDIENTE,
    });
    expect((await snapshotOf('416')).state).toBe('CHECK_OUT_PENDIENTE');
  });

  it('tres informes en un mismo lote se concilian antes de escribir', async () => {
    const result = await importar([
      occurrence(RoomStayStatus.CHECK_IN),
      occurrence(RoomStayStatus.IN_HOUSE),
      occurrence(RoomStayStatus.CHECK_OUT),
    ]);

    expect(result.created).toBe(1);
    const stays = await staysOf('416');
    expect(stays).toHaveLength(1);
    expect(stays[0]!.status).toBe(RoomStayStatus.CHECK_OUT);
  });

  it('informes cargados en orden inverso no crean ni retroceden la estancia', async () => {
    await importar([occurrence(RoomStayStatus.CHECK_OUT)]);
    await importar([occurrence(RoomStayStatus.IN_HOUSE)]);
    await importar([occurrence(RoomStayStatus.CHECK_IN)]);

    const stays = await staysOf('416');
    expect(stays).toHaveLength(1);
    expect(stays[0]!.status).toBe(RoomStayStatus.CHECK_OUT);
  });

  it('una extensión posterior reabre la salida pendiente sin duplicarla', async () => {
    await importar([occurrence(RoomStayStatus.CHECK_OUT)]);
    businessDate = new Date('2026-09-17T00:00:00.000Z');
    const extended = occurrence(RoomStayStatus.IN_HOUSE);
    extended.departureDate = new Date('2026-09-20T00:00:00.000Z').toISOString();

    await importar([extended]);

    const stays = await staysOf('416');
    expect(stays).toHaveLength(1);
    expect(stays[0]!.status).toBe(RoomStayStatus.IN_HOUSE);
    expect(stays[0]!.departureDate).toEqual(new Date('2026-09-20T00:00:00.000Z'));
  });

  it('identificadores incompatibles omiten la fila y conservan el estado vigente', async () => {
    await importar([occurrence(RoomStayStatus.IN_HOUSE)]);
    const contradictory = occurrence(RoomStayStatus.CHECK_OUT);
    contradictory.externalId = 'OTRO-LOCALIZADOR';

    const result = await importar([contradictory]);

    expect(result.skipped).toBe(1);
    const stays = await staysOf('416');
    expect(stays).toHaveLength(1);
    expect(stays[0]!.status).toBe(RoomStayStatus.IN_HOUSE);
  });
});

describe('idempotencia', () => {
  const informe = () => [
    draft({
      reservationId: '7000040',
      roomNumber: '404',
      status: RoomStayStatus.IN_HOUSE,
      guestCount: 2,
      total: 916300,
      pending: 0,
      currency: 'CLP',
      paymentType: 'AL_HOTEL',
      paymentTypeRaw: 'Al Hotel',
    }),
    draft({
      reservationId: '7000041',
      roomNumber: '407',
      status: RoomStayStatus.CHECK_OUT,
      total: 60703,
      pending: 0,
      currency: 'CLP',
    }),
    draft({
      reservationId: '7000042',
      roomNumber: '407',
      status: RoomStayStatus.CHECK_IN,
      total: 53.98,
      pending: 53.98,
      currency: 'USD',
    }),
  ];

  it('el mismo informe dos veces no crea nada nuevo', async () => {
    const primera = await importar(informe());
    expect(primera.created).toBe(3);

    const segunda = await importar(informe());
    expect(segunda.created).toBe(0);
    /*
      Cero escrituras, no «cero filas nuevas». Los importes entran en la
      comparación: sin ellos, la segunda pasada reescribiría las tres filas
      cada vez y el historial se llenaría de cambios que no cambian nada.
    */
    expect(segunda.updated).toBe(0);

    expect(await prisma.roomStay.count({ where: { deletedAt: null } })).toBe(3);
  });

  it('un saldo corregido en el PMS sí llega', async () => {
    await importar(informe());

    const corregido = informe();
    corregido[0]!.pendingAmount = 15000;
    const result = await importar(corregido);

    /*
      Se escribió: no cuenta como «sin cambios». Va a `preserved` y no a
      `updated` porque la fila in-house tiene `stage CONFIRMADO`, es decir su
      avance ya estaba asentado — y eso es justo lo que el contador dice: se
      actualizó lo descriptivo respetando el avance.
    */
    expect(result.unchanged).toBe(2);
    expect(result.preserved + result.updated).toBe(1);
    const [stay] = await staysOf('404');
    expect(Number(stay!.pendingAmount)).toBe(15000);
  });

  it('no duplica llaves', async () => {
    const antes = await prisma.roomKey.count();
    await importar(informe());
    await importar(informe());
    expect(await prisma.roomKey.count()).toBe(antes);
  });
});

describe('el resumen que se confirma antes de aplicar', () => {
  /*
    Cifras del informe real: 53 habitaciones, 19 ocupadas, 10 entradas, 24
    salidas y 3 habitaciones con salida más entrada. Acá se comprueba el
    cálculo con una muestra equivalente.
  */
  it('cuenta habitaciones, tipos y colas', () => {
    const summary = summarizeActivity(
      [
        draft({ reservationId: 'A', roomNumber: '404', status: RoomStayStatus.IN_HOUSE }),
        draft({ reservationId: 'B', roomNumber: '407', status: RoomStayStatus.CHECK_OUT }),
        draft({ reservationId: 'C', roomNumber: '407', status: RoomStayStatus.CHECK_IN }),
        draft({ reservationId: 'D', roomNumber: '408', status: RoomStayStatus.CHECK_OUT }),
      ],
      new Set(['A']),
    );

    expect(summary.roomsWithActivity).toBe(3);
    expect(summary.occupied).toBe(1);
    expect(summary.arrivals).toBe(1);
    expect(summary.departures).toBe(2);
    expect(summary.turnarounds).toEqual([
      { roomNumber: '407', leaving: 'B', arriving: 'C' },
    ]);
    expect(summary.newReservations).toBe(3);
    expect(summary.knownReservations).toBe(1);
  });

  it('suma los pendientes por moneda, sin mezclarlas', () => {
    const summary = summarizeActivity(
      [
        draft({
          reservationId: 'A',
          roomNumber: '409',
          status: RoomStayStatus.IN_HOUSE,
          total: 931300,
          pending: 15000,
          currency: 'CLP',
        }),
        draft({
          reservationId: 'B',
          roomNumber: '418',
          status: RoomStayStatus.CHECK_IN,
          total: 57.2,
          pending: 57.2,
          currency: 'USD',
        }),
      ],
      new Set(),
    );

    expect(summary.pendingByCurrency).toEqual({ CLP: 15000, USD: 57.2 });
    expect(summary.totalByCurrency).toEqual({ CLP: 931300, USD: 57.2 });
    expect(summary.withBalance).toBe(2);
  });

  it('lista las reservas repartidas en varias habitaciones', () => {
    const summary = summarizeActivity(
      [
        draft({ reservationId: '7484708', roomNumber: '404', status: RoomStayStatus.IN_HOUSE }),
        draft({ reservationId: '7484708', roomNumber: '409', status: RoomStayStatus.IN_HOUSE }),
        draft({ reservationId: '7484708', roomNumber: '410', status: RoomStayStatus.IN_HOUSE }),
      ],
      new Set(),
    );
    expect(summary.multiRoom).toEqual([
      { reservationId: '7484708', rooms: ['404', '409', '410'] },
    ]);
    // Una reserva, tres habitaciones: NO son tres reservas nuevas.
    expect(summary.newReservations).toBe(1);
  });

  it('la misma reserva entrando y saliendo no es una cola', () => {
    // Uso diurno: sale y vuelve a entrar hoy. Nada bloquea su entrada.
    const summary = summarizeActivity(
      [
        draft({ reservationId: 'X', roomNumber: '420', status: RoomStayStatus.CHECK_OUT }),
        draft({ reservationId: 'X', roomNumber: '420', status: RoomStayStatus.CHECK_IN }),
      ],
      new Set(),
    );
    expect(summary.turnarounds).toEqual([]);
  });

  it('las filas con problemas van a la bandeja, no se corrigen solas', () => {
    const summary = summarizeActivity(
      [
        draft({
          reservationId: 'Z',
          roomNumber: '404',
          status: RoomStayStatus.CHECK_IN,
          issues: ['El tipo de actividad «Pendiente» no se reconoce.'],
        }),
      ],
      new Set(),
    );
    expect(summary.rowIssues).toHaveLength(1);
    expect(summary.rowIssues[0]!.issues[0]).toMatch(/no se reconoce/);
  });

  it('arrastra los totales que declara el informe, para contrastarlos', () => {
    const summary = summarizeActivity([], new Set(), [
      { label: 'Check-in', numbers: [10] },
      { label: 'Check-out', numbers: [24] },
      { label: 'Ocupada', numbers: [19] },
    ]);
    expect(summary.declared.map((d) => d.label)).toEqual([
      'Check-in',
      'Check-out',
      'Ocupada',
    ]);
  });
});
