import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NotificationType,
  OperationalAlarmKind,
  OperationalAlarmScope,
  OperationalAlarmStatus,
  ShiftType,
} from '@prisma/client';
import {
  acknowledgeOperationalAlarm,
  createOperationalAlarm,
  dispatchDueAlarmsForUser,
  snoozeOperationalAlarm,
} from '@/server/services/operational-alarms';
import {
  closeShift,
  prepareHandover,
  sendHandover,
} from '@/server/services/shifts';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('timers y recordatorios operativos', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('un timer queda ligado al turno donde nace y se cancela al cerrar el turno', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Ana Timer',
    });
    const shift = await openShiftAs(receptionist, { type: ShiftType.DIA });

    const timer = await createOperationalAlarm(receptionist, {
      kind: OperationalAlarmKind.TIMER,
      scope: OperationalAlarmScope.INDIVIDUAL,
      title: 'Revisar equipaje pendiente',
      dueAt: new Date(Date.now() + 20 * 60_000),
      recipientIds: [receptionist.id],
    });

    expect(timer.originShiftId).toBe(shift.id);
    expect(timer.recipients).toHaveLength(1);

    await prepareHandover(receptionist, shift.id);
    await sendHandover(receptionist, { shiftId: shift.id });
    await closeShift(receptionist, { shiftId: shift.id });

    const stored = await prisma.operationalAlarm.findUniqueOrThrow({
      where: { id: timer.id },
    });
    expect(stored.status).toBe(OperationalAlarmStatus.CANCELADA);
    expect(stored.cancelledAt).not.toBeNull();
  });

  it('un recordatorio no se cancela cuando termina el turno que estaba activo al crearlo', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Ana Recordatorio',
    });
    const shift = await openShiftAs(receptionist, { type: ShiftType.DIA });

    const reminder = await createOperationalAlarm(receptionist, {
      kind: OperationalAlarmKind.RECORDATORIO,
      scope: OperationalAlarmScope.INDIVIDUAL,
      title: 'Confirmar traslado de mañana',
      dueAt: new Date(Date.now() + 60 * 60_000),
      recipientIds: [receptionist.id],
    });

    expect(reminder.originShiftId).toBeNull();

    await prepareHandover(receptionist, shift.id);
    await sendHandover(receptionist, { shiftId: shift.id });
    await closeShift(receptionist, { shiftId: shift.id });

    const stored = await prisma.operationalAlarm.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(stored.status).toBe(OperationalAlarmStatus.ACTIVA);
    expect(stored.cancelledAt).toBeNull();
  });

  it('una alarma vencida genera una sola notificación hasta que se pospone', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Beto Alarma',
    });

    const alarm = await createOperationalAlarm(user, {
      kind: OperationalAlarmKind.RECORDATORIO,
      scope: OperationalAlarmScope.INDIVIDUAL,
      title: 'Llamar habitación 512',
      dueAt: new Date(Date.now() + 10 * 60_000),
      recipientIds: [user.id],
    });
    await prisma.operationalAlarm.update({
      where: { id: alarm.id },
      data: { dueAt: new Date(Date.now() - 1_000) },
    });

    expect(await dispatchDueAlarmsForUser(user.id)).toBe(1);
    expect(await dispatchDueAlarmsForUser(user.id)).toBe(0);

    const recipient = await prisma.operationalAlarmRecipient.findFirstOrThrow({
      where: { alarmId: alarm.id, userId: user.id },
    });
    expect(
      await prisma.notification.count({
        where: {
          userId: user.id,
          type: NotificationType.ALARMA,
          entityId: recipient.id,
        },
      }),
    ).toBe(1);

    const snoozed = await snoozeOperationalAlarm(user, recipient.id, 5);
    expect(snoozed.snoozedUntil.getTime()).toBeGreaterThan(Date.now());

    await prisma.operationalAlarmRecipient.update({
      where: { id: recipient.id },
      data: { snoozedUntil: new Date(Date.now() - 1_000) },
    });
    expect(await dispatchDueAlarmsForUser(user.id)).toBe(1);

    expect(
      await prisma.notification.count({
        where: {
          userId: user.id,
          type: NotificationType.ALARMA,
          entityId: recipient.id,
        },
      }),
    ).toBe(2);
  });

  it('detener una alarma individual la cierra y confirma sólo al destinatario', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Carla Alarma',
    });

    const alarm = await createOperationalAlarm(user, {
      kind: OperationalAlarmKind.TIMER,
      scope: OperationalAlarmScope.INDIVIDUAL,
      title: 'Volver a revisar la caja',
      dueAt: new Date(Date.now() + 5 * 60_000),
      recipientIds: [user.id],
    });

    const recipient = await prisma.operationalAlarmRecipient.findFirstOrThrow({
      where: { alarmId: alarm.id, userId: user.id },
    });

    await acknowledgeOperationalAlarm(user, recipient.id);

    const [storedAlarm, storedRecipient] = await Promise.all([
      prisma.operationalAlarm.findUniqueOrThrow({ where: { id: alarm.id } }),
      prisma.operationalAlarmRecipient.findUniqueOrThrow({ where: { id: recipient.id } }),
    ]);

    expect(storedRecipient.acknowledgedAt).not.toBeNull();
    expect(storedAlarm.status).toBe(OperationalAlarmStatus.CERRADA);
    expect(storedAlarm.closedAt).not.toBeNull();
  });

  it('un recordatorio grupal se cierra sólo cuando todos sus destinatarios confirman', async () => {
    const creator = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor',
    });
    const one = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Uno',
    });
    const two = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Dos',
    });

    const alarm = await createOperationalAlarm(creator, {
      kind: OperationalAlarmKind.RECORDATORIO,
      scope: OperationalAlarmScope.GRUPO,
      title: 'Validar inventario especial',
      dueAt: new Date(Date.now() + 15 * 60_000),
      recipientIds: [one.id, two.id],
    });

    const recipients = await prisma.operationalAlarmRecipient.findMany({
      where: { alarmId: alarm.id },
      orderBy: { userId: 'asc' },
    });
    const first = recipients.find((row) => row.userId === one.id)!;
    const second = recipients.find((row) => row.userId === two.id)!;

    await acknowledgeOperationalAlarm(one, first.id);
    expect(
      (await prisma.operationalAlarm.findUniqueOrThrow({ where: { id: alarm.id } })).status,
    ).toBe(OperationalAlarmStatus.ACTIVA);

    await acknowledgeOperationalAlarm(two, second.id);
    expect(
      (await prisma.operationalAlarm.findUniqueOrThrow({ where: { id: alarm.id } })).status,
    ).toBe(OperationalAlarmStatus.CERRADA);
  });
});
