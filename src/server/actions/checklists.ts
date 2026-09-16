'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalString,
  zRequiredString,
  type ActionState,
} from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  finishRun,
  markRunItem,
  saveTemplate,
  softDeleteTemplate,
  startRun,
} from '@/server/services/checklists';

/**
 * Acciones de los checklists de supervisión.
 *
 * Definir las plantillas exige `incident.manage` —es configuración de
 * supervisión— pero **recorrer una ronda sólo exige sesión**: el valor del
 * control está en que lo haga quien está en el piso, y el servicio ya
 * comprueba que sólo quien la abrió la marque.
 */

function refresh() {
  revalidatePath('/supervision');
  revalidatePath('/supervision/checklists');
}

const templateSchema = z.object({
  id: zOptionalString,
  name: zRequiredString(120, 'El nombre'),
  description: zOptionalString,
  cadence: zOptionalString,
  active: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((value) => value === 'on' || value === 'true'),
  /** Un punto por línea. Un `*` al inicio lo marca como crítico. */
  items: z.string().min(1, 'Escribe al menos un punto'),
});

export async function saveChecklistTemplateAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('incident.manage');
    const input = parseOrThrow(templateSchema, formDataToObject(formData));

    const template = await saveTemplate(user, {
      id: input.id ?? null,
      name: input.name,
      description: input.description ?? null,
      cadence: input.cadence ?? null,
      active: input.active,
      items: input.items.split('\n'),
    });

    refresh();
    return {
      ok: true as const,
      message: `Lista «${template.name}» guardada con ${template.items.length} punto(s).`,
      id: template.id,
    };
  });
}

export async function deleteChecklistTemplateAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('incident.manage');
    const input = parseOrThrow(
      z.object({
        templateId: z.string().min(1),
        reason: zRequiredString(500, 'El motivo'),
      }),
      formDataToObject(formData),
    );

    await softDeleteTemplate(user, input);
    refresh();
    return { ok: true as const, message: 'Lista eliminada. Las rondas ya hechas se conservan.' };
  });
}

export async function startChecklistRunAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    // Recorrer no exige permiso de supervisión: lo hace quien está en el piso.
    const user = await requirePermission('entry.create');
    const input = parseOrThrow(
      z.object({ templateId: z.string().min(1) }),
      formDataToObject(formData),
    );

    const run = await startRun(user, input);
    refresh();
    return {
      ok: true as const,
      message: `Ronda «${run.templateName}» iniciada: ${run.items.length} puntos por revisar.`,
      id: run.id,
    };
  });
}

export async function markChecklistItemAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.create');
    const input = parseOrThrow(
      z.object({
        itemId: z.string().min(1),
        result: z.enum(['PENDIENTE', 'OK', 'FALLA', 'NO_APLICA']),
        observation: zOptionalString,
      }),
      formDataToObject(formData),
    );

    await markRunItem(user, {
      itemId: input.itemId,
      result: input.result,
      observation: input.observation ?? null,
    });
    refresh();
    return { ok: true as const, message: 'Punto marcado.' };
  });
}

export async function finishChecklistRunAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.create');
    const input = parseOrThrow(
      z.object({ runId: z.string().min(1), notes: zOptionalString }),
      formDataToObject(formData),
    );

    const result = await finishRun(user, {
      runId: input.runId,
      notes: input.notes ?? null,
    });
    refresh();

    return {
      ok: true as const,
      message:
        result.failures === 0
          ? 'Ronda cerrada sin fallas.'
          : `Ronda cerrada con ${result.failures} falla(s)` +
            (result.criticalFailures > 0
              ? `, ${result.criticalFailures} de ellas críticas. Registra las incidencias que correspondan.`
              : '.'),
    };
  });
}
