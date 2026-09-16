import { readFileSync } from 'node:fs';
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
import { readStructuredReport, type TextFragment } from '@/domain/pms/layout';
import { normalizeReport } from '@/domain/pms/normalize';
import { applyImport, getImportPreview, prepareImport } from '@/server/services/pms-import';
import {
  confirmCheckIn,
  confirmCheckOut,
  getRoomDetail,
  listRoomsWithState,
} from '@/server/services/rooms';
import {
  getKeyInventory,
  giveExtraCopy,
  handMainKey,
  returnKey,
  setKeyIncidentStatus,
} from '@/server/services/keys';
import { getLiveConflicts } from '@/server/services/pms-import';
import { RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Estado operativo de habitaciones y llaves, con los informes reales.
 *
 * Los tres casos que pidió el hotel están aquí con sus datos verdaderos: la
 * 408 y la 414 (salida sin confirmar con entrada esperando), la 515 (mismo
 * huésped con dos reservas distintas) y la 610 (la misma reserva entra y sale
 * el mismo día).
 */

const SLUGS = ['entradas', 'in-house', 'salidas'] as const;

function fixture(slug: string): TextFragment[] {
  return JSON.parse(readFileSync(`tests/fixtures/informe-${slug}.json`, 'utf-8'));
}

/**
 * Siembra el borrador de importación directamente desde los fixtures, sin
 * pasar por el PDF: la lectura del PDF ya se prueba aparte.
 */
async function seedBatch(user: CurrentUser) {
  const stays = SLUGS.flatMap((slug) => {
    const normalized = normalizeReport(readStructuredReport(fixture(slug)));
    if (!normalized) throw new Error(`fixture ilegible: ${slug}`);
    return normalized.stays.map((stay) => ({
      reservationId: stay.reservationId,
      roomNumber: stay.roomNumber,
      guestNames: stay.guestNames,
      channel: stay.channel,
      arrivalDate: stay.arrivalDate?.toISOString() ?? null,
      departureDate: stay.departureDate?.toISOString() ?? null,
      pmsStatus: stay.pmsStatus,
      sourceReport: stay.sourceReport,
      status: stay.operationalStatus,
      issues: stay.issues,
    }));
  });

  const businessDate = new Date(2026, 8, 14);
  const batch = await prisma.pmsImportBatch.create({
    data: {
      businessDate,
      reports: [],
      payload: stays,
      summary: {},
      createdById: user.id,
    },
    select: { id: true },
  });
  return batch.id;
}

async function stayFor(roomNumber: string, status: RoomStayStatus) {
  return prisma.roomStay.findFirstOrThrow({
    where: { room: { number: roomNumber }, status, deletedAt: null },
  });
}

describe('habitaciones y llaves', () => {
  let receptionist: CurrentUser & { passwordPlain: string };
  let supervisor: CurrentUser & { passwordPlain: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('siembra el inventario real del hotel: 401-429, 501-530 y 601-630', async () => {
    const rooms = await prisma.room.findMany({ orderBy: { number: 'asc' } });
    expect(rooms).toHaveLength(89);
    const numbers = rooms.map((room) => room.number);
    expect(numbers[0]).toBe('401');
    expect(numbers.at(-1)).toBe('630');
    expect(numbers).toContain('429');
    expect(numbers).toContain('530');
    expect(numbers).not.toContain('431');
    // Cada habitación nace con su llave principal, en el tablero.
    const principals = await prisma.roomKey.count({ where: { type: 'PRINCIPAL' } });
    expect(principals).toBe(89);
  });

  describe('importación de los tres informes', () => {
    /*
      Caso real de producción: la habitación 629 mostraba a la MISMA reserva
      (7528281) como «Actual · In house» y como «Entrante · Check-in» a la
      vez. La causa era que la clave de deduplicación incluía el estado, así
      que la misma reserva en el informe de in house y en el de entradas
      generaba dos claves y dos estadías, con un conflicto de llave que en la
      realidad no existía.

      Una reserva es UNA estadía por habitación, y gana el estado más
      avanzado. Esto se prueba con un lote armado a mano, no con los
      fixtures, porque el informe real del hotel no traía el caso.
    */
    it('la misma reserva en dos informes no crea dos estadías', async () => {
      const reserva = '7528281';
      const comun = {
        reservationId: reserva,
        roomNumber: '629',
        guestNames: ['Karla Paula Baya'],
        channel: 'Walk-in',
        arrivalDate: new Date(2026, 8, 15).toISOString(),
        departureDate: new Date(2026, 8, 21).toISOString(),
        pmsStatus: null,
        issues: [],
      };
      const batch = await prisma.pmsImportBatch.create({
        data: {
          businessDate: new Date(2026, 8, 14),
          reports: [],
          payload: [
            { ...comun, sourceReport: 'IN_HOUSE', status: RoomStayStatus.IN_HOUSE },
            { ...comun, sourceReport: 'ENTRADAS', status: RoomStayStatus.CHECK_IN },
          ],
          summary: {},
          createdById: receptionist.id,
        },
        select: { id: true },
      });

      await applyImport(receptionist, batch.id);

      const estadias = await prisma.roomStay.findMany({
        where: { reservationId: reserva, deletedAt: null },
      });

      expect(estadias).toHaveLength(1);
      // Gana el estado más avanzado: quien ya está dentro no está «por llegar».
      expect(estadias[0]?.status).toBe(RoomStayStatus.IN_HOUSE);

      // Y una sola llave principal, sin el conflicto que no existía.
      const llaves = await prisma.roomKey.findMany({
        where: { room: { number: '629' }, stayId: { not: null } },
      });
      expect(llaves).toHaveLength(1);
      expect(llaves[0]?.stayId).toBe(estadias[0]?.id);
    });

    it('volver a importar el informe de entradas no retrocede a quien ya está dentro', async () => {
      const reserva = '7528299';
      const comun = {
        reservationId: reserva,
        roomNumber: '628',
        guestNames: ['Huésped Dentro'],
        channel: null,
        arrivalDate: new Date(2026, 8, 15).toISOString(),
        departureDate: new Date(2026, 8, 21).toISOString(),
        pmsStatus: null,
        issues: [],
      };
      const lote = async (payload: unknown[]) =>
        (
          await prisma.pmsImportBatch.create({
            data: {
              businessDate: new Date(2026, 8, 14),
              reports: [],
              payload: payload as never,
              summary: {},
              createdById: receptionist.id,
            },
            select: { id: true },
          })
        ).id;

      await applyImport(
        receptionist,
        await lote([{ ...comun, sourceReport: 'IN_HOUSE', status: RoomStayStatus.IN_HOUSE }]),
      );
      await applyImport(
        receptionist,
        await lote([{ ...comun, sourceReport: 'ENTRADAS', status: RoomStayStatus.CHECK_IN }]),
      );

      const estadias = await prisma.roomStay.findMany({
        where: { reservationId: reserva, deletedAt: null },
      });
      expect(estadias).toHaveLength(1);
      expect(estadias[0]?.status).toBe(RoomStayStatus.IN_HOUSE);
    });

    it('aplica las filas y agrupa por habitación', async () => {
      const batchId = await seedBatch(receptionist);
      const result = await applyImport(receptionist, batchId);

      expect(result.created).toBe(13 + 30 + 14);
      expect(result.skipped).toBe(0);

      const stays = await prisma.roomStay.count();
      expect(stays).toBe(57);
    });

    it('es idempotente: volver a aplicar no duplica nada', async () => {
      await applyImport(receptionist, await seedBatch(receptionist));
      const before = await prisma.roomStay.count();

      const second = await applyImport(receptionist, await seedBatch(receptionist));
      expect(second.created).toBe(0);
      // Las 30 filas in house llegan ya confirmadas, así que se conservan en
      // lugar de retroceder de etapa; las 27 pendientes se actualizan.
      expect(second.updated).toBe(27);
      expect(second.preserved).toBe(30);
      expect(await prisma.roomStay.count()).toBe(before);
    });

    it('no deshace una confirmación hecha a mano', async () => {
      await applyImport(receptionist, await seedBatch(receptionist));
      const departure = await stayFor('405', RoomStayStatus.CHECK_OUT);
      await confirmCheckOut(receptionist, { stayId: departure.id });

      const batchId = await seedBatch(receptionist);
      const preview = await getImportPreview(batchId);
      expect(
        preview.protectedStays.some((stay) => stay.roomNumber === '405'),
      ).toBe(true);

      await applyImport(receptionist, batchId);
      const after = await prisma.roomStay.findUniqueOrThrow({ where: { id: departure.id } });
      // La etapa se conserva: el PDF no puede devolver una salida ya confirmada.
      expect(after.stage).toBe(RoomStayStage.FINALIZADO);
    });

    it('informa los archivos ilegibles en lugar de fallar', async () => {
      const preview = await prepareImport(receptionist, [
        { name: 'roto.pdf', data: new Uint8Array([1, 2, 3]) },
      ]);
      expect(preview.reports).toHaveLength(1);
      expect(preview.reports[0]?.error).toBeTruthy();
      expect(preview.stays).toHaveLength(0);
    });
  });

  describe('regla de cola', () => {
    beforeEach(async () => {
      await applyImport(receptionist, await seedBatch(receptionist));
    });

    it('la 408 queda pendiente de liberación con la entrada en cola', async () => {
      const room = await getRoomDetail('408');
      expect(room.snapshot.state).toBe('PENDIENTE_LIBERACION');
      expect(room.snapshot.outgoing?.reservationId).toBe('7529545');
      expect(room.snapshot.incoming?.reservationId).toBe('7508240');
      expect(room.snapshot.incomingState).toBe('EN_COLA');
      // La entrada no está dentro y no tiene llave.
      expect(room.snapshot.current).toBeNull();
      expect(
        room.keys.filter((key) => key.stayId === room.snapshot.incoming?.id),
      ).toHaveLength(0);
    });

    it('la 414 aplica la misma cola con salida y entrada el mismo día', async () => {
      const room = await getRoomDetail('414');
      expect(room.snapshot.state).toBe('PENDIENTE_LIBERACION');
      expect(room.snapshot.incomingState).toBe('EN_COLA');
      expect(room.snapshot.outgoing?.departureDate?.getDate()).toBe(14);
      expect(room.snapshot.incoming?.arrivalDate?.getDate()).toBe(14);
    });

    it('la 515 compara por identificador de reserva y no por nombre', async () => {
      const room = await getRoomDetail('515');
      // Mismo huésped en los dos informes, con dos reservas distintas.
      expect(room.snapshot.outgoing?.reservationId).toBe('7529517');
      expect(room.snapshot.incoming?.reservationId).toBe('7530596');
      expect(room.snapshot.outgoing?.guestNames[0]).toBe(
        room.snapshot.incoming?.guestNames[0],
      );
      expect(room.snapshot.sameReservationTurnaround).toBe(false);
      expect(room.snapshot.incomingState).toBe('EN_COLA');
    });

    it('la 610 es la misma reserva entrando y saliendo hoy: no hay cola', async () => {
      const room = await getRoomDetail('610');
      expect(room.snapshot.outgoing?.reservationId).toBe('7530340');
      expect(room.snapshot.incoming?.reservationId).toBe('7530340');
      expect(room.snapshot.sameReservationTurnaround).toBe(true);
      expect(room.snapshot.incomingState).toBe('LISTO');
      expect(room.snapshot.state).toBe('CHECK_IN_LISTO');
    });

    it('el servidor rechaza el check-in mientras la salida no se confirme', async () => {
      const incoming = await stayFor('408', RoomStayStatus.CHECK_IN);
      await expect(
        confirmCheckIn(receptionist, { stayId: incoming.id }),
      ).rejects.toBeInstanceOf(RuleError);

      const still = await prisma.roomStay.findUniqueOrThrow({ where: { id: incoming.id } });
      expect(still.status).toBe(RoomStayStatus.CHECK_IN);
      expect(still.stage).toBe(RoomStayStage.PENDIENTE);
    });

    it('confirmada la salida, la entrada pasa a in house y recibe llave', async () => {
      const departure = await stayFor('408', RoomStayStatus.CHECK_OUT);
      await confirmCheckOut(receptionist, { stayId: departure.id });

      const released = await getRoomDetail('408');
      expect(released.snapshot.outgoing).toBeNull();
      expect(released.snapshot.incomingState).toBe('LISTO');
      expect(released.snapshot.state).toBe('CHECK_IN_LISTO');

      const incoming = await stayFor('408', RoomStayStatus.CHECK_IN);
      const result = await confirmCheckIn(receptionist, { stayId: incoming.id });
      expect(result.keyCode).toBe('P-408');

      const occupied = await getRoomDetail('408');
      expect(occupied.snapshot.state).toBe('OCUPADA');
      expect(occupied.snapshot.current?.reservationId).toBe('7508240');
      expect(occupied.snapshot.mainKey?.status).toBe(KeyStatus.ASIGNADA);
    });

    it('no se puede confirmar dos veces la misma salida', async () => {
      const departure = await stayFor('405', RoomStayStatus.CHECK_OUT);
      await confirmCheckOut(receptionist, { stayId: departure.id });
      await expect(
        confirmCheckOut(receptionist, { stayId: departure.id }),
      ).rejects.toBeInstanceOf(RuleError);
    });

    it('confirmar la salida cierra también la estadía in house de esa reserva', async () => {
      // La 529 sale con la reserva 7528475, que además está in house en otras
      // habitaciones; sólo se cierra la de esta habitación.
      const inHouse = await prisma.roomStay.findFirst({
        where: { room: { number: '507' }, status: RoomStayStatus.IN_HOUSE },
      });
      expect(inHouse).not.toBeNull();

      const departure = await stayFor('529', RoomStayStatus.CHECK_OUT);
      await confirmCheckOut(receptionist, { stayId: departure.id });

      const untouched = await prisma.roomStay.findUniqueOrThrow({ where: { id: inHouse!.id } });
      expect(untouched.stage).not.toBe(RoomStayStage.FINALIZADO);
    });
  });

  describe('llaves', () => {
    beforeEach(async () => {
      await applyImport(receptionist, await seedBatch(receptionist));
    });

    /*
      ENTREGAR LA LLAVE A MANO. Era el agujero que dejaba al mesón sin poder
      entregar nada: la principal sólo se asignaba al confirmar un check-in,
      así que una estadía que entra ya como IN_HOUSE —o una habitación cuya
      llave volvió al inventario— se quedaba sin gesto posible. La ficha no
      mostraba ningún botón y parecía que el sistema estuviera roto.
    */
    describe('entregar la llave a mano', () => {
      /** Deja la habitación in house y con su llave de vuelta en el inventario. */
      async function conLlaveLibre(roomNumber: string) {
        const room = await prisma.room.findUniqueOrThrow({ where: { number: roomNumber } });
        await prisma.roomKey.updateMany({
          where: { roomId: room.id },
          data: { status: KeyStatus.DISPONIBLE, stayId: null, assignedAt: null },
        });
        return room;
      }

      it('entrega la llave al huésped que está dentro', async () => {
        const inHouse = await prisma.roomStay.findFirstOrThrow({
          where: { status: RoomStayStatus.IN_HOUSE, deletedAt: null, roomId: { not: null } },
          include: { room: true },
        });
        const room = await conLlaveLibre(inHouse.room!.number);

        const result = await handMainKey(receptionist, { roomId: room.id });

        expect(result.roomNumber).toBe(room.number);
        const key = await prisma.roomKey.findFirstOrThrow({ where: { code: result.code } });
        expect(key.status).toBe(KeyStatus.ASIGNADA);
        // Queda a nombre de la estadía, no sólo de la habitación.
        expect(key.stayId).toBe(inHouse.id);
        expect(key.assignedById).toBe(receptionist.id);
      });

      it('no entrega dos veces la principal: manda usar una copia', async () => {
        const inHouse = await prisma.roomStay.findFirstOrThrow({
          where: { status: RoomStayStatus.IN_HOUSE, deletedAt: null, roomId: { not: null } },
          include: { room: true },
        });
        const room = await conLlaveLibre(inHouse.room!.number);
        await handMainKey(receptionist, { roomId: room.id });

        await expect(handMainKey(receptionist, { roomId: room.id })).rejects.toThrow(
          /copia adicional/,
        );
      });

      /*
        Sin nadie dentro no se entrega, y el mensaje dice qué hacer: la llave de
        una llegada se entrega confirmando el check-in, que es lo que además
        deja registrado quién entró.
      */
      it('sin nadie alojado no entrega, y explica dónde se hace', async () => {
        const libre = await prisma.room.findFirstOrThrow({
          where: { stays: { none: { deletedAt: null, status: RoomStayStatus.IN_HOUSE } } },
        });

        await expect(handMainKey(receptionist, { roomId: libre.id })).rejects.toThrow(
          /confirma primero su check-in/,
        );
      });

      it('si no hay ninguna llave disponible lo dice en lugar de callarse', async () => {
        const inHouse = await prisma.roomStay.findFirstOrThrow({
          where: { status: RoomStayStatus.IN_HOUSE, deletedAt: null, roomId: { not: null } },
          include: { room: true },
        });
        const room = await conLlaveLibre(inHouse.room!.number);

        // Toda llave fuera de servicio: ni la principal ni una copia del stock.
        await prisma.roomKey.updateMany({
          data: { status: KeyStatus.FUERA_DE_SERVICIO },
        });

        await expect(handMainKey(receptionist, { roomId: room.id })).rejects.toThrow(
          /No hay ninguna llave disponible/,
        );
      });

      it('deja rastro en el historial de la llave', async () => {
        const inHouse = await prisma.roomStay.findFirstOrThrow({
          where: { status: RoomStayStatus.IN_HOUSE, deletedAt: null, roomId: { not: null } },
          include: { room: true },
        });
        const room = await conLlaveLibre(inHouse.room!.number);
        const result = await handMainKey(receptionist, { roomId: room.id });

        const key = await prisma.roomKey.findFirstOrThrow({ where: { code: result.code } });
        const movement = await prisma.keyMovement.findFirstOrThrow({
          where: { keyId: key.id, action: 'ASIGNADA' },
          orderBy: { at: 'desc' },
        });
        expect(movement.toStatus).toBe(KeyStatus.ASIGNADA);
        expect(movement.userId).toBe(receptionist.id);
      });
    });

    /*
      Decisión revisada. La primera versión no entregaba ninguna llave al
      importar: el informe in house venía confirmado, pero la entrega ocurre
      en el mesón y el sistema no quería inventarla. En la práctica eso dejaba
      treinta avisos de «in house sin llave» en cada importación, ninguno
      accionable: nadie había registrado la entrega porque el huésped entró
      antes de que el sistema existiera.

      Quien está dentro de la habitación tiene su llave. Es un hecho físico,
      no una decisión del mesón, y ahora la importación lo refleja.
    */
    it('todo huésped in house queda con su llave principal asignada', async () => {
      const inHouse = await prisma.roomStay.findMany({
        where: { status: RoomStayStatus.IN_HOUSE, deletedAt: null, roomId: { not: null } },
        select: { roomId: true },
      });
      expect(inHouse.length).toBeGreaterThan(20);

      const rooms = await listRoomsWithState();
      for (const stay of inHouse) {
        const room = rooms.find((candidate) => candidate.id === stay.roomId);
        // O la tiene asignada, o está pendiente de devolución porque además
        // hoy se va: en ninguno de los dos casos está en el inventario.
        expect(room?.snapshot.keysOut.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('la revisión ya no avisa de lo que la propia importación resuelve', async () => {
      /*
        La previsión simula la entrega con la misma regla que aplica la
        importación. Antes anunciaba treinta «in house sin llave» que el botón
        «Aplicar» resolvía acto seguido: un aviso que no había que atender.
      */
      const preview = await getImportPreview(await seedBatch(receptionist));
      expect(preview.conflicts.filter((c) => c.kind === 'IN_HOUSE_SIN_LLAVE')).toEqual([]);
      // Lo que sí debe seguir anunciando: las entradas que quedan en cola.
      expect(
        preview.conflicts.some((c) => c.kind === 'ENTRADA_CON_SALIDA_PENDIENTE'),
      ).toBe(true);
    });

    it('ya no quedan avisos de «in house sin llave»', async () => {
      const conflicts = await getLiveConflicts();
      expect(conflicts.filter((conflict) => conflict.kind === 'IN_HOUSE_SIN_LLAVE')).toEqual([]);
    });

    it('la salida sin confirmar deja su llave pendiente de devolución', async () => {
      // 405: sale Zhou Caiwu. El huésped todavía la tiene, y el mesón sabe
      // que hay que recuperarla.
      const room = await getRoomDetail('405');
      expect(room.snapshot.state).toBe('CHECK_OUT_PENDIENTE');
      expect(room.snapshot.mainKey?.status).toBe(KeyStatus.PENDIENTE_DEVOLUCION);
      expect(room.snapshot.mainKey?.stayId).toBe(room.snapshot.outgoing?.id);
    });

    it('la entrada en cola sigue sin llave, con la principal en inventario', async () => {
      /*
        Es el límite de la regla nueva y el corazón de la regla de cola: la
        408 tiene una salida sin confirmar y una entrada esperando. La llave
        es de quien sale, nunca de quien espera.
      */
      const room = await getRoomDetail('408');
      expect(room.snapshot.state).toBe('PENDIENTE_LIBERACION');
      expect(room.snapshot.mainKey?.stayId).toBe(room.snapshot.outgoing?.id);
      expect(room.snapshot.mainKey?.stayId).not.toBe(room.snapshot.incoming?.id);

      // Y una habitación con la entrada lista, sin nadie dentro, no recibe nada.
      const lista = await getRoomDetail('403');
      expect(lista.snapshot.state).toBe('CHECK_IN_LISTO');
      expect(lista.snapshot.keysOut).toEqual([]);
      expect(lista.snapshot.mainKey?.status).toBe(KeyStatus.DISPONIBLE);
    });

    it('no le quita la llave a quien ya la tiene', async () => {
      /*
        La 404 está in house con su llave asignada. Volver a importar no puede
        reasignarla ni registrar un movimiento nuevo: la llave ya está donde
        debe.
      */
      const antes = await getRoomDetail('404');
      const movimientosAntes = await prisma.keyMovement.count({
        where: { keyId: antes.snapshot.mainKey!.id },
      });

      const result = await applyImport(receptionist, await seedBatch(receptionist));
      expect(result.keysAssigned).toBe(0);

      const despues = await getRoomDetail('404');
      expect(despues.snapshot.mainKey?.id).toBe(antes.snapshot.mainKey?.id);
      expect(despues.snapshot.mainKey?.stayId).toBe(antes.snapshot.mainKey?.stayId);
      expect(
        await prisma.keyMovement.count({ where: { keyId: antes.snapshot.mainKey!.id } }),
      ).toBe(movimientosAntes);
    });

    it('una llave extraviada no se asigna: el conflicto se conserva', async () => {
      const room = await getRoomDetail('406');
      const key = room.snapshot.mainKey!;
      await prisma.roomKey.update({
        where: { id: key.id },
        data: { status: KeyStatus.EXTRAVIADA, stayId: null },
      });

      await applyImport(receptionist, await seedBatch(receptionist));

      const despues = await getRoomDetail('406');
      expect(despues.snapshot.mainKey?.status).toBe(KeyStatus.EXTRAVIADA);
      expect(despues.snapshot.mainKey?.stayId).toBeNull();
      const conflicts = await getLiveConflicts();
      expect(
        conflicts.some(
          (conflict) => conflict.kind === 'IN_HOUSE_SIN_LLAVE' && conflict.roomNumber === '406',
        ),
      ).toBe(true);
    });

    it('la entrada en cola nunca tiene llave asignada', async () => {
      const conflicts = await getLiveConflicts();
      expect(conflicts.some((conflict) => conflict.kind === 'CHECK_IN_CON_LLAVE')).toBe(false);
    });

    it('la salida informada deja la llave pendiente de devolución', async () => {
      // Primero alguien está dentro con su llave.
      const departure = await stayFor('408', RoomStayStatus.CHECK_OUT);
      await confirmCheckOut(receptionist, { stayId: departure.id });
      const incoming = await stayFor('408', RoomStayStatus.CHECK_IN);
      await confirmCheckIn(receptionist, { stayId: incoming.id });

      // Al día siguiente el PMS informa su salida.
      const nextDay = await prisma.roomStay.create({
        data: {
          reservationId: '7508240',
          roomId: (await prisma.room.findUniqueOrThrow({ where: { number: '408' } })).id,
          guestNames: ['Jazmín Millanao'],
          sourceReport: 'SALIDAS',
          status: RoomStayStatus.CHECK_OUT,
          stage: RoomStayStage.PENDIENTE,
          businessDate: new Date(2026, 8, 16),
        },
      });

      const key = await prisma.roomKey.findUniqueOrThrow({ where: { code: 'P-408' } });
      await prisma.roomKey.update({
        where: { id: key.id },
        data: { status: KeyStatus.PENDIENTE_DEVOLUCION, stayId: nextDay.id },
      });

      const room = await getRoomDetail('408');
      expect(room.snapshot.mainKey?.status).toBe(KeyStatus.PENDIENTE_DEVOLUCION);

      // Al confirmar la salida, la llave vuelve al inventario.
      await confirmCheckOut(receptionist, { stayId: nextDay.id });
      const released = await prisma.roomKey.findUniqueOrThrow({ where: { code: 'P-408' } });
      expect(released.status).toBe(KeyStatus.DISPONIBLE);
      expect(released.stayId).toBeNull();
      expect(released.roomId).not.toBeNull();
    });

    it('la copia adicional se descuenta del stock y vuelve al recuperarla', async () => {
      const before = await getKeyInventory();
      const room = await prisma.room.findUniqueOrThrow({ where: { number: '507' } });

      const copy = await giveExtraCopy(supervisor, { roomId: room.id, note: 'segundo huésped' });
      const during = await getKeyInventory();
      expect(during.stock.copiesAvailable).toBe(before.stock.copiesAvailable - 1);
      expect(during.stock.extraCopies).toBe(before.stock.extraCopies + 1);

      const key = await prisma.roomKey.findUniqueOrThrow({ where: { code: copy.code } });
      await returnKey(receptionist, { keyId: key.id });

      const after = await getKeyInventory();
      expect(after.stock.copiesAvailable).toBe(before.stock.copiesAvailable);
      expect(after.stock.extraCopies).toBe(0);
    });

    it('una llave extraviada sale del stock y queda registrada', async () => {
      const key = await prisma.roomKey.findUniqueOrThrow({ where: { code: 'C-01' } });
      await setKeyIncidentStatus(supervisor, {
        keyId: key.id,
        status: 'EXTRAVIADA',
        reason: 'No volvió del turno de noche',
      });

      const inventory = await getKeyInventory();
      expect(inventory.stock.lost).toBe(1);

      const movements = await prisma.keyMovement.findMany({ where: { keyId: key.id } });
      expect(movements.some((movement) => movement.action === 'MARCADA_EXTRAVIADA')).toBe(true);
    });

    it('cada movimiento de llave queda en el historial con su autor', async () => {
      const departure = await stayFor('408', RoomStayStatus.CHECK_OUT);
      await confirmCheckOut(receptionist, { stayId: departure.id });
      const incoming = await stayFor('408', RoomStayStatus.CHECK_IN);
      await confirmCheckIn(receptionist, { stayId: incoming.id });

      const movements = await prisma.keyMovement.findMany({
        where: { key: { code: 'P-408' } },
        orderBy: { at: 'asc' },
      });
      expect(movements.length).toBeGreaterThan(0);
      expect(movements.at(-1)?.action).toBe('ASIGNADA');
      expect(movements.at(-1)?.userId).toBe(receptionist.id);
    });
  });

  describe('conflictos', () => {
    it('avisa de dos reservas distintas in house en la misma habitación', async () => {
      await applyImport(receptionist, await seedBatch(receptionist));
      const room = await prisma.room.findUniqueOrThrow({ where: { number: '507' } });
      await prisma.roomStay.create({
        data: {
          reservationId: '9999999',
          roomId: room.id,
          guestNames: ['Intruso Inventado'],
          sourceReport: 'IN_HOUSE',
          status: RoomStayStatus.IN_HOUSE,
          stage: RoomStayStage.CONFIRMADO,
          businessDate: new Date(2026, 8, 14),
        },
      });

      const conflicts = await getLiveConflicts();
      const found = conflicts.find(
        (conflict) => conflict.kind === 'DOS_IN_HOUSE' && conflict.roomNumber === '507',
      );
      expect(found).toBeDefined();
    });

    it('señala la entrada sobre una habitación con salida pendiente', async () => {
      await applyImport(receptionist, await seedBatch(receptionist));
      const conflicts = await getLiveConflicts();
      const queued = conflicts.filter(
        (conflict) => conflict.kind === 'ENTRADA_CON_SALIDA_PENDIENTE',
      );
      expect(queued.map((conflict) => conflict.roomNumber)).toContain('408');
      expect(queued.map((conflict) => conflict.roomNumber)).toContain('414');
      expect(queued.map((conflict) => conflict.roomNumber)).toContain('515');
      // La 610 es la misma reserva: no es cola y no se reporta.
      expect(queued.map((conflict) => conflict.roomNumber)).not.toContain('610');
    });

    it('avisa de una habitación del informe que no existe en el hotel', async () => {
      const batchId = await seedBatch(receptionist);
      await prisma.room.delete({ where: { number: '408' } });

      const preview = await getImportPreview(batchId);
      expect(preview.orphans.some((orphan) => orphan.roomNumber === '408')).toBe(true);
      expect(
        preview.conflicts.some((conflict) => conflict.kind === 'HABITACION_DESCONOCIDA'),
      ).toBe(true);

      const result = await applyImport(receptionist, batchId);
      expect(result.skipped).toBeGreaterThan(0);
    });

    it('avisa de más de una llave principal en la misma habitación', async () => {
      const room = await prisma.room.findUniqueOrThrow({ where: { number: '401' } });
      await prisma.roomKey.updateMany({
        where: { code: 'P-401' },
        data: { roomId: room.id },
      });
      await prisma.roomKey.create({
        data: { code: 'P-401-BIS', type: 'PRINCIPAL', roomId: room.id },
      });

      const conflicts = await getLiveConflicts();
      expect(
        conflicts.some(
          (conflict) =>
            conflict.kind === 'MULTIPLES_PRINCIPALES' && conflict.roomNumber === '401',
        ),
      ).toBe(true);
    });
  });
});
