import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  cancelHandoverPreparation,
  closeShift,
  getIncomingHandover,
  getMyOpenShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
  startShift,
} from '@/server/services/shifts';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Ciclo completo del turno contra la base de datos real. Cubre tanto el camino
 * feliz como cada estado contradictorio que el sistema debe bloquear.
 */
describe('ciclo de turno de punta a punta', () => {
  let morning: CurrentUser;
  let evening: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    morning = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno mañana' });
    evening = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno tarde' });
  });

  it('recorre programado → iniciado → activo → entrega → recibido → cerrado', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.TARDE });

    // 1. Inicio de turno
    const started = await startShift(morning, shiftA.id);
    expect(started.status).toBe(ShiftStatus.INICIADO);
    expect(started.actualStart).not.toBeNull();
    expect(started.startedById).toBe(morning.id);

    // 2. No hay entrega previa: el turno se activa y queda constancia
    const activated = await receiveHandover(morning, { shiftId: shiftA.id });
    expect(activated.status).toBe(ShiftStatus.ACTIVO);
    const activationLog = await prisma.auditLog.findFirst({
      where: { entity: 'Shift', entityId: shiftA.id, action: 'TURNO_RECIBIR' },
    });
    expect(activationLog?.summary).toContain('sin entrega previa');

    // 3. Preparación de la entrega
    const draft = await prepareHandover(morning, shiftA.id);
    expect(draft.status).toBe(HandoverStatus.BORRADOR);
    expect(draft.toShiftId).toBe(shiftB.id);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } })).status).toBe(
      ShiftStatus.PREPARANDO_ENTREGA,
    );

    // 4. Envío
    const sent = await sendHandover(morning, {
      shiftId: shiftA.id,
      notes: 'Pendiente la 318 con mantenimiento.',
    });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
    expect(sent.issuedById).toBe(morning.id);
    expect(sent.issuedAt).not.toBeNull();
    expect(sent.snapshot).not.toBeNull();
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } })).status).toBe(
      ShiftStatus.ENTREGA_ENVIADA,
    );

    // El turno entrante ve la entrega como pendiente de recibir
    const incoming = await getIncomingHandover(shiftB);
    expect(incoming?.id).toBe(sent.id);

    // 5. Recepción por el turno siguiente
    await startShift(evening, shiftB.id);
    const received = await receiveHandover(evening, {
      shiftId: shiftB.id,
      handoverId: sent.id,
      observations: 'Recibido conforme.',
    });
    expect(received.status).toBe(ShiftStatus.ACTIVO);

    const confirmed = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: sent.id } });
    expect(confirmed.status).toBe(HandoverStatus.RECIBIDA);
    expect(confirmed.receivedById).toBe(evening.id);
    expect(confirmed.receivedAt).not.toBeNull();
    expect(confirmed.receiverObservations).toBe('Recibido conforme.');

    // 6. El turno saliente se cierra al confirmarse la recepción
    const closedA = await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } });
    expect(closedA.status).toBe(ShiftStatus.CERRADO);

    // Y el emisor recibe el aviso de que su entrega fue recibida
    const notification = await prisma.notification.findFirst({
      where: { userId: morning.id, entity: 'ShiftHandover' },
    });
    expect(notification?.title).toContain('recibida');
  });

  it('notifica al turno entrante cuando la entrega se envía', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await createShift({ userId: evening.id, type: ShiftType.TARDE });

    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    const notification = await prisma.notification.findFirst({
      where: { userId: evening.id, type: 'ENTREGA_DISPONIBLE' },
    });
    expect(notification).not.toBeNull();
  });

  it('el resumen automático se regenera y conserva las notas manuales', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });

    const draft = await prepareHandover(morning, shiftA.id);
    await prisma.handoverItem.create({
      data: {
        handoverId: draft.id,
        level: 'IMPORTANTE',
        section: 'Observaciones del turno',
        title: 'Llave del ascensor de servicio en recepción',
        manual: true,
        order: 9999,
      },
    });

    await prepareHandover(morning, shiftA.id);

    const items = await prisma.handoverItem.findMany({ where: { handoverId: draft.id } });
    expect(items.filter((i) => i.manual)).toHaveLength(1);
    expect(items.find((i) => i.manual)?.title).toContain('ascensor de servicio');
  });
});

