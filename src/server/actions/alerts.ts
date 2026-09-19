'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import {
  alertActionSchema,
  alertCreateSchema,
  restoreSchema,
  softDeleteSchema,
} from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import {
  acknowledgeAlert,
  createManualAlert,
  resolveAlert,
  restoreAlert,
  snoozeAlert,
  softDeleteAlert,
} from '@/server/services/alerts';
import { runAlertEngine } from '@/server/services/alert-engine';

function refresh() {
  revalidatePath('/');
  revalidatePath('/alertas');
  revalidatePath('/notificaciones');
  revalidatePath('/libro');
  revalidatePath('/supervision');
}

export async function createAlertAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('alert.manage');
    const input = parseOrThrow(alertCreateSchema, formDataToObject(formData));
    const alert = await createManualAlert(user, input);
    refresh();
    return { ok: true as const, message: 'Alerta creada.', id: alert.id };
  });
}

export async function acknowledgeAlertAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('alert.manage');
    const input = parseOrThrow(alertActionSchema, formDataToObject(formData));
    await acknowledgeAlert(user, input.id);
    refresh();
    return { ok: true as const, message: 'Alerta marcada como vista.' };
  });
}

export async function snoozeAlertAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('alert.manage');
    const input = parseOrThrow(alertActionSchema, formDataToObject(formData));
    await snoozeAlert(user, input);
    refresh();
    return { ok: true as const, message: 'Alerta pospuesta.' };
  });
}

export async function resolveAlertAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseOrThrow(alertActionSchema, formDataToObject(formData));
    const alert = await prisma.alert.findUnique({
      where: { id: input.id },
      select: { dedupeKey: true },
    });
    const cashApproval =
      alert?.dedupeKey?.startsWith('cash-transfer:') === true ||
      alert?.dedupeKey?.startsWith('cash-manual:') === true;
    const user = await requirePermission(cashApproval ? 'cash.approve' : 'alert.manage');
    await resolveAlert(user, input);
    refresh();
    return { ok: true as const, message: 'Alerta resuelta.' };
  });
}

export async function deleteAlertAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.delete');
    const input = parseOrThrow(softDeleteSchema, formDataToObject(formData));
    await softDeleteAlert(user, input);
    refresh();
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Alerta eliminada. Queda recuperable.' };
  });
}

export async function restoreAlertAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.restore');
    const input = parseOrThrow(restoreSchema, formDataToObject(formData));
    await restoreAlert(user, input);
    refresh();
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Alerta restaurada.' };
  });
}

/** Ejecuta el motor de alertas a demanda (Administración → Mantenimiento). */
export async function runAlertEngineAction(): Promise<ActionState> {
  return runAction(async () => {
    await requirePermission('alert.manage');
    const result = await runAlertEngine();
    refresh();
    return {
      ok: true as const,
      message: `Motor ejecutado: ${result.created} nueva(s), ${result.reopened} reabierta(s), ${result.resolved} resuelta(s).`,
    };
  });
}
