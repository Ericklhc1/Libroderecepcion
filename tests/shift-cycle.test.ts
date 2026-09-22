import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import {
  cancelHandoverPreparation,
  closeShift,
  getPendingHandover,
  getMyOpenShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

describe('ciclo de turno de punta a punta', () => {
  let morning: CurrentUser;
  let evening: CurrentUser;
  let validator: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    morning = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno mañana' });
    evening = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno tarde' });
    validator = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Erick Herrera',
      username: 'EHerrera',
    });
  });

  it('recorre programado → activo automático → entrega → recibido → cerrado', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.DIA });

    const started = await openShiftAs(morning, shiftA);
    // Sin relevo ni Caja pendiente, abrir el turno lo deja operativo en una sola acción.
    expect(started.status).toBe(ShiftStatus.ACTIVO);
    expect(started.actualStart).not.toBeNull();
    expect(started.startedById).toBe(morning.id);

    const activationLog = await prisma.auditLog.findFirst({
      where: { entity: 'Shift', entityId: shiftA.id, action: 'TURNO_RECIBIR' },
    });
    expect(activationLog?.summary).toContain('activado automáticamente');

    const draft = await prepareHandover(morning, shiftA.id);
    expect(draft.status).toBe(HandoverStatus.BORRADOR);
    expect(draft.toShiftId).toBeNull();
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } })).status).toBe(
      ShiftStatus.PREPARANDO_ENTREGA,
    );

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

    const incoming = await getPendingHandover(shiftB.id);
    expect(incoming?.id).toBe(sent.id);

    // El saliente cierra por su cuenta: no espera al turno siguiente.
    const closedA = await closeShift(morning, { shiftId: shiftA.id });
    expect(closedA.status).toBe(ShiftStatus.CERRADO);
    expect(closedA.actualEnd).not.toBeNull();

    await openShiftAs(evening, shiftB);
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

    const validationAlert = await prisma.alert.findUnique({
      where: { dedupeKey: `shift-validation:${shiftA.id}` },
    });
    expect(validationAlert).not.toBeNull();
    const validationTask = await prisma.task.findFirst({
      where: { alertId: validationAlert!.id },
    });
    expect(validationTask?.assigneeId).toBe(validator.id);
    expect(validationTask?.priority).toBe('CRITICA');
    expect(validationTask?.origin).toBe('ALERTA');

    const notification = await prisma.notification.findFirst({
      where: { userId: morning.id, entity: 'ShiftHandover' },
    });
    expect(notification?.title).toContain('recibida');
  });

  it('notifica al turno entrante cuando la entrega se envía', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await createShift({ userId: evening.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    const notification = await prisma.notification.findFirst({
      where: { userId: evening.id, type: 'ENTREGA_DISPONIBLE' },
    });
    expect(notification).not.toBeNull();
  });

  it('el resumen automático se regenera y conserva las notas manuales', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
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
  let validator: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    morning = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno mañana' });
    evening = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno tarde' });
    validator = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Erick Herrera',
      username: 'EHerrera',
    });
  });

  it('no permite iniciar dos veces el mismo turno', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    const again = await openShiftAs(morning, shift);
    expect(again.id).toBe(shift.id);
    expect(
      await prisma.auditLog.count({ where: { entityId: shift.id, action: 'TURNO_INICIAR' } }),
    ).toBe(1);
  });

  it('no hay dos turnos abiertos: pedir otro devuelve el vigente', async () => {
    const first = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const second = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const opened = await openShiftAs(morning, first);
    const other = await openShiftAs(morning, second);
    expect(other.id).toBe(opened.id);
    expect(
      await prisma.shift.count({
        where: { status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA'] } },
      }),
    ).toBe(1);
  });

  it('un turno programado para otra persona no se roba: el entrante abre el suyo', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const taken = await openShiftAs(evening, shift);

    expect(taken.id).not.toBe(shift.id);
    expect(taken.startedById).toBe(evening.id);
    expect(
      (await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status,
    ).toBe(ShiftStatus.PROGRAMADO);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: taken.id, userId: evening.id },
    });
    expect(assignment.role).toBe('TITULAR');
  });

  it('quien llega después abre un turno distinto; no se fusionan', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const opened = await openShiftAs(morning, shift);
    const next = await openShiftAs(evening, shift);

    expect(next.id).not.toBe(opened.id);
    expect(
      await prisma.shiftAssignment.count({
        where: { activatedAt: { not: null }, leftAt: null },
      }),
    ).toBe(2);
  });

  it('no permite recibir una entrega inexistente', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await expect(
      receiveHandover(morning, { shiftId: shift.id, handoverId: 'no-existe' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('no permite recibir dos veces la misma entrega', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });
    await openShiftAs(evening, shiftB);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });
    await expect(
      receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id }),
    ).rejects.toThrow(/ya fue recibida/);
  });

  it('un turno no puede recibir su propia entrega', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });
    await expect(
      receiveHandover(morning, { shiftId: shiftA.id, handoverId: sent.id }),
    ).rejects.toThrow(RuleError);
  });

  it('un turno activo no puede saltarse la entrega para cerrar', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    await expect(closeShift(morning, { shiftId: shift.id })).rejects.toThrow(
      /primero prepara la entrega/i,
    );
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe(
      ShiftStatus.ACTIVO,
    );
  });

  it('el saliente puede cerrar apenas envía su entrega, sin esperar recepción', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    const closed = await closeShift(morning, { shiftId: shiftA.id });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
  });

  it('ni siquiera un turno sin novedades puede omitir el ciclo de cierre', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    await expect(
      closeShift(morning, { shiftId: shift.id, notes: 'Sin novedades.' }),
    ).rejects.toThrow(/primero prepara la entrega/i);
    const unchanged = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(unchanged.actualEnd).toBeNull();
    expect(unchanged.closedById).toBeNull();
  });

  it('no permite enviar una entrega inexistente ni enviarla dos veces', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    await expect(sendHandover(morning, { shiftId: shift.id })).rejects.toThrow(
      /primero debes preparar la entrega/i,
    );
    await prepareHandover(morning, shift.id);
    await sendHandover(morning, { shiftId: shift.id });
    await expect(sendHandover(morning, { shiftId: shift.id })).rejects.toThrow(/ya fue enviada/);
  });

  it('cada turno emite como máximo una entrega', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    const first = await prepareHandover(morning, shift.id);
    const second = await prepareHandover(morning, shift.id);
    expect(second.id).toBe(first.id);
    expect(await prisma.shiftHandover.count({ where: { fromShiftId: shift.id } })).toBe(1);
    await expect(
      prisma.shiftHandover.create({ data: { fromShiftId: shift.id, issuedById: morning.id } }),
    ).rejects.toThrow();
  });

  it('una entrega siempre tiene emisor y turno de origen', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    const handover = await prepareHandover(morning, shift.id);
    expect(handover.fromShiftId).toBe(shift.id);
    expect(handover.issuedById).toBe(morning.id);
    await expect(
      prisma.shiftHandover.create({ data: { fromShiftId: 'inexistente', issuedById: morning.id } }),
    ).rejects.toThrow();
  });

  it('sólo el personal del turno puede preparar o enviar su entrega', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    await expect(prepareHandover(evening, shift.id)).rejects.toThrow(/Sólo quien está en el turno/);
  });

  it('permite cancelar la preparación, conservarla anulada y reutilizarla', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    const first = await prepareHandover(morning, shift.id);
    const reverted = await cancelHandoverPreparation(morning, shift.id);

    expect(reverted.status).toBe(ShiftStatus.ACTIVO);

    const cancelled = await prisma.shiftHandover.findUniqueOrThrow({
      where: { fromShiftId: shift.id },
    });
    expect(cancelled.id).toBe(first.id);
    expect(cancelled.status).toBe(HandoverStatus.ANULADA);

    const preparedAgain = await prepareHandover(morning, shift.id);
    expect(preparedAgain.id).toBe(first.id);
    expect(preparedAgain.status).toBe(HandoverStatus.BORRADOR);
    expect(await prisma.shiftHandover.count({ where: { fromShiftId: shift.id } })).toBe(1);
  });

  it('no permite cancelar una entrega ya enviada', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await createShift({ userId: evening.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });
    await expect(cancelHandoverPreparation(morning, shiftA.id)).rejects.toThrow(RuleError);
  });

  it('recibir NO cierra al saliente; el saliente cierra de forma autónoma', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.NOCHE });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });

    await openShiftAs(evening, shiftB);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });

    const stillOpen = await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } });
    expect(stillOpen.status).toBe(ShiftStatus.ENTREGA_ENVIADA);

    const closed = await closeShift(morning, { shiftId: shiftA.id });
    expect(closed.status).toBe(ShiftStatus.CERRADO);

    const task = await prisma.task.findFirst({
      where: { shiftId: shiftA.id, title: 'Validar cierre de turno' },
      orderBy: { createdAt: 'desc' },
    });
    expect(task?.assigneeId).toBe(validator.id);
  });

  it('un tercero sin permisos de supervisión no puede cerrar un turno ajeno', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    await expect(closeShift(evening, { shiftId: shift.id })).rejects.toThrow(
      /Sólo quien estuvo en el turno o un supervisor/,
    );
  });

  it('getMyOpenShift conserva el turno enviado hasta que su dueño lo cierra', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.NOCHE });
    expect(await getMyOpenShift(morning.id)).toBeNull();

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });

    await openShiftAs(evening, shiftB);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });
    expect((await getMyOpenShift(morning.id))?.status).toBe(ShiftStatus.ENTREGA_ENVIADA);

    await closeShift(morning, { shiftId: shiftA.id });
    expect(await getMyOpenShift(morning.id)).toBeNull();
  });

  it('registra en auditoría cada paso del ciclo', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.NOCHE });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });
    await openShiftAs(evening, shiftB);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });
    await closeShift(morning, { shiftId: shiftA.id });

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