describe('invariantes del turno', () => {
  let morning: CurrentUser;
  let evening: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    morning = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno mañana' });
    evening = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno tarde' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('no permite iniciar dos veces el mismo turno', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await expect(startShift(morning, shift.id)).rejects.toThrow(/no permitida/);
  });

  it('no permite dos turnos abiertos para el mismo usuario', async () => {
    const first = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    const second = await createShift({ userId: morning.id, type: ShiftType.TARDE });

    await startShift(morning, first.id);
    await expect(startShift(morning, second.id)).rejects.toThrow(/Ya tienes el turno/);
  });

  it('no permite iniciar un turno al que no estás asignado', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await expect(startShift(evening, shift.id)).rejects.toThrow(/No estás asignado/);
  });

  it('no permite recibir una entrega inexistente', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);

    await expect(
      receiveHandover(morning, { shiftId: shift.id, handoverId: 'no-existe' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('no permite recibir dos veces la misma entrega', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.TARDE });

    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });

    await startShift(evening, shiftB.id);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });

    // Segundo intento sobre la misma entrega, ya confirmada.
    await expect(
      receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id }),
    ).rejects.toThrow(/ya fue recibida/);
  });

  it('no permite recibir una entrega que no corresponde al turno', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    const shiftC = await createShift({ userId: evening.id, type: ShiftType.NOCHE });

    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });

    // El turno de noche no es el siguiente del turno de mañana.
    await startShift(evening, shiftC.id);
    await expect(
      receiveHandover(evening, { shiftId: shiftC.id, handoverId: sent.id }),
    ).rejects.toThrow(/no corresponde a este turno/);
  });

  it('no permite cerrar el turno sin entregar cuando hay turno siguiente', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await createShift({ userId: evening.id, type: ShiftType.TARDE });

    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });

    await expect(closeShift(morning, { shiftId: shiftA.id })).rejects.toThrow(
      /sin enviar la entrega/,
    );
  });

  it('no permite cerrar el turno con la entrega aún sin confirmar', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await createShift({ userId: evening.id, type: ShiftType.TARDE });

    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    await expect(closeShift(morning, { shiftId: shiftA.id })).rejects.toThrow(
      /aún no la confirma/,
    );
  });

  it('permite cerrar sin entrega cuando no hay turno siguiente', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });

    const closed = await closeShift(morning, { shiftId: shift.id, notes: 'Sin novedades.' });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
    expect(closed.actualEnd).not.toBeNull();
    expect(closed.closedById).toBe(morning.id);
  });

  it('no permite enviar una entrega inexistente ni enviarla dos veces', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });

    await expect(sendHandover(morning, { shiftId: shift.id })).rejects.toThrow(
      /primero debes preparar la entrega/i,
    );

    await prepareHandover(morning, shift.id);
    await sendHandover(morning, { shiftId: shift.id });
    await expect(sendHandover(morning, { shiftId: shift.id })).rejects.toThrow(
      /ya fue enviada/,
    );
  });

  it('cada turno emite como máximo una entrega', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });
    const first = await prepareHandover(morning, shift.id);
    const second = await prepareHandover(morning, shift.id);

    // Preparar de nuevo reutiliza el borrador: no crea una segunda entrega.
    expect(second.id).toBe(first.id);
    expect(await prisma.shiftHandover.count({ where: { fromShiftId: shift.id } })).toBe(1);

    // Y la base rechaza cualquier intento de duplicarla.
    await expect(
      prisma.shiftHandover.create({
        data: { fromShiftId: shift.id, issuedById: morning.id },
      }),
    ).rejects.toThrow();
  });

  it('una entrega siempre tiene emisor y turno de origen', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });
    const handover = await prepareHandover(morning, shift.id);

    expect(handover.fromShiftId).toBe(shift.id);
    expect(handover.issuedById).toBe(morning.id);

    // El esquema no admite entregas huérfanas.
    await expect(
      prisma.shiftHandover.create({
        data: { fromShiftId: 'inexistente', issuedById: morning.id },
      }),
    ).rejects.toThrow();
  });

  it('sólo el personal del turno puede preparar o enviar su entrega', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });

    await expect(prepareHandover(evening, shift.id)).rejects.toThrow(
      /Sólo quien está en el turno/,
    );
  });

  it('permite cancelar la preparación y volver al turno activo', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });
    await prepareHandover(morning, shift.id);

    const reverted = await cancelHandoverPreparation(morning, shift.id);
    expect(reverted.status).toBe(ShiftStatus.ACTIVO);
    expect(await prisma.shiftHandover.count({ where: { fromShiftId: shift.id } })).toBe(0);
  });

  it('no permite cancelar una entrega ya enviada', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await createShift({ userId: evening.id, type: ShiftType.TARDE });
    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    await expect(cancelHandoverPreparation(morning, shiftA.id)).rejects.toThrow(RuleError);
  });

  it('el supervisor puede cerrar el turno de otra persona', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });

    const closed = await closeShift(supervisor, { shiftId: shift.id });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
    expect(closed.closedById).toBe(supervisor.id);
  });

  it('un tercero sin permisos de supervisión no puede cerrar un turno ajeno', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    await startShift(morning, shift.id);
    await receiveHandover(morning, { shiftId: shift.id });

    await expect(closeShift(evening, { shiftId: shift.id })).rejects.toThrow(
      /Sólo quien está en el turno o un supervisor/,
    );
  });

  it('getMyOpenShift devuelve el turno vigente y nada cuando está cerrado', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    expect(await getMyOpenShift(morning.id)).toBeNull();

    await startShift(morning, shift.id);
    expect((await getMyOpenShift(morning.id))?.id).toBe(shift.id);

    await receiveHandover(morning, { shiftId: shift.id });
    await closeShift(morning, { shiftId: shift.id });
    expect(await getMyOpenShift(morning.id)).toBeNull();
  });

  it('registra en auditoría cada paso del ciclo', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.MANANA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.TARDE });

    await startShift(morning, shiftA.id);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });
    await startShift(evening, shiftB.id);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });

    const actions = await prisma.auditLog.findMany({
      where: { entity: { in: ['Shift', 'ShiftHandover'] } },
      select: { action: true },
    });
    const kinds = new Set(actions.map((a) => a.action));

    expect(kinds).toContain('TURNO_INICIAR');
    expect(kinds).toContain('TURNO_RECIBIR');
    expect(kinds).toContain('TURNO_ENTREGAR');
    expect(kinds).toContain('TURNO_CERRAR');
    expect(kinds).toContain('CAMBIO_ESTADO');
  });
});
