'use server';

import {
  OperationalAlarmKind,
  OperationalAlarmScope,
} from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  type ActionState,
} from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { parseHotelDateTimeLocal } from '@/domain/time';
import {
  cancelOperationalAlarm,
  createOperationalAlarm,
  updateOperationalAlarm,
} from '@/server/services/operational-alarms';

const createSchema = z.object({
  kind: z.nativeEnum(OperationalAlarmKind),
  scope: z.nativeEnum(OperationalAlarmScope),
  title: z.string().trim().min(2, 'Escribe qué debe recordar la alarma.').max(160),
  note: z.string().trim().max(500).optional().transform((value) => value || null),
  timerMinutes: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .refine((value) => value === null || (Number.isFinite(value) && value >= 1 && value <= 1440), {
      message: 'El timer debe durar entre 1 minuto y 24 horas.',
    }),
  dueAtLocal: z.string().trim().optional(),
  recipientIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => (Array.isArray(value) ? value : value ? [value] : [])),
  sourceEntity: z.string().trim().max(80).optional().transform((value) => value || null),
  sourceId: z.string().trim().max(120).optional().transform((value) => value || null),
  sourceLink: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null)
    .refine((value) => value === null || value.startsWith('/'), {
      message: 'El vínculo de origen debe ser una ruta interna de AROH.',
    }),
});

const cancelSchema = z.object({ alarmId: z.string().min(1) });

const updateSchema = z.object({
  alarmId: z.string().min(1),
  title: z.string().trim().min(2, 'Escribe el motivo de la alerta.').max(160),
  note: z.string().trim().max(500).optional().transform((value) => value || null),
  dueAtLocal: z.string().trim().min(1, 'Indica fecha y hora.'),
});

export async function createOperationalAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(createSchema, formDataToObject(formData));

    let dueAt: Date;
    if (input.kind === OperationalAlarmKind.TIMER) {
      if (!input.timerMinutes) throw new RuleError('Indica cuántos minutos durará el timer.');
      dueAt = new Date(Date.now() + input.timerMinutes * 60_000);
    } else {
      if (!input.dueAtLocal) throw new RuleError('Indica fecha y hora del recordatorio.');
      try {
        dueAt = parseHotelDateTimeLocal(input.dueAtLocal);
      } catch {
        throw new RuleError('La fecha y hora del recordatorio no es válida.');
      }
    }

    const alarm = await createOperationalAlarm(user, {
      kind: input.kind,
      scope: input.scope,
      title: input.title,
      note: input.note,
      dueAt,
      recipientIds: input.recipientIds,
      sourceEntity: input.sourceEntity,
      sourceId: input.sourceId,
      sourceLink: input.sourceLink,
    });
    revalidatePath('/alertas');
    if (input.sourceLink) revalidatePath(input.sourceLink);
    return {
      ok: true as const,
      id: alarm.id,
      message:
        input.kind === OperationalAlarmKind.TIMER
          ? 'Timer iniciado.'
          : 'Alerta programada.',
    };
  });
}

export async function updateOperationalAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(updateSchema, formDataToObject(formData));
    let dueAt: Date;
    try {
      dueAt = parseHotelDateTimeLocal(input.dueAtLocal);
    } catch {
      throw new RuleError('La fecha y hora de la alerta no es válida.');
    }
    const updated = await updateOperationalAlarm(user, {
      id: input.alarmId,
      title: input.title,
      note: input.note,
      dueAt,
    });
    revalidatePath('/alertas');
    if (updated.sourceLink) revalidatePath(updated.sourceLink);
    return { ok: true as const, id: updated.id, message: 'Alerta actualizada.' };
  });
}

export async function cancelOperationalAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(cancelSchema, formDataToObject(formData));
    await cancelOperationalAlarm(user, input.alarmId);
    revalidatePath('/alertas');
    return { ok: true as const, message: 'Alerta eliminada de la operación activa.' };
  });
}
