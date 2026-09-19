import 'server-only';

import {
  AuditAction,
  EntryStatus,
  EntryType,
  NotificationType,
  Priority,
  RoomStayStage,
  RoomStayStatus,
  Severity,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hotelDateKey, hotelHour } from '@/domain/time';
import {
  CONFLICT_LABELS,
  type Conflict,
  type ConflictKind,
} from '@/domain/pms/conflicts';
import {
  stayPhase,
  type StayStatus,
} from '@/domain/rooms';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import type { CurrentUser } from '@/server/auth/current-user';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import { getSettingNumber } from './settings';
import { getLiveConflicts } from './pms-import';
import {
  confirmCheckOutBatch,
  softDeleteStay,
} from './rooms';
import { reconcilePrincipalKeys } from './keys';
import { runAlertEngine } from './alert-engine';
import { createEntry } from './entries';

type ActiveStay = {
  id: string;
  roomId: string | null;
  room: { number: string } | null;
  reservationId: string;
  status: RoomStayStatus;
  stage: RoomStayStage;
  businessDate: Date;
  touchedManually: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ConflictResolutionResult = {
  before: number;
  resolved: number;
  remaining: number;
  duplicateStaysArchived: number;
  staleOccupanciesArchived: number;
  checkoutsConfirmed: number;
  keysReconciled: number;
  notificationsSent: number;
  logEntryId: string;
  escalationEntryId: string | null;
  remainingKinds: Partial<Record<ConflictKind, number>>;
};

const ACTIVE_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];

function conflictCounts(conflicts: Conflict[]): Partial<Record<ConflictKind, number>> {
  const counts: Partial<Record<ConflictKind, number>> = {};
  for (const conflict of conflicts) {
    counts[conflict.kind] = (counts[conflict.kind] ?? 0) + 1;
  }
  return counts;
}

function stageRank(stage: RoomStayStage): number {
  if (stage === RoomStayStage.CONFIRMADO) return 2;
  if (stage === RoomStayStage.PENDIENTE) return 1;
  return 0;
}

function statusRank(status: RoomStayStatus): number {
  if (status === RoomStayStatus.IN_HOUSE) return 3;
  if (status === RoomStayStatus.CHECK_OUT) return 2;
  return 1;
}

/**
 * El PMS es la fuente principal. Para una misma reserva/habitación/fase,
 * una fotografía operativa más nueva gana a una más antigua. Sólo después,
 * a igualdad de día, pesan el estado más avanzado y una intervención manual.
 */
function newerStay(a: ActiveStay, b: ActiveStay): ActiveStay {
  const byBusinessDate = a.businessDate.getTime() - b.businessDate.getTime();
  if (byBusinessDate !== 0) return byBusinessDate > 0 ? a : b;

  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) return byStatus > 0 ? a : b;

  const byStage = stageRank(a.stage) - stageRank(b.stage);
  if (byStage !== 0) return byStage > 0 ? a : b;

  if (a.touchedManually !== b.touchedManually) return a.touchedManually ? a : b;
  return a.updatedAt.getTime() >= b.updatedAt.getTime() ? a : b;
}

