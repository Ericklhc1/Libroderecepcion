import 'server-only';
import {
  AlertLevel,
  EntryType,
  FollowUpStatus,
  GuaranteeState,
  HandoverStatus,
  Priority,
  Severity,
  ShiftStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate } from '@/lib/format';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import {
  GUARANTEE_STATE_ACTIONS,
  GUARANTEE_STATE_LABELS,
  type GuaranteeStateValue,
} from '@/domain/guarantees';
import { LIVE_ALERT_WHERE } from './alert-engine';

export type SupervisionRow = {
  id: string;
  ref: string;
  title: string;
  detail: string | null;
  href: string;
  meta: string | null;
  /** Objeto real del Libro que originó la señal. */
  sourceEntity?: string;
  sourceId?: string;
};

export type SupervisionBlock = {
  key: string;
  title: string;
  hint: string;
  tone: 'critico' | 'atencion' | 'curso';
  rows: SupervisionRow[];
};

function shiftText(shift: { type: string; date: Date } | null | undefined): string | null {
  if (!shift) return null;
  return `${shift.type} · ${formatCalendarDate(shift.date)}`;
}

function dueText(date: Date | null, now: Date): string | null {
  if (!date) return null;
  const hours = Math.round((now.getTime() - date.getTime()) / 3_600_000);
  if (hours < 1) return 'vence ahora';
  if (hours < 24) return `vencida hace ${hours} h`;
  return `vencida hace ${Math.floor(hours / 24)} día(s)`;
}

/**
 * Centro de Supervisión v1.4.0.
 *
 * Proyecta excepciones de los brazos operativos del Libro hacia Supervisión:
 * Novedades, Caja, Turnos y Llaves. No copia esos objetos ni consulta PMS.
 */
