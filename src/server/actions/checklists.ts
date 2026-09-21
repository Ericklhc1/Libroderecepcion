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
 * La configuración y la ejecución usan permisos propios del Centro de
 * Supervisión. El servicio exige además el rol Supervisor para operar una
 * auditoría; el Administrador conserva acceso técnico, pero no aparece como
 * auditor responsable.
 */

function refresh() {
  revalidatePath('/supervision');
  revalidatePath('/supervision/tablero');
  revalidatePath('/supervision/auditorias');
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
  category: z.enum([
    'CAJA_MOVIMIENTOS',
    'GARANTIAS',
    'LLAVES',
    'RESERVAS',
    'HABITACIONES',
    'CALIDAD_REGISTROS',
    'ENTREGA_CIERRE_TURNO',
    'CUMPLIMIENTO_PROCEDIMIENTOS',
    'OTRO',
  ]).default('OTRO'),
});

export async function saveChecklistTemplateAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.audit.create');
    const input = parseOrThrow(templateSchema, formDataToObject(formData));

    const template = await saveTemplate(user, {
      id: input.id ?? null,
      name: input.name,
      description: input.description ?? null,
      cadence: input.cadence ?? null,
      active: input.active,
      category: input.category,
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
    const user = await requirePermission('supervision.audit.create');
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
    const user = await requirePermission('supervision.audit.create');
    const input = parseOrThrow(
      z.object({
        templateId: z.string().min(1),
        scope: zOptionalString,
        sample: zOptionalString,
        participantIds: z.union([z.string(), z.array(z.string())]).optional().transform((value) =>
          value ? (Array.isArray(value) ? value : [value]) : [],
        ),
        reviewedShiftIds: z.union([z.string(), z.array(z.string())]).optional().transform((value) =>
          value ? (Array.isArray(value) ? value : [value]) : [],
        ),
        reviewedDepartmentIds: z.union([z.string(), z.array(z.string())]).optional().transform((value) =>
          value ? (Array.isArray(value) ? value : [value]) : [],
        ),
      }),
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
    const user = await requirePermission('supervision.audit.create');
    const input = parseOrThrow(
      z.object({
        itemId: z.string().min(1),
        result: z.enum([
          'PENDIENTE',
          'OK',
          'CUMPLE',
          'OBSERVACION',
          'FALLA',
          'INCUMPLIMIENTO',
          'NO_APLICA',
        ]),
        observation: zOptionalString,
        evidence: zOptionalString,
      }),
      formDataToObject(formData),
    );

    await markRunItem(user, {
      itemId: input.itemId,
      result: input.result,
      observation: input.observation ?? null,
      evidence: input.evidence ?? null,
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
    const user = await requirePermission('supervision.audit.close');
    const input = parseOrThrow(
      z.object({
        runId: z.string().min(1),
        notes: zOptionalString,
        resultSummary: zOptionalString,
        disclosure: z.enum(['RESERVADO', 'PERSONA', 'SUPERVISION', 'OPERATIVO']).default('RESERVADO'),
      }),
      formDataToObject(formData),
    );

    const result = await finishRun(user, {
      runId: input.runId,
      notes: input.notes ?? null,
      resultSummary: input.resultSummary ?? null,
      disclosure: input.disclosure,
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