async function activeStays(): Promise<ActiveStay[]> {
  return prisma.roomStay.findMany({
    where: {
      deletedAt: null,
      stage: { in: ACTIVE_STAGES },
      roomId: { not: null },
    },
    select: {
      id: true,
      roomId: true,
      room: { select: { number: true } },
      reservationId: true,
      status: true,
      stage: true,
      businessDate: true,
      touchedManually: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function archiveDuplicateActiveStays(user: CurrentUser): Promise<number> {
  const stays = await activeStays();
  const groups = new Map<string, ActiveStay[]>();

  for (const stay of stays) {
    const key =
      `${stay.roomId}|${stay.reservationId}|${stayPhase(stay.status as StayStatus)}`;
    const list = groups.get(key) ?? [];
    list.push(stay);
    groups.set(key, list);
  }

  let archived = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const winner = group.reduce(newerStay);
    for (const stay of group) {
      if (stay.id === winner.id) continue;
      await softDeleteStay(user, {
        stayId: stay.id,
        reason:
          'Reconciliación global: estadía activa duplicada. ' +
          `Se conserva la fotografía PMS más reciente (${winner.businessDate.toISOString().slice(0, 10)}).`,
      });
      archived += 1;
    }
  }
  return archived;
}

/**
 * Dos reservas distintas IN_HOUSE en una habitación sólo se pueden resolver
 * sin inventar un huésped cuando una pertenece a un día PMS anterior y existe
 * una única reserva IN_HOUSE en el día más reciente. Si ambas son del mismo
 * día, el conflicto queda visible para decisión humana.
 */
async function archiveStaleOccupancies(user: CurrentUser): Promise<number> {
  const stays = (await activeStays()).filter(
    (stay) => stay.status === RoomStayStatus.IN_HOUSE,
  );
  const byRoom = new Map<string, ActiveStay[]>();
  for (const stay of stays) {
    if (!stay.roomId) continue;
    const list = byRoom.get(stay.roomId) ?? [];
    list.push(stay);
    byRoom.set(stay.roomId, list);
  }

  let archived = 0;
  for (const group of byRoom.values()) {
    const reservations = new Set(group.map((stay) => stay.reservationId));
    if (reservations.size < 2) continue;

    const latestDate = Math.max(...group.map((stay) => stay.businessDate.getTime()));
    const latest = group.filter((stay) => stay.businessDate.getTime() === latestDate);
    const latestReservations = new Set(latest.map((stay) => stay.reservationId));

    // Más de una reserva en el MISMO día sigue siendo una contradicción real.
    if (latestReservations.size !== 1) continue;

    for (const stay of group) {
      if (stay.businessDate.getTime() === latestDate) continue;
      await softDeleteStay(user, {
        stayId: stay.id,
        reason:
          'Reconciliación global: ocupación IN_HOUSE de un día PMS anterior ' +
          'reemplazada por la ocupación vigente del informe más reciente.',
      });
      archived += 1;
    }
  }
  return archived;
}

async function confirmOverdueCheckouts(
  user: CurrentUser,
  now: Date,
): Promise<number> {
  const checkoutHour = await getSettingNumber('reception.checkoutHour', 11);
  if (hotelHour(now) < checkoutHour) return 0;

  const today = new Date(`${hotelDateKey(now)}T00:00:00.000Z`);
  const pending = await prisma.roomStay.findMany({
    where: {
      deletedAt: null,
      status: RoomStayStatus.CHECK_OUT,
      stage: { not: RoomStayStage.FINALIZADO },
      departureDate: { lte: today },
    },
    select: { id: true },
    orderBy: [{ departureDate: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });

  if (pending.length === 0) return 0;
  await confirmCheckOutBatch(user, {
    items: pending.map((stay) => ({
      stayId: stay.id,
      note:
        `Reconciliación global autorizada después de la hora límite de ` +
        `${String(checkoutHour).padStart(2, '0')}:00.`,
    })),
  });
  return pending.length;
}

async function reconcileKeys(user: CurrentUser): Promise<number> {
  return prisma.$transaction(
    (tx) =>
      reconcilePrincipalKeys(tx, user, {
        note: 'reconciliación global de conflictos',
      }),
    { timeout: 30_000, maxWait: 10_000 },
  );
}

function conflictLine(conflict: Conflict): string {
  const room = conflict.roomNumber ? `Hab. ${conflict.roomNumber} · ` : '';
  return `${room}${CONFLICT_LABELS[conflict.kind]}: ${conflict.detail}`;
}

export async function resolveAllOperationalConflicts(
  user: CurrentUser,
  options: { now?: Date } = {},
): Promise<ConflictResolutionResult> {
  const now = options.now ?? new Date();
  const beforeConflicts = await getLiveConflicts();

  const duplicateStaysArchived = await archiveDuplicateActiveStays(user);
  const staleOccupanciesArchived = await archiveStaleOccupancies(user);
  const checkoutsConfirmed = await confirmOverdueCheckouts(user, now);
  const keysReconciled = await reconcileKeys(user);

  // Las alertas derivadas de check-out/incidencia se recalculan contra el nuevo estado.
  await runAlertEngine(now);

  const remainingConflicts = await getLiveConflicts();
  const resolved = Math.max(0, beforeConflicts.length - remainingConflicts.length);

  const description = [
    `Conflictos detectados antes: ${beforeConflicts.length}.`,
    `Resueltos automáticamente: ${resolved}.`,
    `Estadías duplicadas archivadas: ${duplicateStaysArchived}.`,
    `Ocupaciones antiguas archivadas: ${staleOccupanciesArchived}.`,
    `Check-outs vencidos confirmados: ${checkoutsConfirmed}.`,
    `Llaves principales reconciliadas: ${keysReconciled}.`,
    `Conflictos restantes: ${remainingConflicts.length}.`,
  ].join(' ');

  const logEntry = await createEntry(user, {
    type: EntryType.NOVEDAD,
    title: 'Reconciliación global de conflictos',
    description,
    category: 'RECONCILIACION_CONFLICTOS',
    priority: remainingConflicts.length > 0 ? Priority.ALTA : Priority.MEDIA,
    tags: ['reconciliacion-conflictos', 'automatico', 'auditoria'],
    requiresFollowUp: remainingConflicts.length > 0,
  });

  let escalationEntryId: string | null = null;
  const existingEscalation = await prisma.operationalEntry.findFirst({
    where: {
      deletedAt: null,
      category: 'CONFLICTOS_REQUIEREN_DECISION',
      status: { in: ENTRY_OPEN_STATUSES },
    },
    select: { id: true, seq: true, status: true },
    orderBy: { occurredAt: 'desc' },
  });

  if (remainingConflicts.length > 0) {
    if (existingEscalation) {
      escalationEntryId = existingEscalation.id;
      await prisma.operationalEntry.update({
        where: { id: existingEscalation.id },
        data: {
          description: remainingConflicts.slice(0, 30).map(conflictLine).join('\n'),
          occurredAt: now,
          priority: Priority.CRITICA,
          severity: Severity.CRITICA,
          requiresFollowUp: true,
          status: EntryStatus.ABIERTO,
          resolution: null,
          closedAt: null,
          closedById: null,
        },
      });
      await recordAudit({
        entity: 'OperationalEntry',
        entityId: existingEscalation.id,
        action: AuditAction.CAMBIO_ESTADO,
        user,
        summary: `Incidencia #${existingEscalation.seq} actualizada con ${remainingConflicts.length} conflicto(s) restante(s)`,
        after: { remainingConflicts: remainingConflicts.length },
      });
    } else {
      const escalation = await createEntry(user, {
        type: EntryType.INCIDENCIA,
        title: 'Conflictos que requieren decisión humana',
        description: remainingConflicts.slice(0, 30).map(conflictLine).join('\n'),
        category: 'CONFLICTOS_REQUIEREN_DECISION',
        priority: Priority.CRITICA,
        tags: ['reconciliacion-conflictos', 'decision-humana'],
        requiresFollowUp: true,
        severity: Severity.CRITICA,
        immediateAction:
          'Revisar Supervisión/Habitaciones. No se inventaron datos para resolver contradicciones ambiguas.',
      });
      escalationEntryId = escalation.id;
    }
  } else if (existingEscalation) {
    await prisma.operationalEntry.update({
      where: { id: existingEscalation.id },
      data: {
        status: EntryStatus.RESUELTO,
        resolution: 'La reconciliación global dejó el estado operativo sin conflictos vivos.',
        requiresFollowUp: false,
        closedAt: now,
        closedById: user.id,
      },
    });
    await recordAudit({
      entity: 'OperationalEntry',
      entityId: existingEscalation.id,
      action: AuditAction.CERRAR,
      user,
      summary: `Incidencia #${existingEscalation.seq} resuelta por reconciliación global`,
      before: { status: existingEscalation.status },
      after: { status: EntryStatus.RESUELTO },
    });
  }

  const recipients = await prisma.user.findMany({
    where: { deletedAt: null, active: true },
    select: { id: true },
  });
  const body =
    remainingConflicts.length === 0
      ? `${user.name} ejecutó la reconciliación global. ${resolved} conflicto(s) quedaron resueltos; no quedan conflictos vivos.`
      : `${user.name} ejecutó la reconciliación global. ${resolved} conflicto(s) se resolvieron y ${remainingConflicts.length} requieren decisión humana.`;

  await notify(
    recipients.map((recipient) => ({
      userId: recipient.id,
      type: NotificationType.ACTUALIZACION_OPERATIVA,
      title: 'Reconciliación de conflictos ejecutada',
      body,
      link: remainingConflicts.length > 0 ? '/supervision' : '/habitaciones',
      entity: 'OperationalEntry',
      entityId: escalationEntryId ?? logEntry.id,
    })),
  );

  await recordAudit({
    entity: 'ConflictResolution',
    entityId: logEntry.id,
    action: AuditAction.CONFIGURAR,
    user,
    summary:
      `Reconciliación global: ${beforeConflicts.length} → ${remainingConflicts.length} conflicto(s). ` +
      `${recipients.length} usuario(s) notificado(s).`,
    before: {
      total: beforeConflicts.length,
      kinds: conflictCounts(beforeConflicts),
    },
    after: {
      total: remainingConflicts.length,
      kinds: conflictCounts(remainingConflicts),
      duplicateStaysArchived,
      staleOccupanciesArchived,
      checkoutsConfirmed,
      keysReconciled,
    },
  });

  return {
    before: beforeConflicts.length,
    resolved,
    remaining: remainingConflicts.length,
    duplicateStaysArchived,
    staleOccupanciesArchived,
    checkoutsConfirmed,
    keysReconciled,
    notificationsSent: recipients.length,
    logEntryId: logEntry.id,
    escalationEntryId,
    remainingKinds: conflictCounts(remainingConflicts),
  };
}
