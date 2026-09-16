import 'server-only';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  EntryType,
  FollowUpStatus,
  GuaranteeState,
  GuaranteeStatus,
  HandoverStatus,
  Prisma,
  ReservationStatus,
  RoomStayStage,
  RoomStayStatus,
  Severity,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { hotelDateKey, hotelHour } from '@/domain/time';
import {
  GUARANTEE_STATE_LABELS,
  type GuaranteeStateValue,
} from '@/domain/guarantees';
import { getSettingNumber } from './settings';

/**
 * Motor de alertas.
 *
 * Deliberadamente simple y sin dependencias externas: cada regla produce una
 * alerta con `dedupeKey` estable, de modo que ejecutar el motor N veces no
 * duplica alertas. Cuando la condición que originó una alerta automática
 * desaparece, la alerta se resuelve sola.
 *
 * Se ejecuta al abrir el panel principal y al listar alertas, y puede invocarse
 * desde Administración. Las horas operativas se comparan en la zona del hotel,
 * nunca con la zona del proceso de Vercel.
 */

type Candidate = {
  dedupeKey: string;
  type: AlertType;
  level: AlertLevel;
  title: string;
  message: string;
  dueAt?: Date | null;
  entryId?: string | null;
  taskId?: string | null;
  followUpId?: string | null;
  handoverId?: string | null;
  guestId?: string | null;
  reservationId?: string | null;
  departmentId?: string | null;
  guaranteeId?: string | null;
};

const MAINTENANCE_GRACE_HOURS = 24;
const HANDOVER_GRACE_MINUTES = 60;

