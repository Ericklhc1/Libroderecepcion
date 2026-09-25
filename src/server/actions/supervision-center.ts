'use server';

import { revalidatePath } from 'next/cache';
import {
  CorrectiveMeasureStatus,
  PerformanceObservationKind,
  SupervisionVisibility,
} from '@prisma/client';
import { z } from 'zod';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalDate,
  zOptionalString,
  zRequiredString,
  type ActionState,
} from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  createSupervisionNote,
  deliverSupervisionShift,
  finishSupervisionShift,
  followSupervisionSource,
  receiveSupervisionHandover,
  restoreSupervisionNote,
  softDeleteSupervisionNote,
  startSupervisionShift,
} from '@/server/services/supervision-center';
import {
  changeCorrectiveMeasureStatus,
  createCorrectiveMeasureFromFinding,
  restoreCorrectiveMeasure,
} from '@/server/services/corrective-measures';
import { addPerformanceObservation } from '@/server/services/performance';

function refresh() {
  revalidatePath('/supervision');
  revalidatePath('/supervision/auditorias');
  revalidatePath('/supervision/rendimiento');
  revalidatePath('/tareas');
  revalidatePath('/seguimientos');
}

export async function startSupervisionShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.shift.manage');
    const input = parseOrThrow(
      z.object({ priorities: zOptionalString }),
      formDataToObject(formData),
    );
    const shift = await startSupervisionShift(user, {
      priorities: (input.priorities ?? '').split('\n'),
    });
    refresh();
    return { ok: true as const, message: 'Turno de Supervisión iniciado.', id: shift.id };
  });
}

export async function deliverSupervisionShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.shift.manage');
    const input = parseOrThrow(
      z.object({ shiftId: z.string().min(1), note: zOptionalString }),
      formDataToObject(formData),
    );
    await deliverSupervisionShift(user, input);
    refresh();
    return { ok: true as const, message: 'Entrega inalterable generada.' };
  });
}

export async function finishSupervisionShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.shift.manage');
    const input = parseOrThrow(
      z.object({ shiftId: z.string().min(1) }),
      formDataToObject(formData),
    );
    await finishSupervisionShift(user, input.shiftId);
    refresh();
    return { ok: true as const, message: 'Turno de Supervisión finalizado.' };
  });
}

export async function receiveSupervisionHandoverAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.shift.manage');
    const input = parseOrThrow(
      z.object({ handoverId: z.string().min(1) }),
      formDataToObject(formData),
    );
    await receiveSupervisionHandover(user, input.handoverId);
    refresh();
    return { ok: true as const, message: 'Entrega de Supervisión recibida.' };
  });
}

export async function followSupervisionSourceAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.followup.manage');
    const input = parseOrThrow(
      z.object({
        sourceEntity: z.enum([
          'OperationalEntry',
          'Alert',
          'Guarantee',
          'CashAudit',
          'Task',
          'ShiftHandover',
          'Shift',
          'KeyInventoryCount',
        ]),
        sourceId: z.string().min(1),
      }),
      formDataToObject(formData),
    );
    const followUp = await followSupervisionSource(user, input);
    refresh();
    return { ok: true as const, message: 'Añadido a Mi continuidad.', id: followUp.id };
  });
}

export async function createSupervisionNoteAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.note.private');
    const input = parseOrThrow(
      z.object({
        title: zRequiredString(160, 'El título'),
        body: zRequiredString(6000, 'La nota'),
        visibility: z.nativeEnum(SupervisionVisibility),
        sourceEntity: zOptionalString,
        sourceId: zOptionalString,
      }),
      formDataToObject(formData),
    );
    const note = await createSupervisionNote(user, input);
    refresh();
    return { ok: true as const, message: 'Nota guardada.', id: note.id };
  });
}

export async function deleteSupervisionNoteAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.note.private');
    const input = parseOrThrow(
      z.object({ id: z.string().min(1), reason: zRequiredString(500, 'El motivo') }),
      formDataToObject(formData),
    );
    await softDeleteSupervisionNote(user, input);
    refresh();
    return { ok: true as const, message: 'Nota eliminada. Puede recuperarse.' };
  });
}

export async function restoreSupervisionNoteAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.restore');
    const input = parseOrThrow(z.object({ id: z.string().min(1) }), formDataToObject(formData));
    await restoreSupervisionNote(user, input.id);
    refresh();
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Nota de Supervisión restaurada.' };
  });
}

export async function restoreCorrectiveMeasureAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.restore');
    const input = parseOrThrow(z.object({ id: z.string().min(1) }), formDataToObject(formData));
    await restoreCorrectiveMeasure(user, input.id);
    refresh();
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Medida correctiva restaurada.' };
  });
}

export async function createCorrectiveMeasureAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.corrective.manage');
    const input = parseOrThrow(
      z.object({
        findingId: z.string().min(1),
        title: zRequiredString(200, 'El título'),
        action: zRequiredString(4000, 'La acción correctiva'),
        assigneeId: z.string().min(1),
        dueAt: zOptionalDate,
        evidenceRequired: zOptionalString,
      }),
      formDataToObject(formData),
    );
    const measure = await createCorrectiveMeasureFromFinding(user, input);
    refresh();
    return { ok: true as const, message: 'Medida correctiva y tarea creadas.', id: measure.id };
  });
}

export async function changeCorrectiveMeasureStatusAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.corrective.manage');
    const input = parseOrThrow(
      z.object({
        id: z.string().min(1),
        status: z.nativeEnum(CorrectiveMeasureStatus),
        evidence: zOptionalString,
        reason: zOptionalString,
      }),
      formDataToObject(formData),
    );
    await changeCorrectiveMeasureStatus(user, input);
    refresh();
    return { ok: true as const, message: 'Medida correctiva actualizada.' };
  });
}

export async function addPerformanceObservationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.performance.comment');
    const input = parseOrThrow(
      z.object({
        subjectId: z.string().min(1),
        kind: z.nativeEnum(PerformanceObservationKind),
        periodStart: zOptionalDate.refine(Boolean, 'Indica el inicio del periodo'),
        periodEnd: zOptionalDate.refine(Boolean, 'Indica el fin del periodo'),
        content: zRequiredString(4000, 'La observación'),
        sourceEntity: zOptionalString,
        sourceId: zOptionalString,
      }),
      formDataToObject(formData),
    );
    const observation = await addPerformanceObservation(user, {
      ...input,
      periodStart: input.periodStart!,
      periodEnd: input.periodEnd!,
    });
    refresh();
    return { ok: true as const, message: 'Observación registrada.', id: observation.id };
  });
}