export async function getSupervisionData(): Promise<{
  now: Date;
  blocks: SupervisionBlock[];
  total: number;
}> {
  const now = new Date();

  const [
    criticalIncidents,
    overdueTasks,
    overdueFollowUps,
    unassigned,
    criticalAlerts,
    openGuarantees,
    staleHandovers,
    pendingClosures,
    cashAudits,
    keyCounts,
  ] = await Promise.all([
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
        OR: [{ severity: Severity.CRITICA }, { priority: Priority.CRITICA }],
      },
      select: {
        id: true,
        seq: true,
        title: true,
        occurredAt: true,
        owner: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ severity: 'desc' }, { occurredAt: 'asc' }],
      take: 20,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES }, dueAt: { lt: now } },
      select: {
        id: true,
        seq: true,
        title: true,
        dueAt: true,
        assignee: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: FollowUpStatus.VENCIDO },
          { status: FollowUpStatus.PENDIENTE, scheduledAt: { lt: now } },
        ],
      },
      select: {
        id: true,
        action: true,
        scheduledAt: true,
        owner: { select: { name: true } },
        entry: { select: { id: true, seq: true, title: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        ownerId: null,
        type: {
          in: [
            EntryType.NOVEDAD,
            EntryType.INCIDENCIA,
            EntryType.MANTENIMIENTO,
            EntryType.SEGURIDAD,
            EntryType.HOUSEKEEPING,
            EntryType.CAJA,
          ],
        },
      },
      select: {
        id: true,
        seq: true,
        title: true,
        type: true,
        occurredAt: true,
        department: { select: { name: true } },
      },
      orderBy: { occurredAt: 'asc' },
      take: 20,
    }),
    prisma.alert.findMany({
      where: { ...LIVE_ALERT_WHERE(now), level: AlertLevel.CRITICA },
      select: {
        id: true,
        title: true,
        message: true,
        dueAt: true,
        entry: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
    prisma.guarantee.findMany({
      where: {
        deletedAt: null,
        state: {
          in: [
            GuaranteeState.PENDIENTE,
            GuaranteeState.VIGENTE,
            GuaranteeState.APLICADA_PARCIALMENTE,
          ],
        },
        OR: [
          { dueAt: { lte: now } },
          { state: GuaranteeState.PENDIENTE },
        ],
      },
      select: {
        id: true,
        state: true,
        amount: true,
        appliedAmount: true,
        penaltyAmount: true,
        currency: true,
        guestName: true,
        roomNumber: true,
        reference: true,
        dueAt: true,
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
    prisma.shiftHandover.findMany({
      where: { status: HandoverStatus.ENVIADA },
      select: {
        id: true,
        issuedAt: true,
        issuedBy: { select: { name: true } },
        fromShift: { select: { type: true, date: true } },
        _count: { select: { items: true } },
      },
      orderBy: { issuedAt: 'asc' },
      take: 10,
    }),
    prisma.shift.findMany({
      where: {
        archivedAt: null,
        status: { in: [ShiftStatus.RECIBIDO, ShiftStatus.ENTREGA_ENVIADA] },
        date: { lt: now },
      },
      select: {
        id: true,
        type: true,
        date: true,
        status: true,
        assignments: { select: { user: { select: { name: true } } }, take: 3 },
      },
      orderBy: { date: 'asc' },
      take: 10,
    }),
    // El último arqueo de cada divisa define si hoy existe una diferencia viva.
    prisma.cashAudit.findMany({
      select: {
        id: true,
        currency: true,
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        createdAt: true,
        countedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    // Se leen conteos recientes y luego se conserva sólo el último de cada piso.
    prisma.keyInventoryCount.findMany({
      select: {
        id: true,
        floor: true,
        countedAt: true,
        countedBy: { select: { name: true } },
        items: {
          select: {
            expected: true,
            found: true,
            outOfService: true,
            room: { select: { number: true } },
          },
        },
      },
      orderBy: { countedAt: 'desc' },
      take: 12,
    }),
  ]);

  const latestCashAudits = Array.from(
    new Map(cashAudits.map((audit) => [audit.currency, audit])).values(),
  ).filter((audit) => Number(audit.difference) !== 0);

  const latestKeyCounts = Array.from(
    new Map(keyCounts.map((count) => [count.floor, count])).values(),
  )
    .map((count) => ({
      ...count,
      missing: count.items.reduce(
        (sum, item) => sum + Math.max(item.expected - item.found, 0),
        0,
      ),
      missingRooms: count.items
        .filter((item) => item.found < item.expected)
        .map((item) => item.room.number),
    }))
    .filter((count) => count.missing > 0);

  const blocks: SupervisionBlock[] = [
    {
      key: 'incidencias',
      title: 'Incidencias críticas abiertas',
      hint: 'Gravedad o prioridad crítica sin cerrar. Requieren decisión y seguimiento.',
      tone: 'critico',
      rows: criticalIncidents.map((row) => ({
        id: row.id,
        ref: `#${row.seq}`,
        title: row.title,
        detail: row.owner ? `Responsable: ${row.owner.name}` : 'Sin responsable asignado',
        href: `/libro/${row.id}`,
        meta: row.department?.name ?? null,
        sourceEntity: 'OperationalEntry',
        sourceId: row.id,
      })),
    },
    {
      key: 'alertas',
      title: 'Alertas críticas vivas',
      hint: 'Reglas operativas todavía sin resolver.',
      tone: 'critico',
      rows: criticalAlerts.map((row) => ({
        id: row.id,
        ref: 'Alerta',
        title: row.title,
        detail: row.message,
        href: row.entry ? `/libro/${row.entry.id}` : `/alertas?alerta=${row.id}`,
        meta: dueText(row.dueAt, now),
        sourceEntity: 'Alert',
        sourceId: row.id,
      })),
    },
    {
      key: 'garantias',
      title: 'Garantías por resolver',
      hint: 'Garantías pendientes o cuya fecha objetivo ya venció.',
      tone: 'critico',
      rows: openGuarantees.map((guarantee) => {
        const applied = Number(guarantee.appliedAmount ?? 0);
        const penalty = Number(guarantee.penaltyAmount ?? 0);
        const outstanding = Math.max(0, Number(guarantee.amount) - applied - penalty);
        const label =
          guarantee.reference ||
          guarantee.guestName ||
          (guarantee.roomNumber ? `Hab. ${guarantee.roomNumber}` : null) ||
          `Garantía ${guarantee.id.slice(-6)}`;

        return {
          id: guarantee.id,
          ref: guarantee.reference ?? `GAR-${guarantee.id.slice(-6).toUpperCase()}`,
          title: `${label} · ${guarantee.currency} ${outstanding}`,
          detail: GUARANTEE_STATE_ACTIONS[guarantee.state as GuaranteeStateValue],
          href: '/caja?seccion=garantias',
          meta: [
            GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue],
            guarantee.roomNumber ? `hab. ${guarantee.roomNumber}` : null,
            guarantee.dueAt ? dueText(guarantee.dueAt, now) : 'sin fecha objetivo',
          ]
            .filter(Boolean)
            .join(' · '),
          sourceEntity: 'Guarantee',
          sourceId: guarantee.id,
        };
      }),
    },
    {
      key: 'caja',
      title: 'Diferencias de Caja vigentes',
      hint: 'Se muestra únicamente el último arqueo de cada divisa cuando todavía presenta diferencia.',
      tone: 'critico',
      rows: latestCashAudits.map((audit) => ({
        id: audit.id,
        ref: `Caja ${audit.currency}`,
        title: `Diferencia ${Number(audit.difference).toLocaleString('es-CL')} ${audit.currency}`,
        detail: `Esperado ${Number(audit.expectedAmount).toLocaleString('es-CL')} · contado ${Number(audit.countedAmount).toLocaleString('es-CL')}`,
        href: '/caja',
        meta: `${audit.countedBy.name} · ${formatCalendarDate(audit.createdAt)}`,
        sourceEntity: 'CashAudit',
        sourceId: audit.id,
      })),
    },
    {
      key: 'llaves',
      title: 'Inventario de llaves con faltantes',
      hint: 'Sólo el último conteo de cada piso; un conteo posterior reemplaza la señal anterior.',
      tone: 'atencion',
      rows: latestKeyCounts.map((count) => ({
        id: count.id,
        ref: `Piso ${count.floor}`,
        title: `${count.missing} llave(s) faltante(s)`,
        detail: count.missingRooms.length > 0
          ? `Habitaciones: ${count.missingRooms.join(', ')}`
          : null,
        href: `/llaves?piso=${count.floor}`,
        meta: `${count.countedBy.name} · ${formatCalendarDate(count.countedAt)}`,
        sourceEntity: 'KeyInventoryCount',
        sourceId: count.id,
      })),
    },
    {
      key: 'tareas',
      title: 'Tareas vencidas',
      hint: 'Pasaron su vencimiento sin completarse. Reasignar o cerrar.',
      tone: 'atencion',
      rows: overdueTasks.map((row) => ({
        id: row.id,
        ref: `T#${row.seq}`,
        title: row.title,
        detail: row.assignee ? `Asignada a ${row.assignee.name}` : 'Sin responsable asignado',
        href: `/tareas/${row.id}`,
        meta: [dueText(row.dueAt, now), row.department?.name].filter(Boolean).join(' · ') || null,
        sourceEntity: 'Task',
        sourceId: row.id,
      })),
    },
    {
      key: 'seguimientos',
      title: 'Seguimientos vencidos',
      hint: 'Compromisos de seguimiento cuya fecha ya pasó.',
      tone: 'atencion',
      rows: overdueFollowUps.map((row) => ({
        id: row.id,
        ref: 'Seg.',
        title: row.action,
        detail: row.entry ? `Sobre #${row.entry.seq} · ${row.entry.title}` : null,
        href: row.entry ? `/libro/${row.entry.id}` : '/seguimientos',
        meta: [dueText(row.scheduledAt, now), `a cargo de ${row.owner.name}`]
          .filter(Boolean)
          .join(' · '),
        sourceEntity: 'FollowUp',
        sourceId: row.id,
      })),
    },
    {
      key: 'sin-responsable',
      title: 'Sin responsable',
      hint: 'Asuntos abiertos que nadie tomó. Asignar para que salgan de esta lista.',
      tone: 'atencion',
      rows: unassigned.map((row) => ({
        id: row.id,
        ref: `#${row.seq}`,
        title: row.title,
        detail: null,
        href: `/libro/${row.id}`,
        meta: row.department?.name ?? null,
        sourceEntity: 'OperationalEntry',
        sourceId: row.id,
      })),
    },
    {
      key: 'entregas',
      title: 'Entregas sin recibir',
      hint: 'El turno saliente envió la entrega y el siguiente todavía no la confirmó.',
      tone: 'atencion',
      rows: staleHandovers.map((row) => ({
        id: row.id,
        ref: shiftText(row.fromShift) ?? 'Turno',
        title: `Entrega de ${row.issuedBy.name}`,
        detail: `${row._count.items} punto(s) pendientes de recepción.`,
        href: `/turno/entrega/${row.id}`,
        meta: row.issuedAt ? dueText(row.issuedAt, now) : null,
        sourceEntity: 'ShiftHandover',
        sourceId: row.id,
      })),
    },
    {
      key: 'cierres',
      title: 'Turnos pendientes de cierre',
      hint: 'La entrega terminó, pero el turno todavía no alcanzó su estado final.',
      tone: 'atencion',
      rows: pendingClosures.map((row) => ({
        id: row.id,
        ref: shiftText(row) ?? 'Turno',
        title: row.assignments.map((assignment) => assignment.user.name).join(', ') || 'Sin asignados',
        detail: `Estado actual: ${row.status}`,
        href: '/turno',
        meta: formatCalendarDate(row.date),
        sourceEntity: 'Shift',
        sourceId: row.id,
      })),
    },
  ];

  return {
    now,
    blocks,
    total: blocks.reduce((sum, block) => sum + block.rows.length, 0),
  };
}
