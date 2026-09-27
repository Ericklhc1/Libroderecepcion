'use server';

import { revalidatePath } from 'next/cache';
import { AlarmKind, AlarmScope } from '@prisma/client';
import { z } from 'zod';
import { runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { parseHotelDateTimeLocal } from '@/domain/time';
import { RuleError } from '@/server/errors';
import { cancelAlarm, createAlarm, respondAlarm } from '@/server/services/alarms';

const titleSchema = z.string().trim().min(2, 'Escribe qué debe recordar la alarma.').max(160);
const noteSchema = z.string().trim().max(500).optional().transform((value) => value || null);

function selectedUsers(formData: FormData): string[] {
  return formData
    .getAll('userIds')
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
}

function refresh() {
  revalidatePath('/alarmas');
  revalidatePath('/');
  revalidatePath('/notificaciones');
}

export async function createAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const kind = z.nativeEnum(AlarmKind).parse(formData.get('kind'));
    const scope = z.nativeEnum(AlarmScope).parse(formData.get('scope'));
    const title = titleSchema.parse(formData.get('title'));
    const note = noteSchema.parse(formData.get('note'));
    const userIds = selectedUsers(formData);

    let dueAt: Date;
    if (kind === AlarmKind.TIMER) {
      const minutes = z.coerce
        .number()
        .int()
        .min(1, 'El timer debe durar al menos un minuto.')
        .max(1440, 'El timer admite hasta 24 horas.')
        .parse(formData.get('timerMinutes'));
      dueAt = new Date(Date.now() + minutes * 60_000);
    } else {
      const raw = z.string().trim().min(1, 'Indica cuándo debe sonar el reminder.').parse(formData.get('reminderAt'));
      dueAt = parseHotelDateTimeLocal(raw);
    }

    if (!Number.isFinite(dueAt.getTime())) throw new RuleError('La fecha/hora no es válida.');

    const alarm = await createAlarm(user, {
      kind,
      scope,
      title,
      note,
      dueAt,
      userIds,
    });
    refresh();
    return {
      ok: true as const,
      message:
        kind === AlarmKind.TIMER
          ? 'Timer creado. Si su turno de origen termina antes, se cancelará automáticamente.'
          : 'Reminder creado. Permanecerá vigente aunque cambie el turno.',
      id: alarm.id,
    };
  });
}

export async function cancelAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const id = z.string().min(1).parse(formData.get('alarmId'));
    await cancelAlarm(user, id);
    refresh();
    return { ok: true as const, message: 'Alarma cancelada.' };
  });
}

export async function acknowledgeAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const recipientId = z.string().min(1).parse(formData.get('recipientId'));
    await respondAlarm(user, { recipientId, action: 'ACK' });
    refresh();
    return { ok: true as const, message: 'Alarma detenida para ti.' };
  });
}

export async function snoozeAlarmAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const recipientId = z.string().min(1).parse(formData.get('recipientId'));
    const minutes = z.coerce.number().int().parse(formData.get('minutes'));
    await respondAlarm(user, { recipientId, action: 'SNOOZE', minutes });
    refresh();
    return { ok: true as const, message: `Alarma pospuesta ${minutes} min.` };
  });
}
