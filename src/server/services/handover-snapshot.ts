import 'server-only';
import {
  AlertLevel,
  EntryStatus,
  EntryType,
  FineStatus,
  FollowUpStatus,
  GuaranteeStatus,
  HandoverLevel,
  KeyStatus,
  ReservationStatus,
  RoomStayStage,
  RoomStayStatus,
  TaskStatus,
} from '@prisma/client';
import type { Priority, Severity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  ALERT_TYPE_LABEL,
  ENTRY_OPEN_STATUSES,
  ENTRY_TYPE_LABEL,
  PRIORITY_LABEL,
  TASK_OPEN_STATUSES,
} from '@/domain/labels';
import {
  FINE_STATUS_LABELS,
  fineSummary,
  type FineKindValue,
  type LinenKindValue,
} from '@/domain/fines';
import { LIVE_ALERT_WHERE } from './alert-engine';
import { listRoomsWithState } from './rooms';
import { getSettingNumber } from './settings';

export type SnapshotItem = {
  section: string;
  level: HandoverLevel;
  title: string;
  detail: string | null;
  refType: string | null;
  refId: string | null;
};

const SECTIONS = {
  resueltos: 'Resuelto en este turno',
  novedades: 'Novedades activas',
  incidencias: 'Incidencias abiertas',
  tareas: 'Tareas pendientes',
  alertas: 'Alertas activas',
  seguimientos: 'Seguimientos próximos',
  salidas: 'Salidas por confirmar',
  llaves: 'Llaves por recuperar',
  multas: 'Multas pendientes',
  reservas: 'Reservas que requieren acción',
  cobros: 'Cobros pendientes',
  garantias: 'Garantías pendientes',
  huespedes: 'Solicitudes de huéspedes',
  mantenimiento: 'Mantenimiento',
  estadoHotel: 'Estado del hotel',
} as const;

/** Orden de presentación: lo urgente primero y el contexto general al final. */
export const SNAPSHOT_SECTION_ORDER: string[] = Object.values(SECTIONS);

const PRIORITY_TO_LEVEL: Record<Priority, HandoverLevel> = {
  CRITICA: HandoverLevel.URGENTE,
  ALTA: HandoverLevel.IMPORTANTE,
  MEDIA: HandoverLevel.INFORMATIVO,
  BAJA: HandoverLevel.INFORMATIVO,
};

const SEVERITY_TO_LEVEL: Record<Severity, HandoverLevel> = {
  CRITICA: HandoverLevel.URGENTE,
  ALTA: HandoverLevel.URGENTE,
  MEDIA: HandoverLevel.IMPORTANTE,
  BAJA: HandoverLevel.INFORMATIVO,
};