export async function collectAlertCandidates(now = new Date()): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const [overdueTasks, criticalIncidents, staleMaintenance, guestRequests] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { in: TASK_OPEN_STATUSES },
          dueAt: { lt: now },
        },
        select: { id: true, title: true, dueAt: true, departmentId: true },
        take: 200,
      }),
      prisma.operationalEntry.findMany({
        where: {
          deletedAt: null,
          type: EntryType.INCIDENCIA,
          severity: Severity.CRITICA,
          status: { in: ENTRY_OPEN_STATUSES },
        },
        select: { id: true, title: true, departmentId: true },
        take: 100,
      }),
      prisma.operationalEntry.findMany({
        where: {
          deletedAt: null,
          type: EntryType.MANTENIMIENTO,
          status: { in: ENTRY_OPEN_STATUSES },
          occurredAt: {
            lt: new Date(now.getTime() - MAINTENANCE_GRACE_HOURS * 3600_000),
          },
        },
        select: { id: true, title: true, departmentId: true, occurredAt: true },
        take: 100,
      }),
      prisma.operationalEntry.findMany({
        where: {
          deletedAt: null,
          type: EntryType.HUESPED,
          requiresFollowUp: true,
          status: { in: ENTRY_OPEN_STATUSES },
        },
        select: { id: true, title: true, guestId: true, departmentId: true },
        take: 100,
      }),
    ]);

  for (const task of overdueTasks) {
    candidates.push({
      dedupeKey: `task-overdue:${task.id}`,
      type: AlertType.TAREA_VENCIDA,
      level: AlertLevel.CRITICA,
      title: `Tarea vencida: ${task.title}`,
      message: task.dueAt
        ? `Venció el ${task.dueAt.toLocaleString('es-CL')} y sigue abierta.`
        : 'La tarea está vencida y sigue abierta.',
      dueAt: task.dueAt,
      taskId: task.id,
      departmentId: task.departmentId,
    });
  }

  for (const entry of criticalIncidents) {
    candidates.push({
      dedupeKey: `incident-critical:${entry.id}`,
      type: AlertType.INCIDENCIA_CRITICA,
      level: AlertLevel.CRITICA,
      title: `Incidencia crítica abierta: ${entry.title}`,
      message: 'Requiere atención inmediata y seguimiento hasta su cierre.',
      entryId: entry.id,
      departmentId: entry.departmentId,
    });
  }

  for (const entry of staleMaintenance) {
    candidates.push({
      dedupeKey: `maintenance-stale:${entry.id}`,
      type: AlertType.MANTENIMIENTO_SIN_RESOLVER,
      level: AlertLevel.ATENCION,
      title: `Mantenimiento sin resolver: ${entry.title}`,
      message: `Abierto desde el ${entry.occurredAt.toLocaleString('es-CL')} sin resolución.`,
      entryId: entry.id,
      departmentId: entry.departmentId,
    });
  }

  for (const entry of guestRequests) {
    candidates.push({
      dedupeKey: `guest-request:${entry.id}`,
      type: AlertType.SOLICITUD_HUESPED_PENDIENTE,
      level: AlertLevel.ATENCION,
      title: `Solicitud de huésped pendiente: ${entry.title}`,
      message: 'La solicitud sigue abierta y requiere seguimiento.',
      entryId: entry.id,
      guestId: entry.guestId,
      departmentId: entry.departmentId,
    });
  }

  const overdueFollowUps = await prisma.followUp.findMany({
    where: {
      deletedAt: null,
      status: FollowUpStatus.PENDIENTE,
      scheduledAt: { lt: now },
    },
    select: { id: true, action: true, scheduledAt: true, entryId: true },
    take: 200,
  });

  for (const followUp of overdueFollowUps) {
    candidates.push({
      dedupeKey: `followup-overdue:${followUp.id}`,
      type: AlertType.SEGUIMIENTO_VENCIDO,
      level: AlertLevel.ATENCION,
      title: `Seguimiento vencido: ${followUp.action}`,
      message: followUp.scheduledAt
        ? `Estaba programado para el ${followUp.scheduledAt.toLocaleString('es-CL')}.`
        : 'El seguimiento está vencido.',
      dueAt: followUp.scheduledAt,
      followUpId: followUp.id,
      entryId: followUp.entryId,
    });
  }

  const pendingHandovers = await prisma.shiftHandover.findMany({
    where: {
      status: HandoverStatus.ENVIADA,
      issuedAt: { lt: new Date(now.getTime() - HANDOVER_GRACE_MINUTES * 60_000) },
    },
    select: { id: true, issuedAt: true, fromShift: { select: { type: true, date: true } } },
    take: 50,
  });

  for (const handover of pendingHandovers) {
    candidates.push({
      dedupeKey: `handover-pending:${handover.id}`,
      type: AlertType.ENTREGA_TURNO_PENDIENTE,
      level: AlertLevel.ATENCION,
      title: 'Entrega de turno sin confirmar',
      message: `La entrega del turno ${handover.fromShift.type} del ${handover.fromShift.date.toLocaleDateString('es-CL')} sigue sin ser recibida.`,
      handoverId: handover.id,
    });
  }

  const unhandedShifts = await prisma.shift.findMany({
    where: {
      status: { in: [ShiftStatus.ACTIVO, ShiftStatus.INICIADO] },
      plannedEnd: { lt: now },
      handoverOut: null,
    },
    select: { id: true, type: true, date: true, plannedEnd: true },
    take: 50,
  });

  for (const shift of unhandedShifts) {
    candidates.push({
      dedupeKey: `shift-handover-missing:${shift.id}`,
      type: AlertType.ENTREGA_TURNO_PENDIENTE,
      level: AlertLevel.CRITICA,
      title: 'Turno vencido sin preparar la entrega',
      message: `El turno ${shift.type} del ${shift.date.toLocaleDateString('es-CL')} terminó su horario y aún no envía la entrega.`,
      dueAt: shift.plannedEnd,
    });
  }

  /*
    El check-out tiene una hora operativa, no sólo una fecha. A partir de esa
    hora, cualquier salida del día o anterior que siga sin confirmar debe sonar
    como ALERTA. Usamos `OTRO` para no crear otro enum/modelo: la identidad de
    la regla está en la `dedupeKey` y el texto, siguiendo el motor existente.
  */
  const checkoutHour = await getSettingNumber('reception.checkoutHour', 11);
  if (hotelHour(now) >= checkoutHour) {
    const today = new Date(`${hotelDateKey(now)}T00:00:00.000Z`);
    const overdueCheckOuts = await prisma.roomStay.findMany({
      where: {
        deletedAt: null,
        status: RoomStayStatus.CHECK_OUT,
        stage: { not: RoomStayStage.FINALIZADO },
        departureDate: { lte: today },
      },
      select: {
        id: true,
        reservationId: true,
        guestNames: true,
        departureDate: true,
        room: { select: { number: true } },
      },
      orderBy: [{ departureDate: 'asc' }, { room: { number: 'asc' } }],
      take: 100,
    });

    for (const stay of overdueCheckOuts) {
      candidates.push({
        dedupeKey: `checkout-unconfirmed:${stay.id}`,
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        title: `Check-out sin confirmar${stay.room ? `: hab. ${stay.room.number}` : ''}`,
        message:
          `${stay.guestNames[0] ?? 'Huésped sin nombre'} · reserva ${stay.reservationId}. ` +
          `Pasó la hora límite de las ${String(checkoutHour).padStart(2, '0')}:00 y la salida sigue pendiente.`,
        dueAt: stay.departureDate,
      });
    }
  }

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const reservations = await prisma.reservationReference.findMany({
    where: {
      deletedAt: null,
      status: { notIn: [ReservationStatus.CANCELADA, ReservationStatus.SALIDA] },
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
      guestId: true,
      guest: { select: { fullName: true, vip: true } },
    },
    take: 300,
  });

  for (const reservation of reservations) {
    const who = reservation.guest?.fullName ?? `Reserva ${reservation.code}`;
    const room = reservation.roomNumber ? ` (hab. ${reservation.roomNumber})` : '';

    if (reservation.guaranteeStatus === GuaranteeStatus.PENDIENTE) {
      candidates.push({
        dedupeKey: `guarantee-pending:${reservation.id}`,
        type: AlertType.GARANTIA_PENDIENTE,
        level: AlertLevel.ATENCION,
        title: `Garantía pendiente: ${who}${room}`,
        message: `La reserva ${reservation.code} no tiene garantía válida registrada.`,
        reservationId: reservation.id,
        guestId: reservation.guestId,
      });
    }

    if (reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA) {
      candidates.push({
        dedupeKey: `card-invalid:${reservation.id}`,
        type: AlertType.TARJETA_INVALIDA,
        level: AlertLevel.CRITICA,
        title: `Tarjeta rechazada: ${who}${room}`,
        message: `La garantía de la reserva ${reservation.code} fue rechazada. Solicitar medio de pago alternativo.`,
        reservationId: reservation.id,
        guestId: reservation.guestId,
      });
    }

    if (reservation.balanceDue && reservation.balanceDue.greaterThan(0)) {
      candidates.push({
        dedupeKey: `payment-pending:${reservation.id}`,
        type: AlertType.PAGO_PENDIENTE,
        level: AlertLevel.ATENCION,
        title: `Cobro pendiente: ${who}${room}`,
        message: `Saldo pendiente de ${reservation.balanceDue.toFixed(2)} en la reserva ${reservation.code}.`,
        reservationId: reservation.id,
        guestId: reservation.guestId,
      });
    }

    if (
      reservation.status === ReservationStatus.PENDIENTE &&
      reservation.checkIn &&
      reservation.checkIn <= endOfToday
    ) {
      candidates.push({
        dedupeKey: `reservation-unconfirmed:${reservation.id}`,
        type: AlertType.RESERVA_SIN_CONFIRMAR,
        level: AlertLevel.ATENCION,
        title: `Reserva sin confirmar con llegada inminente: ${who}`,
        message: `La reserva ${reservation.code} llega el ${reservation.checkIn.toLocaleDateString('es-CL')} y sigue sin confirmar.`,
        dueAt: reservation.checkIn,
        reservationId: reservation.id,
        guestId: reservation.guestId,
      });
    }

    if (
      reservation.guest?.vip &&
      reservation.checkIn &&
      reservation.checkIn <= endOfToday &&
      reservation.status !== ReservationStatus.EN_CASA
    ) {
      candidates.push({
        dedupeKey: `vip-arrival:${reservation.id}`,
        type: AlertType.HUESPED_VIP,
        level: AlertLevel.INFORMATIVA,
        title: `Llegada VIP: ${who}${room}`,
        message: 'Coordinar atención preferente, amenidad y acompañamiento a la habitación.',
        dueAt: reservation.checkIn,
        reservationId: reservation.id,
        guestId: reservation.guestId,
      });
    }

    if (reservation.requiresAction) {
      candidates.push({
        dedupeKey: `reservation-action:${reservation.id}`,
        type: AlertType.TRASLADO_PENDIENTE,
        level: AlertLevel.ATENCION,
        title: `Reserva requiere acción: ${who}${room}`,
        message: reservation.actionNote ?? `La reserva ${reservation.code} tiene una acción pendiente.`,
        reservationId: reservation.id,
        guestId: reservation.guestId,
      });
    }
  }

  const openGuarantees = await prisma.guarantee.findMany({
    where: {
      deletedAt: null,
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
      state: true,
      amount: true,
      currency: true,
      reservationReferenceId: true,
      reservationReference: {
        select: {
          code: true,
          roomNumber: true,
          checkOut: true,
          guestId: true,
          guest: { select: { fullName: true } },
        },
      },
    },
    take: 300,
  });

  for (const guarantee of openGuarantees) {
    const reservation = guarantee.reservationReference;
    const quien = reservation.guest?.fullName ?? `Reserva ${reservation.code}`;
    const donde = reservation.roomNumber ? ` (hab. ${reservation.roomNumber})` : '';

    if (guarantee.state === GuaranteeState.PENDIENTE) {
      candidates.push({
        dedupeKey: `guarantee-open:${guarantee.id}`,
        type: AlertType.GARANTIA_PENDIENTE,
        level: AlertLevel.ATENCION,
        title: `Garantía sin tomar: ${quien}${donde}`,
        message:
          `La reserva ${reservation.code} tiene una garantía registrada de ` +
          `${guarantee.currency} ${guarantee.amount.toString()} que todavía no se ha tomado.`,
        reservationId: guarantee.reservationReferenceId,
        guestId: reservation.guestId,
        guaranteeId: guarantee.id,
      });
    }

    const saleHoy = reservation.checkOut !== null && reservation.checkOut <= now;
    if (saleHoy) {
      candidates.push({
        dedupeKey: `guarantee-unresolved-checkout:${guarantee.id}`,
        type: AlertType.GARANTIA_SIN_RESOLVER_EN_SALIDA,
        level: AlertLevel.CRITICA,
        title: `Garantía sin resolver en la salida: ${quien}${donde}`,
        message:
          `La reserva ${reservation.code} llegó a su fecha de salida con la garantía en ` +
          `«${GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue]}». ` +
          'Devolverla, aplicarla o cobrarla antes de cerrar la cuenta.',
        dueAt: reservation.checkOut,
        reservationId: guarantee.reservationReferenceId,
        guestId: reservation.guestId,
        guaranteeId: guarantee.id,
      });
    }
  }

  for (const reservation of reservations) {
    const saldo = reservation.balanceDue;
    if (!saldo || saldo.lessThanOrEqualTo(0)) continue;

    const quien = reservation.guest?.fullName ?? `Reserva ${reservation.code}`;
    const donde = reservation.roomNumber ? ` (hab. ${reservation.roomNumber})` : '';
    const sale = reservation.checkOut !== null && reservation.checkOut <= now;

    candidates.push({
      dedupeKey: `balance-due:${reservation.id}`,
      type: AlertType.SALDO_PENDIENTE,
      level: sale ? AlertLevel.CRITICA : AlertLevel.ATENCION,
      title: `Saldo pendiente: ${quien}${donde}`,
      message:
        `La reserva ${reservation.code} tiene un saldo de ${saldo.toString()} sin cobrar` +
        (sale ? ' y ya llegó a su fecha de salida.' : '.'),
      dueAt: reservation.checkOut,
      reservationId: reservation.id,
      guestId: reservation.guestId,
    });
  }

  return candidates;
}

