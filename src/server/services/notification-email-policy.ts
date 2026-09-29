import 'server-only';

import { AuditAction, NotificationType, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';

export const NOTIFICATION_EMAIL_MODES = ['OBLIGATORIO', 'PREFERENCIA', 'DESACTIVADO'] as const;
export type NotificationEmailMode = (typeof NOTIFICATION_EMAIL_MODES)[number];

export const FORCED_NOTIFICATION_EMAIL_POLICY: Partial<
  Record<NotificationType, NotificationEmailMode>
> = {
  TAREA_VENCIDA: 'OBLIGATORIO',
  INCIDENCIA_CRITICA: 'OBLIGATORIO',
  ENTREGA_DISPONIBLE: 'OBLIGATORIO',
  ACCION_REQUERIDA: 'OBLIGATORIO',
  CHAT_MENSAJE: 'DESACTIVADO',
  ALARMA: 'DESACTIVADO',
};

export const DEFAULT_NOTIFICATION_EMAIL_POLICY: Record<NotificationType, NotificationEmailMode> = {
  TAREA_ASIGNADA: 'PREFERENCIA',
  RESPONSABLE_CAMBIADO: 'PREFERENCIA',
  VENCIMIENTO_PROXIMO: 'PREFERENCIA',
  TAREA_VENCIDA: 'OBLIGATORIO',
  INCIDENCIA_CRITICA: 'OBLIGATORIO',
  ENTREGA_DISPONIBLE: 'OBLIGATORIO',
  COMENTARIO: 'PREFERENCIA',
  MENCION: 'PREFERENCIA',
  ACCION_REQUERIDA: 'OBLIGATORIO',
  ACTUALIZACION_OPERATIVA: 'PREFERENCIA',
  FRONTI_HALLAZGO: 'PREFERENCIA',
  CHAT_MENSAJE: 'DESACTIVADO',
  ALARMA: 'DESACTIVADO',
};

const PREFIX = 'notification.email.';

function keyFor(type: NotificationType): string {
  return `${PREFIX}${type}`;
}

export function forcedNotificationEmailMode(
  type: NotificationType,
): NotificationEmailMode | null {
  return FORCED_NOTIFICATION_EMAIL_POLICY[type] ?? null;
}

export function notificationEmailPolicyLocked(type: NotificationType): boolean {
  return forcedNotificationEmailMode(type) !== null;
}

function asMode(value: Prisma.JsonValue | null | undefined): NotificationEmailMode | null {
  return typeof value === 'string' &&
    (NOTIFICATION_EMAIL_MODES as readonly string[]).includes(value)
    ? (value as NotificationEmailMode)
    : null;
}

export async function getNotificationEmailPolicy(): Promise<Record<NotificationType, NotificationEmailMode>> {
  const types = Object.values(NotificationType);
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: types.map(keyFor) } },
    select: { key: true, value: true },
  });
  const overrides = new Map(rows.map((row) => [row.key, asMode(row.value)]));
  return Object.fromEntries(
    types.map((type) => [
      type,
      forcedNotificationEmailMode(type) ??
        overrides.get(keyFor(type)) ??
        DEFAULT_NOTIFICATION_EMAIL_POLICY[type],
    ]),
  ) as Record<NotificationType, NotificationEmailMode>;
}

export async function saveNotificationEmailPolicy(
  user: CurrentUser,
  policy: Record<NotificationType, NotificationEmailMode>,
): Promise<void> {
  const previous = await getNotificationEmailPolicy();
  const types = Object.values(NotificationType);

  const effective = Object.fromEntries(
    types.map((type) => [
      type,
      forcedNotificationEmailMode(type) ?? policy[type] ?? DEFAULT_NOTIFICATION_EMAIL_POLICY[type],
    ]),
  ) as Record<NotificationType, NotificationEmailMode>;

  await prisma.$transaction(async (tx) => {
    const lockedKeys = types
      .filter((type) => notificationEmailPolicyLocked(type))
      .map(keyFor);
    if (lockedKeys.length > 0) {
      await tx.systemSetting.deleteMany({ where: { key: { in: lockedKeys } } });
    }

    for (const type of types) {
      if (notificationEmailPolicyLocked(type)) continue;
      const mode = effective[type];
      await tx.systemSetting.upsert({
        where: { key: keyFor(type) },
        create: {
          key: keyFor(type),
          value: mode,
          category: 'notificaciones-correo',
          description: `Política de correo para notificaciones ${type}.`,
          updatedById: user.id,
        },
        update: {
          value: mode,
          category: 'notificaciones-correo',
          updatedById: user.id,
        },
      });
    }

    await recordAudit(
      {
        entity: 'NotificationEmailPolicy',
        entityId: 'default',
        action: AuditAction.CONFIGURAR,
        user,
        summary: 'Política de correo de notificaciones actualizada',
        before: previous,
        after: effective,
      },
      tx,
    );
  });
}
