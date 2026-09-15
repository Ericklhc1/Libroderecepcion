import 'server-only';
import {
  AlertLevel,
  EntryType,
  FollowUpStatus,
  GuaranteeStatus,
  HandoverLevel,
  ReservationStatus,
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
import { LIVE_ALERT_WHERE } from './alert-engine';

export type SnapshotItem = {
  section: string;
  level: HandoverLevel;
  title: string;
  detail: string | null;
  refType: string | null;
  refId: string | null;
};

const SECTIONS = {
  novedades: 'Novedades activas',
  incidencias: 'Incidencias abiertas',
  tareas: 'Tareas pendientes',
  alertas: 'Alertas activas',
  seguimientos: 'Seguimientos próximos',
  reservas: 'Reservas que requieren acción',
  cobros: 'Cobros pendientes',
  garantias: 'Garantías pendientes',
  huespedes: 'Solicitudes de huéspedes',
  mantenimiento: 'Mantenimiento',
} as const;

/** Orden de presentación: lo urgente primero. */
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

/**
 * Construye el resumen automático de la entrega de turno: todo lo que el
 * turno siguiente necesita saber, agrupado y clasificado por urgencia.
 *
 * El resultado se guarda como items persistentes y como snapshot JSON, de modo
 * que la entrega queda registrada de forma permanente e inmutable aunque los
 * registros de origen cambien después.
 */
export async function buildHandoverSnapshot(
  now = new Date(),
): Promise<SnapshotItem[]> {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const items: SnapshotItem[] = [];

  const [entries, tasks, alerts, followUps, reservations] = await Promise.all([
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
  ]);

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
    const overdue = task.dueAt !== null && task.dueAt.getTime() < now.getTime();
    items.push({
      section: SECTIONS.tareas,
      level: overdue
        ? HandoverLevel.URGENTE
        : PRIORITY_TO_LEVEL[task.priority],
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

  return items;
}
