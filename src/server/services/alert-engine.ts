import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import { maintenanceBlocksBackground } from '@/server/services/system-maintenance';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  EntryType,
  FollowUpStatus,
  GuaranteeState,
  HandoverStatus,
  Prisma,
  Severity,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import {
  GUARANTEE_STATE_LABELS,
  type GuaranteeStateValue,
} from '@/domain/guarantees';

/**
 * Motor de alertas.
 *
 * Deliberadamente simple y sin dependencias externas: cada regla produce una
 * alerta con `dedupeKey` estable, de modo que ejecutar el motor N veces no
 * duplica alertas. Cuando la condición que originó una alerta automática
 * desaparece, la alerta se resuelve sola.
 *
 * Se ejecuta al abrir el panel principal y al listar alertas, y puede invocarse
 * desde Administración. Desde v1.4.0 sólo observa Libro, Caja y Turnos.
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
  departmentId?: string | null;
  guaranteeId?: string | null;
};

const MAINTENANCE_GRACE_HOURS = 24;
const HANDOVER_GRACE_MINUTES = 60;

export async function collectAlertCandidates(now = new Date()): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const [overdueTasks, criticalIncidents, staleMaintenance, followUpEntries] =
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
      readEntries(prisma, {engine:"alerts"}).findMany({
        where: {
          deletedAt: null,
          type: EntryType.INCIDENCIA,
          severity: Severity.CRITICA,
          status: { in: ENTRY_OPEN_STATUSES },
        },
        select: { id: true, title: true, departmentId: true },
        take: 100,
      }),
      readEntries(prisma, {engine:"alerts"}).findMany({
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
      readEntries(prisma, {engine:"alerts"}).findMany({
        where: {
          deletedAt: null,
          requiresFollowUp: true,
          status: { in: ENTRY_OPEN_STATUSES },
        },
        select: { id: true, title: true, departmentId: true },
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
        ? `Venció el ${formatDateTime(task.dueAt)} y sigue abierta.`
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
      message: `Abierto desde el ${formatDateTime(entry.occurredAt)} sin resolución.`,
      entryId: entry.id,
      departmentId: entry.departmentId,
    });
  }

  for (const entry of followUpEntries) {
    candidates.push({
      dedupeKey: `entry-followup:${entry.id}`,
      type: AlertType.OTRO,
      level: AlertLevel.ATENCION,
      title: `Novedad requiere seguimiento: ${entry.title}`,
      message: 'El registro sigue abierto y está marcado para seguimiento.',
      entryId: entry.id,
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
        ? `Estaba programado para el ${formatDateTime(followUp.scheduledAt)}.`
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
      message: `La entrega del turno ${handover.fromShift.type} del ${formatCalendarDate(handover.fromShift.date)} sigue sin ser recibida.`,
      handoverId: handover.id,
    });
  }

  const unclosedShifts = await prisma.shift.findMany({
    where: {
      archivedAt: null,
      status: {
        in: [
          ShiftStatus.INICIADO,
          ShiftStatus.ACTIVO,
          ShiftStatus.PREPARANDO_ENTREGA,
          ShiftStatus.ENTREGA_ENVIADA,
        ],
      },
      plannedEnd: { lt: now },
    },
    select: { id: true, type: true, date: true, plannedEnd: true, status: true },
    take: 50,
  });

  for (const shift of unclosedShifts) {
    candidates.push({
      dedupeKey: `shift-unclosed:${shift.id}`,
      type: AlertType.ENTREGA_TURNO_PENDIENTE,
      level: AlertLevel.CRITICA,
      title: 'Turno vencido sin cierre formal',
      message:
        `El turno ${shift.type} del ${formatCalendarDate(shift.date)} terminó su horario y continúa en «${shift.status}». ` +
        'Debe regularizarse y quedar formalmente cerrado.',
      dueAt: shift.plannedEnd,
    });
  }

  /*
   * Una emergencia no resuelve el turno saliente: sólo permite que Recepción
   * siga operando. Mientras el turno de origen no esté cerrado/anulado, esta
   * alerta crítica vuelve a abrirse aunque alguien intente resolverla.
   */
  const emergencyShifts = await prisma.shift.findMany({
    where: {
      emergency: true,
      archivedAt: null,
      emergencySourceShiftId: { not: null },
    },
    select: {
      id: true,
      emergencyReason: true,
      emergencySourceShiftId: true,
      actualStart: true,
    },
    take: 50,
  });
  const emergencySourceIds = Array.from(
    new Set(
      emergencyShifts
        .map((shift) => shift.emergencySourceShiftId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const emergencySources =
    emergencySourceIds.length > 0
      ? await prisma.shift.findMany({
          where: { id: { in: emergencySourceIds } },
          select: {
            id: true,
            type: true,
            date: true,
            status: true,
            handoverOut: { select: { id: true } },
          },
        })
      : [];
  const emergencySourceById = new Map(emergencySources.map((shift) => [shift.id, shift]));

  for (const emergency of emergencyShifts) {
    if (!emergency.emergencySourceShiftId) continue;
    const source = emergencySourceById.get(emergency.emergencySourceShiftId);
    if (!source || source.status === ShiftStatus.CERRADO || source.status === ShiftStatus.ANULADO) {
      continue;
    }
    candidates.push({
      dedupeKey: `shift-emergency-source:${source.id}`,
      type: AlertType.OTRO,
      level: AlertLevel.CRITICA,
      title: 'Turno de emergencia · cierre saliente pendiente',
      message:
        `Existe un turno de emergencia porque el turno ${source.type} del ${formatCalendarDate(source.date)} sigue sin cierre formal. ` +
        `Motivo: ${emergency.emergencyReason ?? 'Regularización pendiente'}. ` +
        'La emergencia no cierra ni sustituye el turno saliente.',
      dueAt: emergency.actualStart,
      handoverId: source.handoverOut?.id ?? null,
    });
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
      guestName: true,
      roomNumber: true,
      reference: true,
      dueAt: true,
    },
    take: 300,
  });

  for (const guarantee of openGuarantees) {
    const label =
      guarantee.reference ||
      guarantee.guestName ||
      (guarantee.roomNumber ? 'Hab. ' + guarantee.roomNumber : null) ||
      'Garantía ' + guarantee.id.slice(-6);

    if (guarantee.state === GuaranteeState.PENDIENTE) {
      candidates.push({
        dedupeKey: 'guarantee-open:' + guarantee.id,
        type: AlertType.GARANTIA_PENDIENTE,
        level: AlertLevel.ATENCION,
        title: 'Garantía pendiente: ' + label,
        message:
          guarantee.currency + ' ' + guarantee.amount.toString() +
          ' registrada, pero todavía no está vigente bajo custodia.',
        dueAt: guarantee.dueAt,
        guaranteeId: guarantee.id,
      });
    }

    if (
      guarantee.dueAt &&
      guarantee.dueAt <= now &&
      guarantee.state !== GuaranteeState.PENDIENTE
    ) {
      candidates.push({
        dedupeKey: 'guarantee-due:' + guarantee.id,
        type: AlertType.GARANTIA_SIN_RESOLVER_EN_SALIDA,
        level: AlertLevel.CRITICA,
        title: 'Garantía por resolver: ' + label,
        message:
          'La fecha objetivo venció y la garantía continúa en «' +
          GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue] +
          '». Devuélvela, aplícala o resuelve su situación en Caja.',
        dueAt: guarantee.dueAt,
        guaranteeId: guarantee.id,
      });
    }
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
  if (await maintenanceBlocksBackground()) return { created: 0, resolved: 0, reopened: 0 };
  /*
   * AROH 1.33.0:
   * el motor deja de fabricar Alert a partir de tareas, novedades, seguimientos
   * o condiciones que ya tienen un objeto canónico. Conservamos esta función
   * como capa de compatibilidad porque varios flujos históricos la invocan,
   * pero sólo hace housekeeping y cierra señales automáticas legadas.
   */
  const stale = await prisma.alert.updateMany({
    where: {
      auto: true,
      deletedAt: null,
      status: { not: AlertStatus.RESUELTA },
    },
    data: {
      status: AlertStatus.RESUELTA,
      resolvedAt: now,
      resolutionNote:
        'Resuelta por AROH 1.33.0: la condición se consulta y gestiona en su objeto original.',
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

  return { created: 0, resolved: stale.count, reopened: 0 };
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
