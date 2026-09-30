import 'server-only';

import {
  FineStatus,
  FollowUpStatus,
  GuaranteeState,
  OperationalAlarmStatus,
  Priority,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';

export type RoomMonitorLevel = 'clean' | 'active' | 'attention' | 'critical';

export type RoomMonitorSummary = {
  id: string;
  number: string;
  floor: number | null;
  activeCount: number;
  attentionCount: number;
  criticalCount: number;
  level: RoomMonitorLevel;
};

export type RoomMonitorItem = {
  id: string;
  kind:
    | 'entry'
    | 'task'
    | 'followup'
    | 'alarm'
    | 'guarantee'
    | 'fine'
    | 'gym'
    | 'parking';
  ref: string | null;
  title: string;
  status: string;
  priority: string | null;
  createdAt: Date;
  href: string | null;
  open: boolean;
  critical: boolean;
  attention: boolean;
};

function levelFor(summary: Pick<RoomMonitorSummary, 'activeCount' | 'attentionCount' | 'criticalCount'>): RoomMonitorLevel {
  if (summary.criticalCount > 0) return 'critical';
  if (summary.attentionCount > 0) return 'attention';
  if (summary.activeCount > 0) return 'active';
  return 'clean';
}

function roomIdFromTask(task: {
  roomId: string | null;
  entry: { roomId: string | null } | null;
}) {
  return task.roomId ?? task.entry?.roomId ?? null;
}

function roomIdFromFollowUp(followUp: {
  entry: { roomId: string | null } | null;
  task: { roomId: string | null; entry: { roomId: string | null } | null } | null;
}) {
  return followUp.entry?.roomId ?? followUp.task?.roomId ?? followUp.task?.entry?.roomId ?? null;
}

export async function getRoomMonitor(selectedNumber?: string | null) {
  const now = new Date();

  const [
    rooms,
    openEntries,
    openTasks,
    openFollowUps,
    activeAlarms,
    openGuarantees,
    openFines,
  ] = await Promise.all([
    prisma.room.findMany({
      where: { active: true },
      select: { id: true, number: true, floor: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        roomId: { not: null },
        status: { in: ENTRY_OPEN_STATUSES },
      },
      select: {
        id: true,
        humanId: true,
        roomId: true,
        type: true,
        title: true,
        status: true,
        priority: true,
        severity: true,
        occurredAt: true,
      },
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { in: TASK_OPEN_STATUSES },
        OR: [{ roomId: { not: null } }, { entry: { roomId: { not: null } } }],
      },
      select: {
        id: true,
        humanId: true,
        roomId: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        createdAt: true,
        entry: { select: { roomId: true } },
      },
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
        OR: [
          { entry: { roomId: { not: null } } },
          { task: { roomId: { not: null } } },
          { task: { entry: { roomId: { not: null } } } },
        ],
      },
      select: {
        id: true,
        humanId: true,
        action: true,
        status: true,
        priority: true,
        scheduledAt: true,
        createdAt: true,
        entry: { select: { roomId: true } },
        task: { select: { roomId: true, entry: { select: { roomId: true } } } },
      },
    }),
    prisma.operationalAlarm.findMany({
      where: { status: OperationalAlarmStatus.ACTIVA },
      select: {
        id: true,
        title: true,
        dueAt: true,
        sourceEntity: true,
        sourceId: true,
        createdAt: true,
      },
    }),
    prisma.guarantee.findMany({
      where: {
        deletedAt: null,
        roomNumber: { not: null },
        state: {
          in: [
            GuaranteeState.PENDIENTE,
            GuaranteeState.VIGENTE,
            GuaranteeState.APLICADA_PARCIALMENTE,
          ],
        },
      },
      select: {
        id: true,
        humanId: true,
        roomNumber: true,
        state: true,
        dueAt: true,
        createdAt: true,
      },
    }),
    prisma.fine.findMany({
      where: {
        deletedAt: null,
        status: { in: [FineStatus.REGISTRADA, FineStatus.NOTIFICADA] },
      },
      select: {
        id: true,
        humanId: true,
        roomId: true,
        status: true,
        reason: true,
        createdAt: true,
      },
    }),
  ]);

  const byId = new Map(
    rooms.map((room) => [
      room.id,
      {
        id: room.id,
        number: room.number,
        floor: room.floor,
        activeCount: 0,
        attentionCount: 0,
        criticalCount: 0,
        level: 'clean' as RoomMonitorLevel,
      },
    ]),
  );
  const roomIdByNumber = new Map(rooms.map((room) => [room.number, room.id]));

  const entryRoom = new Map<string, string>();
  for (const entry of openEntries) {
    if (!entry.roomId) continue;
    entryRoom.set(entry.id, entry.roomId);
    const summary = byId.get(entry.roomId);
    if (!summary) continue;
    summary.activeCount += 1;
    if (entry.priority === Priority.CRITICA || entry.severity === 'CRITICA') {
      summary.criticalCount += 1;
    }
  }

  const taskRoom = new Map<string, string>();
  for (const task of openTasks) {
    const roomId = roomIdFromTask(task);
    if (!roomId) continue;
    taskRoom.set(task.id, roomId);
    const summary = byId.get(roomId);
    if (!summary) continue;
    summary.activeCount += 1;
    if (task.priority === Priority.CRITICA) summary.criticalCount += 1;
    if (task.dueAt && task.dueAt < now) summary.attentionCount += 1;
  }

  for (const followUp of openFollowUps) {
    const roomId = roomIdFromFollowUp(followUp);
    if (!roomId) continue;
    const summary = byId.get(roomId);
    if (!summary) continue;
    summary.activeCount += 1;
    if (followUp.priority === Priority.CRITICA) summary.criticalCount += 1;
    if (
      followUp.status === FollowUpStatus.VENCIDO ||
      (followUp.scheduledAt && followUp.scheduledAt < now)
    ) {
      summary.attentionCount += 1;
    }
  }

  for (const alarm of activeAlarms) {
    let roomId: string | null = null;
    if (alarm.sourceEntity === 'OperationalEntry' && alarm.sourceId) {
      roomId = entryRoom.get(alarm.sourceId) ?? null;
    } else if (alarm.sourceEntity === 'Task' && alarm.sourceId) {
      roomId = taskRoom.get(alarm.sourceId) ?? null;
    } else if (alarm.sourceEntity === 'Room' && alarm.sourceId) {
      roomId = alarm.sourceId;
    }
    if (!roomId) continue;
    const summary = byId.get(roomId);
    if (!summary) continue;
    summary.activeCount += 1;
    if (alarm.dueAt < now) summary.attentionCount += 1;
  }

  for (const guarantee of openGuarantees) {
    if (!guarantee.roomNumber) continue;
    const roomId = roomIdByNumber.get(guarantee.roomNumber);
    if (!roomId) continue;
    const summary = byId.get(roomId);
    if (!summary) continue;
    summary.activeCount += 1;
    if (guarantee.dueAt && guarantee.dueAt < now) summary.attentionCount += 1;
  }

  for (const fine of openFines) {
    const summary = byId.get(fine.roomId);
    if (!summary) continue;
    summary.activeCount += 1;
    summary.attentionCount += 1;
  }

  for (const summary of byId.values()) {
    summary.level = levelFor(summary);
  }

  const roomSummaries = [...byId.values()].sort((a, b) => Number(a.number) - Number(b.number));
  const selectedRoom = selectedNumber
    ? rooms.find((room) => room.number === selectedNumber) ?? null
    : null;

  if (!selectedRoom) {
    return {
      rooms: roomSummaries,
      selected: null,
      totals: {
        rooms: roomSummaries.length,
        active: roomSummaries.filter((room) => room.activeCount > 0).length,
        attention: roomSummaries.filter((room) => room.attentionCount > 0).length,
        critical: roomSummaries.filter((room) => room.criticalCount > 0).length,
      },
    };
  }

  const [entries, tasks, followUps, guarantees, fines, passes] = await Promise.all([
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, roomId: selectedRoom.id },
      select: {
        id: true,
        humanId: true,
        type: true,
        title: true,
        status: true,
        priority: true,
        severity: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 40,
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        OR: [{ roomId: selectedRoom.id }, { entry: { roomId: selectedRoom.id } }],
      },
      select: {
        id: true,
        humanId: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        OR: [
          { entry: { roomId: selectedRoom.id } },
          { task: { roomId: selectedRoom.id } },
          { task: { entry: { roomId: selectedRoom.id } } },
        ],
      },
      select: {
        id: true,
        humanId: true,
        action: true,
        status: true,
        priority: true,
        scheduledAt: true,
        createdAt: true,
        entryId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.guarantee.findMany({
      where: { deletedAt: null, roomNumber: selectedRoom.number },
      select: {
        id: true,
        humanId: true,
        state: true,
        kind: true,
        amount: true,
        currency: true,
        dueAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.fine.findMany({
      where: { deletedAt: null, roomId: selectedRoom.id },
      select: {
        id: true,
        humanId: true,
        status: true,
        reason: true,
        amount: true,
        currency: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.gymPass.findMany({
      where: {
        OR: [{ roomId: selectedRoom.id }, { roomNumber: selectedRoom.number }],
      },
      select: {
        id: true,
        humanId: true,
        serviceType: true,
        status: true,
        reservationCode: true,
        guestName: true,
        serviceDate: true,
        issuedAt: true,
      },
      orderBy: [{ serviceDate: 'desc' }, { issuedAt: 'desc' }],
      take: 30,
    }),
  ]);

  const entryIds = entries.map((entry) => entry.id);
  const taskIds = tasks.map((task) => task.id);
  const alarms = await prisma.operationalAlarm.findMany({
    where: {
      OR: [
        { sourceEntity: 'OperationalEntry', sourceId: { in: entryIds } },
        { sourceEntity: 'Task', sourceId: { in: taskIds } },
        { sourceEntity: 'Room', sourceId: selectedRoom.id },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      createdAt: true,
      sourceLink: true,
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'desc' }],
    take: 40,
  });

  const items: RoomMonitorItem[] = [
    ...entries.map((entry) => ({
      id: entry.id,
      kind: 'entry' as const,
      ref: `#${entry.humanId}`,
      title: entry.title,
      status: entry.status,
      priority: entry.priority,
      createdAt: entry.occurredAt,
      href: `/libro/${entry.id}`,
      open: ENTRY_OPEN_STATUSES.includes(entry.status),
      critical: entry.priority === Priority.CRITICA || entry.severity === 'CRITICA',
      attention: false,
    })),
    ...tasks.map((task) => ({
      id: task.id,
      kind: 'task' as const,
      ref: `#${task.humanId}`,
      title: task.title,
      status: task.status,
      priority: task.priority,
      createdAt: task.createdAt,
      href: `/tareas/${task.id}`,
      open: TASK_OPEN_STATUSES.includes(task.status),
      critical: task.priority === Priority.CRITICA,
      attention: Boolean(task.dueAt && task.dueAt < now && TASK_OPEN_STATUSES.includes(task.status)),
    })),
    ...followUps.map((followUp) => ({
      id: followUp.id,
      kind: 'followup' as const,
      ref: `#${followUp.humanId}`,
      title: followUp.action,
      status: followUp.status,
      priority: followUp.priority,
      createdAt: followUp.createdAt,
      href: followUp.entryId ? `/libro/${followUp.entryId}` : '/seguimientos',
      open: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO].includes(followUp.status),
      critical: followUp.priority === Priority.CRITICA,
      attention:
        followUp.status === FollowUpStatus.VENCIDO ||
        Boolean(followUp.scheduledAt && followUp.scheduledAt < now),
    })),
    ...alarms.map((alarm) => ({
      id: alarm.id,
      kind: 'alarm' as const,
      ref: null,
      title: alarm.title,
      status: alarm.status,
      priority: null,
      createdAt: alarm.createdAt,
      href: alarm.sourceLink ?? '/alertas',
      open: alarm.status === OperationalAlarmStatus.ACTIVA,
      critical: false,
      attention: alarm.status === OperationalAlarmStatus.ACTIVA && alarm.dueAt < now,
    })),
    ...guarantees.map((guarantee) => ({
      id: guarantee.id,
      kind: 'guarantee' as const,
      ref: `#${guarantee.humanId}`,
      title: `${guarantee.kind} · ${guarantee.currency} ${Number(guarantee.amount).toLocaleString('es-CL')}`,
      status: guarantee.state,
      priority: null,
      createdAt: guarantee.createdAt,
      href: '/caja?seccion=garantias',
      open: [
        GuaranteeState.PENDIENTE,
        GuaranteeState.VIGENTE,
        GuaranteeState.APLICADA_PARCIALMENTE,
      ].includes(guarantee.state),
      critical: false,
      attention: Boolean(guarantee.dueAt && guarantee.dueAt < now),
    })),
    ...fines.map((fine) => ({
      id: fine.id,
      kind: 'fine' as const,
      ref: `#${fine.humanId}`,
      title: `${fine.reason}${fine.amount ? ` · ${fine.currency} ${Number(fine.amount).toLocaleString('es-CL')}` : ''}`,
      status: fine.status,
      priority: null,
      createdAt: fine.createdAt,
      href: '/caja',
      open: [FineStatus.REGISTRADA, FineStatus.NOTIFICADA].includes(fine.status),
      critical: false,
      attention: [FineStatus.REGISTRADA, FineStatus.NOTIFICADA].includes(fine.status),
    })),
    ...passes.map((pass) => ({
      id: pass.id,
      kind: pass.serviceType === 'ESTACIONAMIENTO' ? ('parking' as const) : ('gym' as const),
      ref: `#${pass.humanId}`,
      title:
        pass.serviceType === 'ESTACIONAMIENTO'
          ? `Estacionamiento · Reserva ${pass.reservationCode ?? 'sin ID'}`
          : `Gimnasio · ${pass.guestName}`,
      status: pass.status,
      priority: null,
      createdAt: pass.issuedAt,
      href:
        pass.serviceType === 'ESTACIONAMIENTO'
          ? '/caja?seccion=estacionamiento'
          : '/caja?seccion=gimnasio',
      open: false,
      critical: false,
      attention: false,
    })),
  ].sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return {
    rooms: roomSummaries,
    totals: {
      rooms: roomSummaries.length,
      active: roomSummaries.filter((room) => room.activeCount > 0).length,
      attention: roomSummaries.filter((room) => room.attentionCount > 0).length,
      critical: roomSummaries.filter((room) => room.criticalCount > 0).length,
    },
    selected: {
      room: selectedRoom,
      summary: byId.get(selectedRoom.id)!,
      items,
    },
  };
}
