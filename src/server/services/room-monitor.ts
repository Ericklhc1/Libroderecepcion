import 'server-only';

import {
  EntryType,
  GuaranteeState,
  OperationalAlarmStatus,
  Priority,
  Severity,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { ROOM_NUMBERS, roomFloor } from '@/domain/room-catalog';
import { NotFoundError } from '@/server/errors';

const OPEN_GUARANTEE_STATES: GuaranteeState[] = [
  GuaranteeState.PENDIENTE,
  GuaranteeState.VIGENTE,
  GuaranteeState.APLICADA_PARCIALMENTE,
];

function latestDate(values: Array<Date | null | undefined>): Date | null {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export type RoomMonitorTile = {
  id: string;
  number: string;
  floor: number;
  openEntries: number;
  criticalIncidents: number;
  openTasks: number;
  overdueTasks: number;
  activeAlarms: number;
  openGuarantees: number;
  attention: 'critical' | 'attention' | 'active' | 'clear';
  lastActivityAt: Date | null;
};

export async function getRoomMonitorOverview(now = new Date()) {
  const rooms = await prisma.room.findMany({
    where: { active: true, number: { in: ROOM_NUMBERS } },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    select: {
      id: true,
      number: true,
      floor: true,
      entries: {
        where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
        select: {
          id: true,
          type: true,
          severity: true,
          priority: true,
          occurredAt: true,
          updatedAt: true,
        },
      },
      tasks: {
        where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
        select: {
          id: true,
          dueAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const [guarantees, alarms] = await Promise.all([
    prisma.guarantee.findMany({
      where: {
        deletedAt: null,
        roomNumber: { in: ROOM_NUMBERS },
        state: { in: OPEN_GUARANTEE_STATES },
      },
      select: { roomNumber: true, updatedAt: true },
    }),
    prisma.operationalAlarm.findMany({
      where: {
        roomNumber: { in: ROOM_NUMBERS },
        status: OperationalAlarmStatus.ACTIVA,
      },
      select: { roomNumber: true, updatedAt: true },
    }),
  ]);

  const guaranteeMap = new Map<string, { count: number; latest: Date | null }>();
  for (const row of guarantees) {
    if (!row.roomNumber) continue;
    const current = guaranteeMap.get(row.roomNumber) ?? { count: 0, latest: null };
    current.count += 1;
    current.latest = latestDate([current.latest, row.updatedAt]);
    guaranteeMap.set(row.roomNumber, current);
  }

  const alarmMap = new Map<string, { count: number; latest: Date | null }>();
  for (const row of alarms) {
    if (!row.roomNumber) continue;
    const current = alarmMap.get(row.roomNumber) ?? { count: 0, latest: null };
    current.count += 1;
    current.latest = latestDate([current.latest, row.updatedAt]);
    alarmMap.set(row.roomNumber, current);
  }

  const tiles: RoomMonitorTile[] = rooms.map((room) => {
    const guarantee = guaranteeMap.get(room.number);
    const alarm = alarmMap.get(room.number);
    const criticalIncidents = room.entries.filter(
      (entry) =>
        entry.type === EntryType.INCIDENCIA &&
        (entry.severity === Severity.CRITICA || entry.priority === Priority.CRITICA),
    ).length;
    const overdueTasks = room.tasks.filter((task) => task.dueAt && task.dueAt < now).length;
    const openEntries = room.entries.length;
    const openTasks = room.tasks.length;
    const activeAlarms = alarm?.count ?? 0;
    const openGuarantees = guarantee?.count ?? 0;
    const attention =
      criticalIncidents > 0 || overdueTasks > 0
        ? 'critical'
        : activeAlarms > 0 || openGuarantees > 0
          ? 'attention'
          : openEntries > 0 || openTasks > 0
            ? 'active'
            : 'clear';

    return {
      id: room.id,
      number: room.number,
      floor: room.floor ?? roomFloor(room.number) ?? 0,
      openEntries,
      criticalIncidents,
      openTasks,
      overdueTasks,
      activeAlarms,
      openGuarantees,
      attention,
      lastActivityAt: latestDate([
        ...room.entries.map((entry) => entry.updatedAt ?? entry.occurredAt),
        ...room.tasks.map((task) => task.updatedAt ?? task.createdAt),
        guarantee?.latest,
        alarm?.latest,
      ]),
    };
  });

  return {
    rooms: tiles,
    summary: {
      total: tiles.length,
      withActivity: tiles.filter((room) => room.attention !== 'clear').length,
      critical: tiles.filter((room) => room.attention === 'critical').length,
      openEntries: tiles.reduce((sum, room) => sum + room.openEntries, 0),
      openTasks: tiles.reduce((sum, room) => sum + room.openTasks, 0),
      activeAlarms: tiles.reduce((sum, room) => sum + room.activeAlarms, 0),
      openGuarantees: tiles.reduce((sum, room) => sum + room.openGuarantees, 0),
    },
  };
}

export async function getRoomMonitorDetail(number: string) {
  const room = await prisma.room.findFirst({
    where: { number, active: true },
    select: { id: true, number: true, floor: true },
  });
  if (!room) throw new NotFoundError('Esa habitación no existe en el catálogo operativo.');

  const [entries, tasks, alarms, guarantees, passes, fines] = await Promise.all([
    prisma.operationalEntry.findMany({
      where: { roomId: room.id, deletedAt: null },
      orderBy: [{ status: 'asc' }, { occurredAt: 'desc' }],
      take: 40,
      select: {
        id: true,
        humanId: true,
        type: true,
        title: true,
        status: true,
        priority: true,
        severity: true,
        occurredAt: true,
        dueAt: true,
        owner: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
    prisma.task.findMany({
      where: { roomId: room.id, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 40,
      select: {
        id: true,
        humanId: true,
        title: true,
        status: true,
        priority: true,
        startsAt: true,
        dueAt: true,
        createdAt: true,
        assignee: { select: { name: true } },
      },
    }),
    prisma.operationalAlarm.findMany({
      where: { roomNumber: number },
      orderBy: [{ status: 'asc' }, { dueAt: 'desc' }],
      take: 30,
      select: {
        id: true,
        title: true,
        note: true,
        kind: true,
        status: true,
        dueAt: true,
        sourceLink: true,
        createdBy: { select: { name: true } },
      },
    }),
    prisma.guarantee.findMany({
      where: { roomNumber: number, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        humanId: true,
        state: true,
        kind: true,
        amount: true,
        currency: true,
        guestName: true,
        reference: true,
        dueAt: true,
        createdAt: true,
      },
    }),
    prisma.gymPass.findMany({
      where: { roomNumber: number },
      orderBy: [{ serviceDate: 'desc' }, { issuedAt: 'desc' }],
      take: 30,
      select: {
        id: true,
        humanId: true,
        serviceType: true,
        serviceDate: true,
        guestName: true,
        reservationCode: true,
        status: true,
        issuedAt: true,
      },
    }),
    prisma.fine.findMany({
      where: { roomId: room.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        humanId: true,
        kind: true,
        status: true,
        reason: true,
        amount: true,
        currency: true,
        reservationCode: true,
        guestName: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    room,
    entries,
    tasks,
    alarms,
    guarantees,
    passes,
    fines,
  };
}
