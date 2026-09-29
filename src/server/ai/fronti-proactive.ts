import 'server-only';

import { createHash } from 'node:crypto';
import {
  AlertLevel,
  AuditAction,
  GuaranteeStatus,
  NotificationType,
  ReservationStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { notify } from '@/server/notifications';
import { recordAudit } from '@/server/audit';
import { getSettingBool, getSettingNumber } from '@/server/services/settings';
import { LIVE_ALERT_WHERE } from '@/server/services/alert-engine';
import {
  chatWithFrontiProviderChain,
  resolveFrontiBackgroundProviderChainRuntime,
} from '@/server/ai/fronti-provider';

export type FrontiProactiveSeverity = 'MEDIA' | 'ALTA' | 'CRITICA';

export type FrontiProactiveCandidate = {
  key: string;
  severity: FrontiProactiveSeverity;
  area: string;
  title: string;
  evidence: string;
  link: string;
  entityType: string;
  entityId: string;
  detectedAt: Date;
};

type GeneratedExplanation = {
  text: string;
  provider: string | null;
  model: string | null;
  usedFallback: boolean;
};

const SEVERITY_SCORE: Record<FrontiProactiveSeverity, number> = {
  MEDIA: 1,
  ALTA: 2,
  CRITICA: 3,
};

function signalId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function clean(value: string, max = 900): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function alertSeverity(level: AlertLevel): FrontiProactiveSeverity {
  return level === AlertLevel.CRITICA ? 'CRITICA' : 'ALTA';
}

function money(value: { toString(): string } | null): number {
  if (!value) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function alertCandidates(now: Date): Promise<FrontiProactiveCandidate[]> {
  const rows = await prisma.alert.findMany({
    where: LIVE_ALERT_WHERE(now),
    select: {
      id: true,
      humanId: true,
      level: true,
      title: true,
      message: true,
      dedupeKey: true,
      entryId: true,
      taskId: true,
      handoverId: true,
      guaranteeId: true,
      updatedAt: true,
    },
    orderBy: [{ level: 'desc' }, { updatedAt: 'desc' }],
    take: 30,
  });

  return rows
    .filter((row) => row.level === AlertLevel.CRITICA || row.level === AlertLevel.ATENCION)
    .map((row) => ({
      key: `alert:${row.dedupeKey ?? row.id}:${row.level}`,
      severity: alertSeverity(row.level),
      area: 'Alertas operativas',
      title: row.title,
      evidence: clean(
        [
          `Alerta #${row.humanId}`,
          row.message,
          row.entryId ? `registro ${row.entryId}` : null,
          row.taskId ? `tarea ${row.taskId}` : null,
          row.handoverId ? `entrega ${row.handoverId}` : null,
          row.guaranteeId ? `garantía ${row.guaranteeId}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      link: '/alertas',
      entityType: 'Alert',
      entityId: row.id,
      detectedAt: row.updatedAt,
    }));
}

async function reservationCandidates(now: Date): Promise<FrontiProactiveCandidate[]> {
  const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const rows = await prisma.reservationReference.findMany({
    where: {
      deletedAt: null,
      isDemo: false,
      status: {
        in: [
          ReservationStatus.PENDIENTE,
          ReservationStatus.CONFIRMADA,
          ReservationStatus.EN_CASA,
        ],
      },
      AND: [
        {
          OR: [
            { requiresAction: true },
            {
              guaranteeStatus: {
                in: [GuaranteeStatus.PENDIENTE, GuaranteeStatus.RECHAZADA],
              },
            },
            { balanceDue: { gt: 0 } },
          ],
        },
        {
          OR: [
            { checkIn: { gte: now, lte: in72h } },
            { checkOut: { gte: now, lte: in72h } },
            { status: ReservationStatus.EN_CASA },
          ],
        },
      ],
    },
    select: {
      id: true,
      code: true,
      roomNumber: true,
      checkIn: true,
      checkOut: true,
      status: true,
      guaranteeStatus: true,
      balanceDue: true,
      requiresAction: true,
      actionNote: true,
      updatedAt: true,
      guest: { select: { fullName: true } },
    },
    orderBy: [{ checkIn: 'asc' }, { updatedAt: 'desc' }],
    take: 24,
  });

  return rows.map((row) => {
    const balance = money(row.balanceDue);
    const checkInSoon =
      row.checkIn !== null && row.checkIn.getTime() - now.getTime() <= 24 * 60 * 60 * 1000;
    const criticalGuarantee = row.guaranteeStatus === GuaranteeStatus.RECHAZADA;
    const severity: FrontiProactiveSeverity =
      criticalGuarantee || (checkInSoon && balance > 0)
        ? 'CRITICA'
        : checkInSoon || balance > 0
          ? 'ALTA'
          : 'MEDIA';
    const risks = [
      row.requiresAction ? `requiere acción${row.actionNote ? `: ${row.actionNote}` : ''}` : null,
      row.guaranteeStatus === GuaranteeStatus.PENDIENTE ? 'garantía pendiente' : null,
      row.guaranteeStatus === GuaranteeStatus.RECHAZADA ? 'garantía rechazada' : null,
      balance > 0 ? `saldo pendiente ${balance}` : null,
    ].filter(Boolean);

    return {
      key: `reservation:${row.id}:${risks.join('|')}`,
      severity,
      area: 'Central de Reservas',
      title: `Reserva ${row.code} requiere revisión`,
      evidence: clean(
        [
          row.guest?.fullName ? `Huésped: ${row.guest.fullName}` : null,
          row.roomNumber ? `Hab. ${row.roomNumber}` : null,
          row.checkIn ? `llegada ${row.checkIn.toISOString()}` : null,
          row.checkOut ? `salida ${row.checkOut.toISOString()}` : null,
          ...risks,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      link: `/central-reservas?q=${encodeURIComponent(row.code)}`,
      entityType: 'ReservationReference',
      entityId: row.id,
      detectedAt: row.updatedAt,
    };
  });
}

async function observabilityCandidates(now: Date): Promise<FrontiProactiveCandidate[]> {
  const since = new Date(now.getTime() - 20 * 60 * 1000);
  const rows = await prisma.operationalMetricEvent.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        { eventType: { endsWith: '_FAILED' } },
        { eventType: 'ACTION_TIMEOUT' },
        { eventType: 'KEY_INVENTORY_WITH_DIFFERENCES' },
      ],
    },
    select: {
      eventType: true,
      status: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 120,
  });

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key =
      row.eventType === 'KEY_INVENTORY_WITH_DIFFERENCES' && row.entityId
        ? `${row.eventType}:${row.entityId}`
        : row.eventType;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  const candidates: FrontiProactiveCandidate[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    if (!first) continue;
    if (first.eventType !== 'KEY_INVENTORY_WITH_DIFFERENCES' && group.length < 2) continue;
    const severity: FrontiProactiveSeverity =
      first.eventType === 'KEY_INVENTORY_WITH_DIFFERENCES'
        ? 'ALTA'
        : group.length >= 4
          ? 'CRITICA'
          : 'ALTA';
    candidates.push({
      key: `health:${key}`,
      severity,
      area:
        first.eventType === 'KEY_INVENTORY_WITH_DIFFERENCES'
          ? 'Inventario de llaves'
          : 'Salud operativa',
      title:
        first.eventType === 'KEY_INVENTORY_WITH_DIFFERENCES'
          ? 'Inventario de llaves con diferencias'
          : `Fallas repetidas: ${first.eventType}`,
      evidence: clean(
        first.eventType === 'KEY_INVENTORY_WITH_DIFFERENCES'
          ? `Se registró una diferencia física en el inventario ${first.entityId ?? ''}.`
          : `${group.length} evento(s) ${first.eventType} en los últimos 20 minutos. Estados: ${[
              ...new Set(group.map((item) => item.status)),
            ].join(', ')}.`,
      ),
      link:
        first.eventType === 'KEY_INVENTORY_WITH_DIFFERENCES'
          ? '/llaves'
          : '/supervision/salud',
      entityType: first.entityType ?? 'OperationalMetricEvent',
      entityId: first.entityId ?? key,
      detectedAt: first.createdAt,
    });
  }
  return candidates;
}

export async function collectFrontiProactiveCandidates(
  now = new Date(),
): Promise<FrontiProactiveCandidate[]> {
  const [alerts, reservations, observability] = await Promise.all([
    alertCandidates(now),
    reservationCandidates(now),
    observabilityCandidates(now),
  ]);

  const unique = new Map<string, FrontiProactiveCandidate>();
  for (const candidate of [...alerts, ...reservations, ...observability]) {
    const id = signalId(candidate.key);
    const current = unique.get(id);
    if (
      !current ||
      SEVERITY_SCORE[candidate.severity] > SEVERITY_SCORE[current.severity] ||
      candidate.detectedAt > current.detectedAt
    ) {
      unique.set(id, candidate);
    }
  }

  return [...unique.values()].sort(
    (a, b) =>
      SEVERITY_SCORE[b.severity] - SEVERITY_SCORE[a.severity] ||
      b.detectedAt.getTime() - a.detectedAt.getTime(),
  );
}

type FrontiProactiveRecipient = {
  id: string;
  roleKey: string;
  frontiAccessEnabled: boolean;
  permissions: Set<string>;
};

async function recipients(): Promise<FrontiProactiveRecipient[]> {
  const rows = await prisma.user.findMany({
    where: {
      active: true,
      deletedAt: null,
      role: { key: { in: [ROLE_KEYS.SUPERVISOR, ROLE_KEYS.SYSTEM_ADMIN] } },
    },
    select: {
      id: true,
      frontiAccessEnabled: true,
      role: {
        select: {
          key: true,
          permissions: {
            select: { permission: { select: { key: true } } },
          },
        },
      },
    },
  });

  return rows
    .filter(
      (row) =>
        row.role.key === ROLE_KEYS.SYSTEM_ADMIN ||
        row.frontiAccessEnabled,
    )
    .map((row) => ({
      id: row.id,
      roleKey: row.role.key,
      frontiAccessEnabled: row.frontiAccessEnabled,
      permissions: new Set(row.role.permissions.map((item) => item.permission.key)),
    }));
}

function canReceiveCandidate(
  recipient: FrontiProactiveRecipient,
  candidate: FrontiProactiveCandidate,
): boolean {
  if (candidate.link.startsWith('/central-reservas')) {
    return recipient.permissions.has('reservation.center.view');
  }

  if (candidate.link.startsWith('/supervision/salud')) {
    return recipient.permissions.has('supervision.center.view');
  }

  if (candidate.link.startsWith('/llaves')) {
    return (
      recipient.permissions.has('key.assign') ||
      recipient.permissions.has('key.inventory') ||
      recipient.permissions.has('key.stock')
    );
  }

  // /alertas es visible para cualquier usuario autenticado; el alcance del
  // barrido sigue limitado a Supervisor/Admin con Fronti habilitado.
  return true;
}

async function isCoolingDown(
  id: string,
  userIds: string[],
  cutoff: Date,
): Promise<boolean> {
  if (!userIds.length) return true;
  const recent = await prisma.notification.count({
    where: {
      userId: { in: userIds },
      type: NotificationType.FRONTI_HALLAZGO,
      entity: 'FrontiProactiveSignal',
      entityId: id,
      createdAt: { gte: cutoff },
    },
  });
  return recent >= userIds.length;
}

async function explainCandidate(
  candidate: FrontiProactiveCandidate,
): Promise<GeneratedExplanation> {
  const deterministicFallback =
    'Revisa el origen de esta señal y confirma el estado vigente antes de actuar. Fronti no cambió ningún estado operativo.';

  try {
    const providers = await resolveFrontiBackgroundProviderChainRuntime({
      reasoningEffort: 'low',
    });
    if (!providers.length) {
      return {
        text: deterministicFallback,
        provider: null,
        model: null,
        usedFallback: true,
      };
    }

    const result = await chatWithFrontiProviderChain({
      providers,
      messages: [
        {
          role: 'system',
          content:
            'Eres Fronti en modo proactivo de AROH Central IA. La detección ya fue hecha por reglas determinísticas. Tu tarea es EXPLICAR la señal, correlacionar únicamente lo que aparece en la evidencia y proponer una revisión humana concreta. No inventes datos, no declares causas no demostradas y no ordenes ejecutar cambios irreversibles. Responde en español, máximo 420 caracteres, sin encabezados.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            severity: candidate.severity,
            area: candidate.area,
            title: candidate.title,
            evidence: candidate.evidence,
          }),
        },
      ],
      toolChoice: 'none',
    });
    const text = clean(result.text || deterministicFallback, 520);
    return {
      text: text || deterministicFallback,
      provider: result.providerUsed,
      model: result.modelUsed,
      usedFallback: !result.text,
    };
  } catch (error) {
    console.warn('[fronti-proactivo] no se pudo generar explicación; se usa respaldo determinístico', error);
    return {
      text: deterministicFallback,
      provider: null,
      model: null,
      usedFallback: true,
    };
  }
}

export async function runFrontiProactiveSweep(input: {
  trigger?: string;
  now?: Date;
} = {}): Promise<{
  enabled: boolean;
  candidates: number;
  analysed: number;
  notified: number;
  skippedCooldown: number;
  fallbackExplanations: number;
}> {
  const enabled = await getSettingBool('fronti.proactiveEnabled', true);
  if (!enabled) {
    return {
      enabled: false,
      candidates: 0,
      analysed: 0,
      notified: 0,
      skippedCooldown: 0,
      fallbackExplanations: 0,
    };
  }

  const now = input.now ?? new Date();
  const cooldownHours = Math.max(
    1,
    Math.min(72, Math.trunc(await getSettingNumber('fronti.proactiveCooldownHours', 24))),
  );
  const maxFindings = Math.max(
    1,
    Math.min(8, Math.trunc(await getSettingNumber('fronti.proactiveMaxFindingsPerRun', 4))),
  );
  const recipientPool = await recipients();
  if (!recipientPool.length) {
    return {
      enabled: true,
      candidates: 0,
      analysed: 0,
      notified: 0,
      skippedCooldown: 0,
      fallbackExplanations: 0,
    };
  }

  const candidates = await collectFrontiProactiveCandidates(now);
  const cutoff = new Date(now.getTime() - cooldownHours * 60 * 60 * 1000);
  let analysed = 0;
  let notified = 0;
  let skippedCooldown = 0;
  let fallbackExplanations = 0;

  for (const candidate of candidates.slice(0, maxFindings)) {
    const id = signalId(candidate.key);
    const userIds = recipientPool
      .filter((recipient) => canReceiveCandidate(recipient, candidate))
      .map((recipient) => recipient.id);

    if (!userIds.length) {
      continue;
    }

    if (await isCoolingDown(id, userIds, cutoff)) {
      skippedCooldown += 1;
      continue;
    }

    const explanation = await explainCandidate(candidate);
    analysed += 1;
    if (explanation.usedFallback) fallbackExplanations += 1;

    await notify(
      userIds.map((userId) => ({
        userId,
        type: NotificationType.FRONTI_HALLAZGO,
        title: `Fronti · ${candidate.title}`,
        body: clean(
          [
            `Área: ${candidate.area}`,
            `Prioridad: ${candidate.severity}`,
            `Evidencia: ${candidate.evidence}`,
            `Lectura de Fronti: ${explanation.text}`,
          ].join(' · '),
          1800,
        ),
        link: candidate.link,
        entity: 'FrontiProactiveSignal',
        entityId: id,
      })),
    );
    notified += userIds.length;

    await recordAudit({
      entity: 'FrontiProactiveSignal',
      entityId: id,
      action: AuditAction.CREAR,
      summary: `Fronti proactivo señaló ${candidate.area}: ${candidate.title}`,
      user: null,
      after: {
        trigger: input.trigger ?? 'manual',
        severity: candidate.severity,
        area: candidate.area,
        sourceEntity: candidate.entityType,
        sourceEntityId: candidate.entityId,
        evidence: candidate.evidence,
        provider: explanation.provider,
        model: explanation.model,
        deterministicFallback: explanation.usedFallback,
        recipients: userIds.length,
      },
    });
  }

  return {
    enabled: true,
    candidates: candidates.length,
    analysed,
    notified,
    skippedCooldown,
    fallbackExplanations,
  };
}
