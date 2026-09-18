import 'server-only';

import { createHash } from 'node:crypto';
import { AuditAction, NotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { notify } from '@/server/notifications';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';

export type FrontiFindingKind = 'FALLO' | 'MEJORA';
export type FrontiFindingSeverity = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';

export type FrontiFindingInput = {
  kind: FrontiFindingKind;
  severity: FrontiFindingSeverity;
  area: string;
  title: string;
  evidence: string;
  recommendation?: string | null;
};

const DEDUPE_MS = 24 * 60 * 60 * 1000;

function clean(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function fingerprintOf(input: FrontiFindingInput): string {
  const stable = [
    input.kind,
    input.area.toLowerCase(),
    input.title.toLowerCase(),
    input.evidence.toLowerCase(),
  ]
    .map((value) => clean(value, 500))
    .join('|');

  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

/**
 * Reporta un hallazgo de Fronti a Supervisión + Administrador de sistema.
 *
 * La deduplicación vive en el centro de notificaciones y no en el modelo:
 * aunque Fronti vea el mismo problema varias veces, cada destinatario recibe
 * como máximo un aviso por huella en 24 horas.
 */
export async function reportFrontiFinding(
  user: CurrentUser,
  raw: FrontiFindingInput,
): Promise<{
  fingerprint: string;
  notified: number;
  deduplicated: number;
}> {
  const input: FrontiFindingInput = {
    kind: raw.kind,
    severity: raw.severity,
    area: clean(raw.area, 120),
    title: clean(raw.title, 200),
    evidence: clean(raw.evidence, 1200),
    recommendation: raw.recommendation ? clean(raw.recommendation, 1200) : null,
  };

  if (!input.area || !input.title || !input.evidence) {
    throw new Error('El hallazgo necesita área, título y evidencia concreta.');
  }

  const fingerprint = fingerprintOf(input);
  const recipients = await prisma.user.findMany({
    where: {
      active: true,
      deletedAt: null,
      role: {
        key: { in: [ROLE_KEYS.SUPERVISOR, ROLE_KEYS.SYSTEM_ADMIN] },
      },
    },
    select: { id: true },
  });

  if (recipients.length === 0) {
    return { fingerprint, notified: 0, deduplicated: 0 };
  }

  const cutoff = new Date(Date.now() - DEDUPE_MS);
  const recent = await prisma.notification.findMany({
    where: {
      userId: { in: recipients.map((recipient) => recipient.id) },
      type: NotificationType.FRONTI_HALLAZGO,
      entity: 'FrontiFinding',
      entityId: fingerprint,
      createdAt: { gte: cutoff },
    },
    select: { userId: true },
  });
  const already = new Set(recent.map((notification) => notification.userId));
  const pending = recipients.filter((recipient) => !already.has(recipient.id));

  const prefix = input.kind === 'FALLO' ? 'Fallo detectado' : 'Mejora de proceso';
  const body = [
    `Área: ${input.area}`,
    `Gravedad: ${input.severity}`,
    `Evidencia: ${input.evidence}`,
    input.recommendation ? `Sugerencia: ${input.recommendation}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  await notify(
    pending.map((recipient) => ({
      userId: recipient.id,
      type: NotificationType.FRONTI_HALLAZGO,
      title: `Fronti · ${prefix}: ${input.title}`,
      body,
      link: '/notificaciones',
      entity: 'FrontiFinding',
      entityId: fingerprint,
    })),
  );

  await recordAudit({
    entity: 'FrontiFinding',
    entityId: fingerprint,
    action: AuditAction.CREAR,
    user,
    summary:
      `Fronti reportó ${input.kind === 'FALLO' ? 'un fallo' : 'una mejora'} en ${input.area}: ${input.title}. ` +
      `${pending.length} notificación(es), ${recent.length} deduplicada(s).`,
    after: {
      ...input,
      fingerprint,
      notified: pending.length,
      deduplicated: recent.length,
    },
  });

  return {
    fingerprint,
    notified: pending.length,
    deduplicated: recent.length,
  };
}
