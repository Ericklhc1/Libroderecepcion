import 'server-only';
import {
  AlertLevel,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  HandoverLevel,
  ShiftStatus,
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
  resueltos: 'Resuelto en este turno',
  novedades: 'Novedades activas',
  incidencias: 'Incidencias abiertas',
  tareas: 'Tareas pendientes',
  alertas: 'Alertas activas',
  seguimientos: 'Seguimientos próximos',
} as const;

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
  shiftId?: string | null;
  /**
   * Compatibilidad con llamadas antiguas. Desde v1.4.0 la entrega no agrega
   * ocupación, dólar ni métricas derivadas de PMS.
   */
  includeMetrics?: boolean;
};

/**
 * Snapshot de entrega v1.4.0.
 *
 * La entrega resume únicamente la continuidad operacional del Libro:
 * Novedades/Incidencias, Tareas, Seguimientos y Alertas. Caja mantiene su
 * propio snapshot y flujo de custodia. PMS, habitaciones, reservas, huéspedes,
 * llaves, multas y ocupación no se consultan ni se proyectan aquí.
 */
export async function buildHandoverSnapshot(
  now = new Date(),
  options: SnapshotOptions = {},
): Promise<SnapshotItem[]> {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const items: SnapshotItem[] = [];

  const currentShiftId =
    options.shiftId !== undefined
      ? options.shiftId
      : (
          await prisma.shift.findFirst({
            where: {
              archivedAt: null,
              status: {
                in: [
                  ShiftStatus.INICIADO,
                  ShiftStatus.ACTIVO,
                  ShiftStatus.PREPARANDO_ENTREGA,
                  ShiftStatus.ENTREGA_ENVIADA,
                  ShiftStatus.RECIBIDO,
                ],
              },
            },
            orderBy: { actualStart: 'desc' },
            select: { id: true },
          })
        )?.id ?? null;

  const [
    entries,
    tasks,
    alerts,
    followUps,
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
        entry: { select: { seq: true, title: true } },
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
        entry: { select: { seq: true, title: true } },
        owner: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    }),
    currentShiftId
      ? prisma.operationalEntry.findMany({
          where: {
            shiftId: currentShiftId,
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
            _count: { select: { tasks: true, followUps: true } },
          },
          orderBy: [{ closedAt: 'asc' }, { updatedAt: 'asc' }],
          take: 150,
        })
      : Promise.resolve([]),
    currentShiftId
      ? prisma.task.findMany({
          where: {
            shiftId: currentShiftId,
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
        resolved.resolution?.trim() || 'Resuelto durante el turno.',
        resolved._count.tasks > 0 ? `${resolved._count.tasks} tarea(s)` : null,
        resolved._count.followUps > 0
          ? `${resolved._count.followUps} seguimiento(s)`
          : null,
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
      detail: task.completedAt
        ? `Completada ${fmt(task.completedAt)}`
        : 'Completada durante el turno.',
      refType: 'task',
      refId: task.id,
    });
  }

  for (const entry of entries) {
    const detail = [
      entry.description.slice(0, 280),
      entry.department ? `Área: ${entry.department.name}` : null,
      entry.owner ? `Responsable: ${entry.owner.name}` : 'Sin responsable asignado',
      entry.dueAt ? `Vence: ${fmt(entry.dueAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    items.push({
      section:
        entry.type === EntryType.INCIDENCIA
          ? SECTIONS.incidencias
          : SECTIONS.novedades,
      level:
        entry.type === EntryType.INCIDENCIA && entry.severity
          ? SEVERITY_TO_LEVEL[entry.severity]
          : PRIORITY_TO_LEVEL[entry.priority],
      title: `#${entry.seq} ${entry.title}`,
      detail:
        entry.type === EntryType.NOVEDAD || entry.type === EntryType.INCIDENCIA
          ? detail
          : `${ENTRY_TYPE_LABEL[entry.type]} · ${detail}`,
      refType: 'entry',
      refId: entry.id,
    });
  }

  for (const task of tasks) {
    const overdue = task.dueAt !== null && task.dueAt.getTime() < now.getTime();
    items.push({
      section: SECTIONS.tareas,
      level: overdue ? HandoverLevel.URGENTE : PRIORITY_TO_LEVEL[task.priority],
      title: `#${task.seq} ${task.title}`,
      detail: [
        task.entry ? `Caso #${task.entry.seq}: ${task.entry.title}` : null,
        `Prioridad ${PRIORITY_LABEL[task.priority]}`,
        task.assignee ? `Asignada a ${task.assignee.name}` : 'Sin asignar',
        task.dueAt
          ? `${overdue ? 'VENCIDA' : 'Vence'}: ${fmt(task.dueAt)}`
          : 'Sin fecha límite',
      ]
        .filter(Boolean)
        .join(' · '),
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
        followUp.entry ? `Caso #${followUp.entry.seq}: ${followUp.entry.title}` : null,
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

  const listed = {
    entry: new Set(entries.map((entry) => entry.id)),
    task: new Set(tasks.map((task) => task.id)),
    followUp: new Set(followUps.map((followUp) => followUp.id)),
  };

  for (const alert of alerts) {
    const alreadyListed =
      alert.auto &&
      ((alert.entryId !== null && listed.entry.has(alert.entryId)) ||
        (alert.taskId !== null && listed.task.has(alert.taskId)) ||
        (alert.followUpId !== null && listed.followUp.has(alert.followUpId)));
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
