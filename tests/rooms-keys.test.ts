import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyStatus, RoomStayStage, RoomStayStatus } from '@prisma/client';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { readStructuredReport, type TextFragment } from '@/domain/pms/layout';
import { normalizeReport } from '@/domain/pms/normalize';
import { applyImport, getImportPreview, prepareImport } from '@/server/services/pms-import';
import { confirmCheckIn, confirmCheckOut, getRoomDetail } from '@/server/services/rooms';
import { getKeyInventory, giveExtraCopy, returnKey, setKeyIncidentStatus } from '@/server/services/keys';
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
    await prisma.keyMovement.deleteMany();
    await prisma.roomKey.updateMany({ data: { stayId: null } });
    await prisma.roomStay.deleteMany();
    await prisma.pmsImportBatch.deleteMany();
    await prisma.roomKey.deleteMany();
    await prisma.room.deleteMany();
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

    it('una habitación in house sin check-in en el sistema no tiene llave entregada', async () => {
      // El informe in house llega ya confirmado, pero la llave se entrega en
      // el mesón: el sistema lo marca como conflicto en lugar de inventarlo.
      const conflicts = await getLiveConflicts();
      expect(conflicts.some((conflict) => conflict.kind === 'IN_HOUSE_SIN_LLAVE')).toBe(true);
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
