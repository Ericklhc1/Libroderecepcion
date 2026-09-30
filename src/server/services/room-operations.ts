import 'server-only';

import {
  EntryType,
  OperationalAlarmStatus,
  Priority,
  Severity,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { OPEN_GUARANTEE_STATES } from '@/domain/guarantees';
import { addHotelCalendarDays, hotelDayStart } from '@/domain/time';

export type RoomMonitorItem = {
  id: string;
  kind: 'NOVEDAD' | 'INCIDENCIA' | 'TAREA' | 'ALERTA' | 'GARANTIA' | 'GIMNASIO' | 'ESTACIONAMIENTO';
  title: string;
  subtitle: string | null;
  href: string;
  critical: boolean;
  timestamp: Date;
};

export type RoomMonitorRoom = {
  id: string;
  number: string;
  floor: number;
  openCount: number;
  criticalCount: number;
  counts: {
    entries: number;
    tasks: number;
    alarms: number;
    guarantees: number;
    services: number;
  };
  items: RoomMonitorItem[];
};

export async function getRoomOperationsBoard(options: {
  includeCashContext: boolean;
  selectedRoomNumber?: string | null;
}) {
  const now = new Date();
  const recentFrom = hotelDayStart(addHotelCalendarDays(now, -30));

  const rooms = await prisma.room.findMany({
    where: { active: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    select: {
      id: true,
      number: true,
      floor: true,
      entries: {
        where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
        orderBy: [{ priority: 'desc' }, { occurredAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          humanId: true,
          type: true,
          title: true,
          priority: true,
          severity: true,
          status: true,
          occurredAt: true,
        },
      },
      tasks: {
        where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          humanId: true,
          title: true,
          priority: true,
          status: true,
          dueAt: true,
          createdAt: true,
        },
      },
      operationalAlarms: {
        where: { status: OperationalAlarmStatus.ACTIVA },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          title: true,
          dueAt: true,
          kind: true,
          sourceLink: true,
        },
      },
      ...(options.includeCashContext
        ? {
            guarantees: {
              where: { deletedAt: null, state: { in: OPEN_GUARANTEE_STATES } },
              orderBy: { createdAt: 'desc' as const },
              take: 15,
              select: {
                id: true,
                humanId: true,
                state: true,
                guestName: true,
                reference: true,
                createdAt: true,
              },
            },
            gymPasses: {
              where: { issuedAt: { gte: recentFrom } },
              orderBy: { issuedAt: 'desc' as const },
              take: 12,
              select: {
                id: true,
                humanId: true,
                serviceType: true,
                status: true,
                guestName: true,
                reservationCode: true,
                issuedAt: true,
              },
            },
          }
        : {}),
    },
  });

  const mapped: RoomMonitorRoom[] = rooms.map((room) => {
    const items: RoomMonitorItem[] = [];

    for (const entry of room.entries) {
      items.push({
        id: entry.id,
        kind: entry.type === EntryType.INCIDENCIA ? 'INCIDENCIA' : 'NOVEDAD',
        title: `#${entry.humanId} · ${entry.title}`,
        subtitle: entry.status.replaceAll('_', ' '),
        href: `/libro/${entry.id}`,
        critical: entry.priority === Priority.CRITICA || entry.severity === Severity.CRITICA,
        timestamp: entry.occurredAt,
      });
    }

    for (const task of room.tasks) {
      const overdue = Boolean(task.dueAt && task.dueAt < now);
      items.push({
        id: task.id,
        kind: 'TAREA',
        title: `#${task.humanId} · ${task.title}`,
        subtitle: overdue ? 'Vencida' : task.status.replaceAll('_', ' '),
        href: `/tareas/${task.id}`,
        critical: overdue || task.priority === Priority.CRITICA,
        timestamp: task.dueAt ?? task.createdAt,
      });
    }

    for (const alarm of room.operationalAlarms) {
      items.push({
        id: alarm.id,
        kind: 'ALERTA',
        title: alarm.title,
        subtitle: alarm.dueAt <= now ? 'Vencida / disparada' : 'Programada',
        href: alarm.sourceLink ?? '/alertas',
        critical: alarm.dueAt <= now,
        timestamp: alarm.dueAt,
      });
    }

    if (options.includeCashContext && 'guarantees' in room) {
      for (const guarantee of room.guarantees) {
        items.push({
          id: guarantee.id,
          kind: 'GARANTIA',
          title: `Garantía #${guarantee.humanId}`,
          subtitle: [guarantee.guestName, guarantee.reference, guarantee.state.replaceAll('_', ' ')].filter(Boolean).join(' · '),
          href: '/caja?seccion=garantias',
          critical: guarantee.state === 'PENDIENTE',
          timestamp: guarantee.createdAt,
        });
      }
    }

    if (options.includeCashContext && 'gymPasses' in room) {
      for (const pass of room.gymPasses) {
        const kind = pass.serviceType === 'ESTACIONAMIENTO' ? 'ESTACIONAMIENTO' : 'GIMNASIO';
        items.push({
          id: pass.id,
          kind,
          title: `${kind === 'ESTACIONAMIENTO' ? 'Ticket estacionamiento' : 'Folio gimnasio'} #${pass.humanId}`,
          subtitle: [pass.guestName, pass.reservationCode ? `Reserva ${pass.reservationCode}` : null, pass.status].filter(Boolean).join(' · '),
          href: `/caja?seccion=${kind === 'ESTACIONAMIENTO' ? 'estacionamiento' : 'gimnasio'}`,
          critical: false,
          timestamp: pass.issuedAt,
        });
      }
    }

    const currentItems = items.filter((item) => !['GIMNASIO', 'ESTACIONAMIENTO'].includes(item.kind));
    const criticalCount = currentItems.filter((item) => item.critical).length;

    return {
      id: room.id,
      number: room.number,
      floor: room.floor ?? Number(room.number[0]),
      openCount: currentItems.length,
      criticalCount,
      counts: {
        entries: room.entries.length,
        tasks: room.tasks.length,
        alarms: room.operationalAlarms.length,
        guarantees: options.includeCashContext && 'guarantees' in room ? room.guarantees.length : 0,
        services: options.includeCashContext && 'gymPasses' in room ? room.gymPasses.length : 0,
      },
      items: items.sort((a, b) => Number(b.critical) - Number(a.critical) || b.timestamp.getTime() - a.timestamp.getTime()),
    };
  });

  const selected =
    mapped.find((room) => room.number === options.selectedRoomNumber) ?? null;

  return {
    generatedAt: now,
    rooms: mapped,
    selected,
    summary: {
      totalRooms: mapped.length,
      withOpenContext: mapped.filter((room) => room.openCount > 0).length,
      withCriticalContext: mapped.filter((room) => room.criticalCount > 0).length,
      openItems: mapped.reduce((sum, room) => sum + room.openCount, 0),
    },
  };
}