/**
 * Sincroniza las alertas automáticas con el estado real de la operación.
 * Devuelve cuántas se crearon y cuántas se resolvieron por condición superada.
 */
export async function runAlertEngine(
  now = new Date(),
): Promise<{ created: number; resolved: number; reopened: number }> {
  const candidates = await collectAlertCandidates(now);
  const keys = candidates.map((c) => c.dedupeKey);

  const existing = await prisma.alert.findMany({
    where: { auto: true, dedupeKey: { in: keys.length > 0 ? keys : ['__none__'] } },
    select: { id: true, dedupeKey: true, status: true, level: true },
  });
  const existingByKey = new Map(existing.map((a) => [a.dedupeKey, a]));

  let created = 0;
  let reopened = 0;

  for (const candidate of candidates) {
    const current = existingByKey.get(candidate.dedupeKey);
    if (!current) {
      await prisma.alert
        .create({
          data: {
            dedupeKey: candidate.dedupeKey,
            type: candidate.type,
            level: candidate.level,
            title: candidate.title,
            message: candidate.message,
            dueAt: candidate.dueAt ?? null,
            entryId: candidate.entryId ?? null,
            taskId: candidate.taskId ?? null,
            followUpId: candidate.followUpId ?? null,
            handoverId: candidate.handoverId ?? null,
            guestId: candidate.guestId ?? null,
            reservationId: candidate.reservationId ?? null,
            departmentId: candidate.departmentId ?? null,
            guaranteeId: candidate.guaranteeId ?? null,
            auto: true,
            status: AlertStatus.NUEVA,
          },
        })
        .then(() => {
          created += 1;
        })
        .catch((error: unknown) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            return;
          }
          throw error;
        });
      continue;
    }

    if (current.status === AlertStatus.RESUELTA) {
      await prisma.alert.update({
        where: { id: current.id },
        data: {
          status: AlertStatus.NUEVA,
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
          level: candidate.level,
          title: candidate.title,
          message: candidate.message,
          deletedAt: null,
        },
      });
      reopened += 1;
    } else if (current.level !== candidate.level) {
      await prisma.alert.update({
        where: { id: current.id },
        data: { level: candidate.level, title: candidate.title, message: candidate.message },
      });
    }
  }

  const staleWhere: Prisma.AlertWhereInput = {
    auto: true,
    deletedAt: null,
    status: { not: AlertStatus.RESUELTA },
    ...(keys.length > 0 ? { dedupeKey: { notIn: keys } } : {}),
  };
  const stale = await prisma.alert.updateMany({
    where: staleWhere,
    data: {
      status: AlertStatus.RESUELTA,
      resolvedAt: now,
      resolutionNote: 'Resuelta automáticamente: la condición de origen ya no se cumple.',
    },
  });

  await prisma.followUp.updateMany({
    where: {
      deletedAt: null,
      status: FollowUpStatus.PENDIENTE,
      scheduledAt: { lt: now },
    },
    data: { status: FollowUpStatus.VENCIDO },
  });

  await prisma.task.updateMany({
    where: { deletedAt: null, status: TaskStatus.COMPLETADA, completedAt: null },
    data: { completedAt: now },
  });

  return { created, resolved: stale.count, reopened };
}

/**
 * Criterio único de "alerta viva": nueva o vista, o pospuesta cuyo plazo ya
 * venció. Lo comparten el recuento, el panel, el libro y la entrega de turno.
 */
export const LIVE_ALERT_WHERE = (now = new Date()): Prisma.AlertWhereInput => ({
  deletedAt: null,
  OR: [
    { status: { in: [AlertStatus.NUEVA, AlertStatus.VISTA] } },
    { status: AlertStatus.POSPUESTA, snoozedUntil: { lte: now } },
  ],
});

/** Recuento rápido de alertas vivas, para los indicadores de navegación. */
export async function countLiveAlerts(now = new Date()): Promise<number> {
  return prisma.alert.count({ where: LIVE_ALERT_WHERE(now) });
}
