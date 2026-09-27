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
});

const cancelSchema = z.object({ alarmId: z.string().min(1) });

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
    });
    revalidatePath('/avisos');
    return {
      ok: true as const,
      id: alarm.id,
      message:
        input.kind === OperationalAlarmKind.TIMER
          ? 'Timer iniciado.'
          : 'Recordatorio programado.',
    };
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
    revalidatePath('/avisos');
    return { ok: true as const, message: 'Alarma cancelada.' };
  });
}
