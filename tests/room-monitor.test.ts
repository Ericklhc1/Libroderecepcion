import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {CurrentUser} from '@/server/auth/current-user';
import {
  EntryType,
  FollowUpStatus,
  GuaranteeKind,
  GuaranteeState,
  OperationalAlarmKind,
  OperationalAlarmScope,
  Priority,
  Severity,
  Prisma,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createOperationalAlarm } from '@/server/services/operational-alarms';
import {
  getRoomMonitorDetail,
  getRoomMonitorOverview,
} from '@/server/services/room-monitor';

describe('Novedades / habitación', () => {
  let reader: CurrentUser;
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    reader=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    await seedCatalog();
  });

  it('siempre representa exactamente las 89 habitaciones canónicas', async () => {
    const overview = await getRoomMonitorOverview(reader);

    expect(overview.rooms).toHaveLength(89);
    expect(overview.summary.total).toBe(89);
    expect(overview.rooms[0]?.number).toBe('401');
    expect(overview.rooms.at(-1)?.number).toBe('630');
    expect(overview.rooms.filter((room) => room.floor === 4)).toHaveLength(29);
    expect(overview.rooms.filter((room) => room.floor === 5)).toHaveLength(30);
    expect(overview.rooms.filter((room) => room.floor === 6)).toHaveLength(30);
  });

  it('agrupa Novedad, Tarea y Alerta por habitación sin modelar estadía PMS', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción monitor',
    });
    const room = await prisma.room.findFirstOrThrow({
      where: { number: '512', active: true },
    });

    const entry = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Aire acondicionado sin responder',
      description: 'Se reporta falla y se coordina revisión.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });

    const task = await createTask(user, {
      title: 'Verificar reparación de aire',
      priority: Priority.ALTA,
      entryId: entry.id,
      tags: [],
      checklist: [],
    });

    await prisma.followUp.create({
      data: {
        action: 'Confirmar solución',
        nextAction: 'Validar nuevamente con Recepción',
        status: FollowUpStatus.PENDIENTE,
        ownerId: user.id,
        createdById: user.id,
        taskId: task.id,
      },
    });

    await prisma.guarantee.create({
      data: {
        kind: GuaranteeKind.EFECTIVO,
        state: GuaranteeState.VIGENTE,
        amount: new Prisma.Decimal(100000),
        currency: 'CLP',
        roomNumber: '512',
        guestName: 'Huésped demo',
        createdById: user.id,
      },
    });

    const alarm = await createOperationalAlarm(user, {
      kind: OperationalAlarmKind.RECORDATORIO,
      scope: OperationalAlarmScope.INDIVIDUAL,
      title: 'Revisar habitación 512',
      dueAt: new Date(Date.now() + 30 * 60_000),
      recipientIds: [user.id],
      sourceEntity: 'OperationalEntry',
      sourceId: entry.id,
      sourceLink: `/libro/${entry.id}`,
    });

    expect(task.roomId).toBe(room.id);
    expect(alarm.roomNumber).toBe('512');

    const overview = await getRoomMonitorOverview(reader);
    const tile = overview.rooms.find((item) => item.number === '512');

    expect(tile).toMatchObject({
      openEntries: 1,
      criticalIncidents: 1,
      openTasks: 1,
      openFollowUps: 1,
      activeAlarms: 1,
      openGuarantees: 1,
      attention: 'critical',
    });

    const detail = await getRoomMonitorDetail('512', reader);
    expect(detail.entries.map((item) => item.id)).toContain(entry.id);
    expect(detail.tasks.map((item) => item.id)).toContain(task.id);
    expect(detail.followUps).toHaveLength(1);
    expect(detail.alarms.map((item) => item.id)).toContain(alarm.id);
    expect(detail.guarantees).toHaveLength(1);

    // El monitor usa Room sólo como llave de contexto: no necesita RoomStay.
    expect(await prisma.roomStay.count({ where: { roomId: room.id } })).toBe(0);
  });


  it('muestra folios de Caja sólo como reflejo histórico de los últimos 30 días', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción folios',
    });
    const now = new Date('2026-09-30T12:00:00.000Z');

    await prisma.gymPass.createMany({
      data: [
        {
          id: 'gym-recent-room-monitor',
          serviceDate: new Date('2026-09-29T00:00:00.000Z'),
          serviceType: 'GIMNASIO',
          roomNumber: '512',
          guestName: 'Huésped reciente',
          receptionistId: user.id,
        },
        {
          id: 'gym-old-room-monitor',
          serviceDate: new Date('2026-08-20T00:00:00.000Z'),
          serviceType: 'ESTACIONAMIENTO',
          roomNumber: '512',
          guestName: 'Huésped antiguo',
          reservationCode: 'OLD-512',
          receptionistId: user.id,
        },
      ],
    });

    const detail = await getRoomMonitorDetail('512', reader, now);

    expect(detail.passes.map((item) => item.id)).toContain('gym-recent-room-monitor');
    expect(detail.passes.map((item) => item.id)).not.toContain('gym-old-room-monitor');
  });

  it('lleva el click de habitación directamente al panel visible de detalle', () => {
    const page = readFileSync('src/app/(app)/novedades/habitacion/page.tsx', 'utf8');

    expect(page).toContain('#detalle-habitacion');
    expect(page).toContain('id="detalle-habitacion"');
    expect(page).toContain("detail ? 'order-first scroll-mt-28' : 'order-last'");
    expect(page).toContain('Folios de Caja · últimos 30 días');
  });

  it('rechaza números fuera del catálogo', async () => {
    await expect(getRoomMonitorDetail('999', reader)).rejects.toThrow(/no existe/i);
  });
});