function fmt(date: Date | null | undefined): string {
  if (!date) return 'sin fecha';
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type SnapshotOptions = {
  /** Turno que está cerrando: permite contar lo resuelto en ESTE turno. */
  shiftId?: string | null;
  /** Las métricas se congelan sólo al preparar la entrega, no en previews genéricos. */
  includeMetrics?: boolean;
};

/**
 * Construye el resumen automático de la entrega de turno: todo lo que el
 * turno siguiente necesita saber, agrupado y clasificado por urgencia.
 *
 * El resultado se guarda como items persistentes y como snapshot JSON, de modo
 * que la entrega queda registrada de forma permanente e inmutable aunque los
 * registros de origen cambien después.
 *
 * Además de los registros del Libro, se incluyen los hechos físicos que no se
 * pueden convertir en una novedad sólo para que aparezcan acá: salidas todavía
 * sin confirmar, llaves por recuperar y multas abiertas. Son las mismas
 * entidades de Habitaciones, Llaves y Multas, proyectadas en la entrega sin
 * duplicar su estado.
 */
export async function buildHandoverSnapshot(
  now = new Date(),
  options: SnapshotOptions = {},
): Promise<SnapshotItem[]> {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const items: SnapshotItem[] = [];

  const [
    entries,
    tasks,
    alerts,
    followUps,
    reservations,
    departures,
    pendingKeys,
    fines,
    resolvedEntries,
    completedIndependentTasks,
  ] = await Promise.all([
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
      select: {
        id: true,
        seq: true,
        type: true,
        title: true,
        description: true,
        priority: true,
        severity: true,
        dueAt: true,
        owner: { select: { name: true } },
        department: { select: { name: true } },
        guest: { select: { fullName: true, roomNumber: true } },
      },
      orderBy: [{ priority: 'desc' }, { occurredAt: 'desc' }],
      take: 200,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
      select: {
        id: true,
        seq: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        entryId: true,
        assignee: { select: { name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 200,
    }),
    prisma.alert.findMany({
      where: LIVE_ALERT_WHERE(now),
      select: {
        id: true,
        type: true,
        level: true,
        title: true,
        message: true,
        auto: true,
        entryId: true,
        taskId: true,
        followUpId: true,
        reservationId: true,
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: soon } }],
      },
      select: {
        id: true,
        action: true,
        nextAction: true,
        scheduledAt: true,
        status: true,
        entryId: true,
        owner: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    }),
    prisma.reservationReference.findMany({
      where: {
        deletedAt: null,
        status: { notIn: [ReservationStatus.CANCELADA, ReservationStatus.SALIDA] },
        OR: [
          { requiresAction: true },
          { guaranteeStatus: { in: [GuaranteeStatus.PENDIENTE, GuaranteeStatus.RECHAZADA] } },
          { balanceDue: { gt: 0 } },
          { status: ReservationStatus.PENDIENTE },
        ],
      },
      select: {
        id: true,
        code: true,
        roomNumber: true,
        status: true,
        guaranteeStatus: true,
        balanceDue: true,
        checkIn: true,
        checkOut: true,
        requiresAction: true,
        actionNote: true,
        guest: { select: { fullName: true, vip: true } },
      },
      take: 150,
    }),
    prisma.roomStay.findMany({
      where: {
        deletedAt: null,
        status: RoomStayStatus.CHECK_OUT,
        stage: { not: RoomStayStage.FINALIZADO },
      },
      select: {
        id: true,
        reservationId: true,
        guestNames: true,
        departureDate: true,
        room: { select: { number: true } },
      },
      orderBy: [{ departureDate: 'asc' }, { createdAt: 'asc' }],
      take: 150,
    }),
    prisma.roomKey.findMany({
      where: { status: KeyStatus.PENDIENTE_DEVOLUCION },
      select: {
        id: true,
        code: true,
        type: true,
        room: { select: { number: true } },
        stay: {
          select: {
            reservationId: true,
            guestNames: true,
            stage: true,
          },
        },
      },
      orderBy: { code: 'asc' },
      take: 150,
    }),
    prisma.fine.findMany({
      where: {
        deletedAt: null,
        status: { in: [FineStatus.REGISTRADA, FineStatus.NOTIFICADA] },
      },
      select: {
        id: true,
        status: true,
        kind: true,
        linenKind: true,
        itemDetail: true,
        stainType: true,
        amount: true,
        currency: true,
        reservationCode: true,
        room: { select: { number: true } },
        reservationReference: {
          select: { checkIn: true, checkOut: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    options.shiftId
      ? prisma.operationalEntry.findMany({
          where: {
            shiftId: options.shiftId,
            deletedAt: null,
            status: { in: [EntryStatus.RESUELTO, EntryStatus.CERRADO] },
          },
          select: {
            id: true,
            seq: true,
            type: true,
            title: true,
            resolution: true,
            closedAt: true,
            room: { select: { number: true } },
            _count: { select: { tasks: true, followUps: true } },
          },
          orderBy: [{ closedAt: 'asc' }, { updatedAt: 'asc' }],
          take: 150,
        })
      : Promise.resolve([]),
    options.shiftId
      ? prisma.task.findMany({
          where: {
            shiftId: options.shiftId,
            deletedAt: null,
            entryId: null,
            status: TaskStatus.COMPLETADA,
          },
          select: { id: true, seq: true, title: true, completedAt: true },
          orderBy: { completedAt: 'asc' },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  for (const resolved of resolvedEntries) {
    items.push({
      section: SECTIONS.resueltos,
      level: HandoverLevel.INFORMATIVO,
      title: `#${resolved.seq} ${resolved.title}`,
      detail: [
        ENTRY_TYPE_LABEL[resolved.type],
        resolved.room ? `Hab. ${resolved.room.number}` : null,
        resolved.resolution?.trim() || 'Resuelto durante el turno.',
        resolved._count.tasks > 0 ? `${resolved._count.tasks} tarea(s)` : null,
        resolved._count.followUps > 0 ? `${resolved._count.followUps} seguimiento(s)` : null,
        resolved.closedAt ? `Cerrado ${fmt(resolved.closedAt)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      refType: 'entry',
      refId: resolved.id,
    });
  }

  for (const task of completedIndependentTasks) {
    items.push({
      section: SECTIONS.resueltos,
      level: HandoverLevel.INFORMATIVO,
      title: `Tarea #${task.seq} · ${task.title}`,
      detail: task.completedAt ? `Completada ${fmt(task.completedAt)}` : 'Completada durante el turno.',
      refType: 'task',
      refId: task.id,
    });
  }

  const listedEntryIds = new Set(entries.map((entry) => entry.id));

  for (const entry of entries) {
    const who = entry.guest
      ? ` · ${entry.guest.fullName}${entry.guest.roomNumber ? ` (hab. ${entry.guest.roomNumber})` : ''}`
      : '';
    const base = {
      refType: 'entry' as const,
      refId: entry.id,
      title: `#${entry.seq} ${entry.title}`,
    };
    const detail = [
      entry.description.slice(0, 280),
      entry.department ? `Área: ${entry.department.name}` : null,
      entry.owner ? `Responsable: ${entry.owner.name}` : 'Sin responsable asignado',
      entry.dueAt ? `Vence: ${fmt(entry.dueAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    if (entry.type === EntryType.INCIDENCIA) {
      items.push({
        ...base,
        section: SECTIONS.incidencias,
        level: entry.severity
          ? SEVERITY_TO_LEVEL[entry.severity]
          : PRIORITY_TO_LEVEL[entry.priority],
        detail: `${detail}${who}`,
      });
    } else if (entry.type === EntryType.MANTENIMIENTO) {
      items.push({
        ...base,
        section: SECTIONS.mantenimiento,
        level: PRIORITY_TO_LEVEL[entry.priority],
        detail: `${detail}${who}`,
      });
    } else if (entry.type === EntryType.HUESPED) {
      items.push({
        ...base,
        section: SECTIONS.huespedes,
        level: PRIORITY_TO_LEVEL[entry.priority],
        detail: `${detail}${who}`,
      });
    } else {
      items.push({
        ...base,
        section: SECTIONS.novedades,
        level: PRIORITY_TO_LEVEL[entry.priority],
        detail: `${ENTRY_TYPE_LABEL[entry.type]} · ${detail}${who}`,
      });
    }
  }

  for (const task of tasks) {
    // Si la tarea forma parte de una novedad abierta, la entrega muestra el
    // caso una sola vez. La tarea sigue viva dentro de la ficha del caso.
    if (task.entryId && listedEntryIds.has(task.entryId)) continue;

    const overdue = task.dueAt !== null && task.dueAt.getTime() < now.getTime();
    items.push({
      section: SECTIONS.tareas,
      level: overdue ? HandoverLevel.URGENTE : PRIORITY_TO_LEVEL[task.priority],
      title: `#${task.seq} ${task.title}`,
      detail: [
        `Prioridad ${PRIORITY_LABEL[task.priority]}`,
        task.assignee ? `Asignada a ${task.assignee.name}` : 'Sin asignar',
        task.dueAt ? `${overdue ? 'VENCIDA' : 'Vence'}: ${fmt(task.dueAt)}` : 'Sin fecha límite',
      ].join(' · '),
      refType: 'task',
      refId: task.id,
    });
  }

  for (const followUp of followUps) {
    // Igual que las tareas: un seguimiento ligado a una novedad abierta no se
    // repite como asunto independiente en la entrega.
    if (followUp.entryId && listedEntryIds.has(followUp.entryId)) continue;

    const overdue = followUp.status === FollowUpStatus.VENCIDO;
    items.push({
      section: SECTIONS.seguimientos,
      level: overdue ? HandoverLevel.URGENTE : HandoverLevel.IMPORTANTE,
      title: followUp.action,
      detail: [
        followUp.nextAction ? `Próxima acción: ${followUp.nextAction}` : null,
        `Responsable: ${followUp.owner.name}`,
        followUp.scheduledAt
          ? `${overdue ? 'VENCIDO' : 'Programado'}: ${fmt(followUp.scheduledAt)}`
          : 'Sin fecha programada',
      ]
        .filter(Boolean)
        .join(' · '),
      refType: 'followup',
      refId: followUp.id,
    });
  }

  for (const departure of departures) {
    const roomNumber = departure.room?.number ?? null;
    const due = departure.departureDate !== null && departure.departureDate <= now;
    items.push({
      section: SECTIONS.salidas,
      level: due ? HandoverLevel.URGENTE : HandoverLevel.IMPORTANTE,
      title: `${departure.guestNames[0] ?? 'Huésped sin nombre'}${roomNumber ? ` · hab. ${roomNumber}` : ''}`,
      detail: `Reserva ${departure.reservationId} · salida ${fmt(departure.departureDate)} · falta confirmar que dejó la habitación.`,
      refType: roomNumber ? 'room' : 'stay',
      refId: roomNumber ?? departure.id,
    });
  }

  for (const key of pendingKeys) {
    const roomNumber = key.room?.number ?? null;
    const alreadyLeft = key.stay?.stage === RoomStayStage.FINALIZADO;
    items.push({
      section: SECTIONS.llaves,
      level: alreadyLeft ? HandoverLevel.URGENTE : HandoverLevel.IMPORTANTE,
      title: `Llave ${key.code}${roomNumber ? ` · hab. ${roomNumber}` : ''}`,
      detail: [
        key.stay?.guestNames[0] ?? null,
        key.stay?.reservationId ? `Reserva ${key.stay.reservationId}` : null,
        alreadyLeft
          ? 'La salida ya fue confirmada y la llave todavía no volvió.'
          : 'Pendiente de devolución al mesón.',
      ]
        .filter(Boolean)
        .join(' · '),
      refType: roomNumber ? 'room' : 'key',
      refId: roomNumber ?? key.id,
    });
  }

  for (const fine of fines) {
    const dates = fine.reservationReference
      ? `Llegada ${fmt(fine.reservationReference.checkIn)} · Salida ${fmt(fine.reservationReference.checkOut)}`
      : null;

    items.push({
      section: SECTIONS.multas,
      level: HandoverLevel.IMPORTANTE,
      title: `Multa ${fine.id.slice(0, 8)} · hab. ${fine.room.number}`,
      detail: [
        `Reserva ${fine.reservationCode}`,
        dates,
        FINE_STATUS_LABELS[fine.status],
        fine.amount ? `${fine.currency} ${fine.amount.toString()}` : null,
        fineSummary({
          roomNumber: fine.room.number,
          kind: fine.kind as FineKindValue,
          linenKind: fine.linenKind as LinenKindValue | null,
          itemDetail: fine.itemDetail,
          stainType: fine.stainType,
        }),
      ]
        .filter(Boolean)
        .join(' · '),
      refType: 'room',
      refId: fine.room.number,
    });
  }

  for (const reservation of reservations) {
    const who = reservation.guest?.fullName ?? `Reserva ${reservation.code}`;
    const room = reservation.roomNumber ? ` · hab. ${reservation.roomNumber}` : '';
    const stay = `Llegada ${reservation.checkIn ? fmt(reservation.checkIn) : 's/i'} · Salida ${reservation.checkOut ? fmt(reservation.checkOut) : 's/i'}`;

    if (reservation.balanceDue && reservation.balanceDue.greaterThan(0)) {
      items.push({
        section: SECTIONS.cobros,
        level: HandoverLevel.URGENTE,
        title: `${who}${room} · saldo ${reservation.balanceDue.toFixed(2)}`,
        detail: `Reserva ${reservation.code}. ${stay}`,
        refType: 'reservation',
        refId: reservation.id,
      });
    }

    if (
      reservation.guaranteeStatus === GuaranteeStatus.PENDIENTE ||
      reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA
    ) {
      items.push({
        section: SECTIONS.garantias,
        level:
          reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA
            ? HandoverLevel.URGENTE
            : HandoverLevel.IMPORTANTE,
        title: `${who}${room} · garantía ${reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA ? 'rechazada' : 'pendiente'}`,
        detail: `Reserva ${reservation.code}. ${stay}`,
        refType: 'reservation',
        refId: reservation.id,
      });
    }

    if (reservation.requiresAction || reservation.status === ReservationStatus.PENDIENTE) {
      items.push({
        section: SECTIONS.reservas,
        level: reservation.requiresAction
          ? HandoverLevel.IMPORTANTE
          : HandoverLevel.INFORMATIVO,
        title: `${who}${room}${reservation.guest?.vip ? ' · VIP' : ''}`,
        detail: [
          reservation.actionNote,
          `Reserva ${reservation.code} en estado ${reservation.status}`,
          stay,
        ]
          .filter(Boolean)
          .join(' · '),
        refType: 'reservation',
        refId: reservation.id,
      });
    }
  }

  /**
   * Las alertas automáticas que sólo reflejan un objeto ya listado (una tarea
   * vencida, una incidencia crítica, una garantía o un cobro) se omiten: la
   * entrega debe decir cada cosa una sola vez. Se conservan las manuales y las
   * que aportan información que no aparece en otra sección.
   */
  const listed = {
    entry: new Set(entries.map((e) => e.id)),
    task: new Set(tasks.map((t) => t.id)),
    followUp: new Set(followUps.map((f) => f.id)),
    reservation: new Set(reservations.map((r) => r.id)),
  };

  for (const alert of alerts) {
    const alreadyListed =
      alert.auto &&
      ((alert.entryId !== null && listed.entry.has(alert.entryId)) ||
        (alert.taskId !== null && listed.task.has(alert.taskId)) ||
        (alert.followUpId !== null && listed.followUp.has(alert.followUpId)) ||
        (alert.reservationId !== null && listed.reservation.has(alert.reservationId)));
    if (alreadyListed) continue;

    items.push({
      section: SECTIONS.alertas,
      level:
        alert.level === AlertLevel.CRITICA
          ? HandoverLevel.URGENTE
          : alert.level === AlertLevel.ATENCION
            ? HandoverLevel.IMPORTANTE
            : HandoverLevel.INFORMATIVO,
      title: `${ALERT_TYPE_LABEL[alert.type]}: ${alert.title}`,
      detail: alert.message,
      refType: 'alert',
      refId: alert.id,
    });
  }

  if (options.includeMetrics) {
    const [rooms, usdRateCLP] = await Promise.all([
      listRoomsWithState(),
      getSettingNumber('reception.usdRateCLP', 0),
    ]);
    const occupied = rooms.filter(
      (room) => room.snapshot.current !== null || room.snapshot.outgoing !== null,
    ).length;
    const occupancy = rooms.length > 0 ? Math.round((occupied / rooms.length) * 1000) / 10 : 0;

    items.push({
      section: SECTIONS.estadoHotel,
      level: HandoverLevel.INFORMATIVO,
      title: `Ocupación ${occupancy}% (${occupied}/${rooms.length})`,
      detail: 'Fotografía operativa al preparar la entrega.',
      refType: 'metric',
      refId: 'occupancy',
    });
    items.push({
      section: SECTIONS.estadoHotel,
      level: HandoverLevel.INFORMATIVO,
      title: usdRateCLP > 0 ? `Dólar CLP ${usdRateCLP}` : 'Dólar sin configurar',
      detail: 'Valor operativo vigente al preparar la entrega.',
      refType: 'metric',
      refId: 'usd-rate',
    });
  }

  return items;
}
