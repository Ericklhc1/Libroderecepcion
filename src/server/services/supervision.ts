import 'server-only';
import {
  AlertLevel,
  GuaranteeState,
  EntryType,
  FollowUpStatus,
  HandoverStatus,
  Priority,
  Severity,
  ShiftStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { CONFLICT_LABELS, type Conflict, type ConflictKind } from '@/domain/pms/conflicts';
import {
  GUARANTEE_STATE_ACTIONS,
  GUARANTEE_STATE_LABELS,
  type GuaranteeStateValue,
} from '@/domain/guarantees';
import { LIVE_ALERT_WHERE } from './alert-engine';
import { getLiveConflicts } from './pms-import';

/**
 * Mesa de revisión del Supervisor.
 *
 * Reúne en una sola consulta lo que requiere intervención y que antes estaba
 * repartido entre cuatro páginas: lo escalado, lo crítico, lo vencido, lo que
 * no tiene responsable y los conflictos de habitaciones y llaves. No define
 * entidades nuevas ni duplica reglas: consulta los mismos modelos y reutiliza
 * el detector de conflictos de la importación.
 *
 * Todo se resuelve en un único `Promise.all`: la base está en otra región y
 * encadenar esperas es lo que se nota como lentitud.
 */

export type SupervisionRow = {
  id: string;
  ref: string;
  title: string;
  detail: string | null;
  href: string;
  meta: string | null;
};

export type SupervisionBlock = {
  key: string;
  title: string;
  /** Qué significa que algo aparezca acá y qué se espera del Supervisor. */
  hint: string;
  tone: 'critico' | 'atencion' | 'curso';
  rows: SupervisionRow[];
};

function shiftText(shift: { type: string; date: Date } | null | undefined): string | null {
  if (!shift) return null;
  return `${shift.type} · ${shift.date.toLocaleDateString('es-CL')}`;
}

function dueText(date: Date | null, now: Date): string | null {
  if (!date) return null;
  const hours = Math.round((now.getTime() - date.getTime()) / 3_600_000);
  if (hours < 1) return 'vence ahora';
  if (hours < 24) return `vencida hace ${hours} h`;
  return `vencida hace ${Math.floor(hours / 24)} día(s)`;
}

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
    conflicts,
    openGuarantees,
    staleHandovers,
    pendingClosures,
  ] = await Promise.all([
    // Incidencias críticas abiertas.
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
        room: { select: { number: true } },
      },
      orderBy: [{ severity: 'desc' }, { occurredAt: 'asc' }],
      take: 20,
    }),
    // Tareas vencidas.
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
    // Seguimientos vencidos o ya marcados como vencidos por el motor.
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
    // Sin responsable: nadie se hará cargo si no se asigna.
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        ownerId: null,
        type: {
          in: [
            EntryType.INCIDENCIA,
            EntryType.MANTENIMIENTO,
            EntryType.SEGURIDAD,
            EntryType.HOUSEKEEPING,
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
        room: { select: { number: true } },
      },
      orderBy: { occurredAt: 'asc' },
      take: 20,
    }),
    // Alertas críticas vivas.
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
    getLiveConflicts(),
    // Garantías vivas cuya reserva ya llegó a su fecha de salida: es el
    // momento en que hay que devolverlas, aplicarlas o cobrarlas.
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
      },
      select: {
        id: true,
        state: true,
        amount: true,
        currency: true,
        reservationReference: {
          select: {
            id: true,
            code: true,
            roomNumber: true,
            checkOut: true,
            guest: { select: { fullName: true } },
          },
        },
      },
      orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
    // Entregas enviadas que el turno siguiente no ha recibido.
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
    // Turnos que quedaron sin cerrar.
    prisma.shift.findMany({
      where: {
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
  ]);

  /*
    Los conflictos ya vienen calculados por el detector de la importación: no
    se almacenan ni se recalculan con reglas propias acá. Sólo se reparten
    entre los que hablan de llaves y los que hablan de la habitación.
  */
  const KEY_CONFLICTS: ConflictKind[] = [
    'IN_HOUSE_SIN_LLAVE',
    'CHECK_IN_CON_LLAVE',
    'SALIDA_CONFIRMADA_CON_LLAVE',
    'MULTIPLES_PRINCIPALES',
  ];
  const isKeyConflict = (kind: ConflictKind) => KEY_CONFLICTS.includes(kind);
  const roomConflicts = conflicts.filter((c) => !isKeyConflict(c.kind));
  const keyConflicts = conflicts.filter((c) => isKeyConflict(c.kind));

  const conflictRows = (list: Conflict[]): SupervisionRow[] =>
    list.slice(0, 20).map((conflict, index) => ({
      id: `${conflict.kind}-${conflict.roomNumber ?? index}`,
      ref: conflict.roomNumber ? `Hab. ${conflict.roomNumber}` : 'General',
      title: CONFLICT_LABELS[conflict.kind],
      detail: conflict.detail,
      href: conflict.roomNumber ? `/habitaciones/${conflict.roomNumber}` : '/habitaciones',
      meta: null,
    }));

  const blocks: SupervisionBlock[] = [
    {
      key: 'incidencias',
      title: 'Incidencias críticas abiertas',
      hint: 'Gravedad o prioridad crítica sin cerrar. Requieren decisión, no sólo seguimiento.',
      tone: 'critico',
      rows: criticalIncidents.map((row) => ({
        id: row.id,
        ref: `#${row.seq}`,
        title: row.title,
        detail: row.owner ? `Responsable: ${row.owner.name}` : 'Sin responsable asignado',
        href: `/libro/${row.id}`,
        meta: [row.room ? `hab. ${row.room.number}` : null, row.department?.name]
          .filter(Boolean)
          .join(' · ') || null,
      })),
    },
    {
      key: 'alertas',
      title: 'Alertas críticas vivas',
      hint: 'Generadas por el motor de reglas y todavía sin resolver.',
      tone: 'critico',
      rows: criticalAlerts.map((row) => ({
        id: row.id,
        ref: 'Alerta',
        title: row.title,
        detail: row.message,
        href: row.entry ? `/libro/${row.entry.id}` : `/alertas?alerta=${row.id}`,
        meta: dueText(row.dueAt, now),
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
        meta: [row.room ? `hab. ${row.room.number}` : null, row.department?.name]
          .filter(Boolean)
          .join(' · ') || null,
      })),
    },
    {
      key: 'garantias',
      title: 'Garantías por resolver',
      hint: 'Vivas y con la salida encima: devolverlas, aplicarlas o cobrarlas antes de cerrar la cuenta.',
      tone: 'critico',
      rows: openGuarantees
        // Lo urgente es lo que ya llegó a su salida; el resto informa.
        .sort((a, b) => {
          const sa = a.reservationReference.checkOut?.getTime() ?? Infinity;
          const sb = b.reservationReference.checkOut?.getTime() ?? Infinity;
          return sa - sb;
        })
        .map((guarantee) => {
          const reserva = guarantee.reservationReference;
          const sale = reserva.checkOut !== null && reserva.checkOut <= now;
          return {
            id: guarantee.id,
            ref: `Reserva ${reserva.code}`,
            title: `${reserva.guest?.fullName ?? 'Sin huésped'} · ${guarantee.currency} ${guarantee.amount.toString()}`,
            detail: GUARANTEE_STATE_ACTIONS[guarantee.state as GuaranteeStateValue],
            href: '/huespedes',
            meta:
              [
                GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue],
                reserva.roomNumber ? `hab. ${reserva.roomNumber}` : null,
                sale ? 'salida vencida' : null,
              ]
                .filter(Boolean)
                .join(' · ') || null,
          };
        }),
    },
    {
      key: 'conflictos-habitacion',
      title: 'Conflictos de habitaciones',
      hint: 'Diferencias entre el informe del PMS y el estado operativo. Se recalculan en cada carga.',
      tone: 'atencion',
      rows: conflictRows(roomConflicts),
    },
    {
      key: 'conflictos-llaves',
      title: 'Conflictos de llaves',
      hint: 'Llaves cuyo estado no coincide con la ocupación de la habitación.',
      tone: 'atencion',
      rows: conflictRows(keyConflicts),
    },
    {
      key: 'entregas',
      title: 'Entregas sin recibir',
      hint: 'El turno anterior entregó y nadie ha confirmado la recepción.',
      tone: 'critico',
      rows: staleHandovers.map((row) => ({
        id: row.id,
        ref: 'Entrega',
        title: shiftText(row.fromShift) ?? 'Turno',
        detail: `Entregada por ${row.issuedBy.name} · ${row._count.items} punto(s)`,
        href: `/turno/entrega/${row.id}`,
        meta: row.issuedAt ? `enviada ${row.issuedAt.toLocaleString('es-CL')}` : null,
      })),
    },
    {
      key: 'cierres',
      title: 'Cierres pendientes de validar',
      hint: 'Turnos que ya entregaron o recibieron y siguen sin cerrar.',
      tone: 'curso',
      rows: pendingClosures.map((row) => ({
        id: row.id,
        ref: 'Turno',
        title: shiftText(row) ?? 'Turno',
        detail: row.assignments.map((a) => a.user.name).join(', ') || 'Sin personal asignado',
        href: '/turno',
        meta: row.status.replaceAll('_', ' ').toLowerCase(),
      })),
    },
  ];

  return { now, blocks, total: blocks.reduce((sum, block) => sum + block.rows.length, 0) };
}
