import { beforeEach, describe, expect, it } from 'vitest';
import { AlarmKind, AlarmScope, AlarmStatus, ShiftType } from '@prisma/client';
import {
  createAlarm,
  materializeDueAlarmsForUser,
  respondAlarm,
} from '@/server/services/alarms';
import { closeShift, prepareHandover, sendHandover } from '@/server/services/shifts';
import { closeShiftCash } from '@/server/services/cash-closure';
import { saveCashCount } from '@/server/services/cash';
import {
  createShift,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';

async function seedFunds() {
  const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Admin alarmas' });
  await prisma.cashFund.createMany({
    data: [
      { currency: 'CLP', amount: 100000, updatedById: admin.id },
      { currency: 'USD', amount: 0, updatedById: admin.id },
    ],
  });
  const denominations = await prisma.cashDenomination.findMany({
    where: { currency: 'CLP', active: true },
    orderBy: { value: 'desc' },
  });
  return denominations;
}

describe('Timers y reminders', () => {
  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('un reminder persiste y se materializa por destinatario', async () => {
    const creator = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Creador' });
    const recipient = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Receptor' });

    const alarm = await createAlarm(creator, {
      kind: AlarmKind.REMINDER,
      scope: AlarmScope.INDIVIDUAL,
      title: 'Revisar garantía 501',
      dueAt: new Date(Date.now() + 60_000),
      userIds: [recipient.id],
    });
    await prisma.alarm.update({
      where: { id: alarm.id },
      data: { dueAt: new Date(Date.now() - 1_000) },
    });

    expect(await materializeDueAlarmsForUser(recipient.id)).toBe(1);
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: recipient.id, type: 'ALARMA' },
    });
    expect(notification.title).toBe('Revisar garantía 501');

    const own = await prisma.alarmRecipient.findFirstOrThrow({
      where: { alarmId: alarm.id, userId: recipient.id },
    });
    await respondAlarm(recipient, { recipientId: own.id, action: 'ACK' });
    expect((await prisma.alarm.findUniqueOrThrow({ where: { id: alarm.id } })).status).toBe(
      AlarmStatus.COMPLETADA,
    );
  });

  it('una alarma grupal se confirma por persona, no para todo el grupo', async () => {
    const creator = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Creador' });
    const a = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'A' });
    const b = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'B' });
    const alarm = await createAlarm(creator, {
      kind: AlarmKind.REMINDER,
      scope: AlarmScope.GRUPO,
      title: 'Llegada de grupo',
      dueAt: new Date(Date.now() + 60_000),
      userIds: [a.id, b.id],
    });
    const rows = await prisma.alarmRecipient.findMany({ where: { alarmId: alarm.id } });
    const rowA = rows.find((row) => row.userId === a.id)!;
    await respondAlarm(a, { recipientId: rowA.id, action: 'ACK' });

    const state = await prisma.alarm.findUniqueOrThrow({
      where: { id: alarm.id },
      include: { recipients: true },
    });
    expect(state.status).toBe(AlarmStatus.ACTIVA);
    expect(state.recipients.find((row) => row.userId === a.id)?.acknowledgedAt).not.toBeNull();
    expect(state.recipients.find((row) => row.userId === b.id)?.acknowledgedAt).toBeNull();
  });

  it('timer muere al cerrar su turno pero reminder sobrevive', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const shift = await createShift({ userId: user.id, type: ShiftType.DIA });
    await openShiftAs(user, shift);

    const timer = await createAlarm(user, {
      kind: AlarmKind.TIMER,
      scope: AlarmScope.INDIVIDUAL,
      title: 'Timer del turno',
      dueAt: new Date(Date.now() + 60_000),
      userIds: [user.id],
    });
    const reminder = await createAlarm(user, {
      kind: AlarmKind.REMINDER,
      scope: AlarmScope.INDIVIDUAL,
      title: 'Reminder persistente',
      dueAt: new Date(Date.now() + 120_000),
      userIds: [user.id],
    });

    const denominations = await seedFunds();
    const handover = await prepareHandover(user, shift.id);
    const twenty = denominations.find((row) => Number(row.value) === 20000);
    if (!twenty) throw new Error('Falta denominación de 20.000');
    await saveCashCount(user, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [twenty.id]: 5 },
    });
    await closeShiftCash(user, { shiftId: shift.id });
    await sendHandover(user, { shiftId: shift.id });
    await closeShift(user, { shiftId: shift.id });

    expect((await prisma.alarm.findUniqueOrThrow({ where: { id: timer.id } })).status).toBe(
      AlarmStatus.CANCELADA,
    );
    expect((await prisma.alarm.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe(
      AlarmStatus.ACTIVA,
    );
  });
});
