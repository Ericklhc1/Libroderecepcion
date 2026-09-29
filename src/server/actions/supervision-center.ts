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
  beginSupervisionOpening,
  completeSupervisionOpening,
  createSupervisionNote,
  deliverSupervisionShift,
  finishSupervisionShift,
  followSupervisionSource,
  receiveSupervisionHandover,
  restoreSupervisionNote,
  softDeleteSupervisionNote,
} from '@/server/services/supervision-center';
import {
  reviewSupervisionAuditItem,
  updateSupervisionAuditDeparturesPending,
} from '@/server/services/supervision-audit-import';
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
  _formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.shift.manage');
    const shift = await beginSupervisionOpening(user);
    refresh();
    return {
      ok: true as const,
      message: 'Apertura de Supervisión iniciada. Completa la recepción operacional para activar tu turno.',
      id: shift.id,
    };
  });
}

export async function completeSupervisionOpeningAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.shift.manage');
    const input = parseOrThrow(
      z.object({
        shiftId: z.string().min(1),
        reviewedPending: z.literal('on', {
          errorMap: () => ({ message: 'Confirma que revisaste el estado operativo recibido.' }),
        }),
        reviewedGuarantees: z.literal('on', {
          errorMap: () => ({ message: 'Confirma que verificaste garantías y custodias.' }),
        }),
        reviewedKeys: z.literal('on', {
          errorMap: () => ({ message: 'Confirma que revisaste el inventario y las excepciones de llaves.' }),
        }),
        reportContingencyReason: zOptionalString,
      }),
      formDataToObject(formData),
    );
    const shift = await completeSupervisionOpening(user, {
      shiftId: input.shiftId,
      reviewedPending: true,
      reviewedGuarantees: true,
      reviewedKeys: true,
      reportContingencyReason: input.reportContingencyReason,
    });
    refresh();
    return {
      ok: true as const,
      message: 'Turno de Supervisión iniciado con recepción operacional confirmada.',
      id: shift.id,
    };
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
      z.object({
        shiftId: z.string().min(1),
        reviewedCritical: z.literal('on', {
          errorMap: () => ({ message: 'Confirma que revisaste las señales críticas.' }),
        }),
        reviewedAudit: z.literal('on', {
          errorMap: () => ({ message: 'Confirma que revisaste la auditoría diaria.' }),
        }),
        reviewedContinuity: z.literal('on', {
          errorMap: () => ({ message: 'Confirma que revisaste pendientes, delegaciones y seguimientos.' }),
        }),
      }),
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


export async function reviewSupervisionAuditItemAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.audit.create');
    const input = parseOrThrow(
      z.object({
        auditImportId: z.string().min(1),
        target: z.enum(['CHECK', 'FINDING']),
        key: z.string().min(1),
        status: z.enum(['RESUELTO', 'NO_APLICA', 'REABRIR']),
        note: zOptionalString,
      }),
      formDataToObject(formData),
    );
    await reviewSupervisionAuditItem(user, {
      auditImportId: input.auditImportId,
      target: input.target,
      key: input.key,
      status: input.status === 'REABRIR' ? null : input.status,
      note: input.note,
    });
    refresh();
    return {
      ok: true as const,
      message:
        input.status === 'REABRIR'
          ? 'Punto reabierto.'
          : input.status === 'NO_APLICA'
            ? 'Punto retirado como no aplicable.'
            : 'Punto resuelto.',
    };
  });
}

export async function updateSupervisionAuditDeparturesPendingAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.audit.create');
    const input = parseOrThrow(
      z.object({
        auditImportId: z.string().min(1),
        value: z.coerce.number().int('Indica una cantidad entera.').min(0, 'No puede ser negativo.'),
        reset: zOptionalString,
        note: zOptionalString,
      }),
      formDataToObject(formData),
    );
    const value = input.reset === '1' ? null : input.value;
    await updateSupervisionAuditDeparturesPending(user, {
      auditImportId: input.auditImportId,
      value,
      note: input.note,
    });
    refresh();
    return {
      ok: true as const,
      message: value === null ? 'Se restauró el valor del informe.' : 'Pendientes actualizados.',
    };
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
