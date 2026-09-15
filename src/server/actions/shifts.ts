'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuditAction, HandoverLevel, HandoverStatus, ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalString,
  type ActionState,
} from '@/server/action';
import { shiftScheduleSchema } from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import {
  cancelHandoverPreparation,
  closeShift,
  ensureShift,
  getShiftById,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import { SHIFT_TYPE_LABEL, plannedWindow } from '@/domain/shift';
import { assertAssignable } from '@/server/services/users';

function refresh(shiftId?: string) {
  revalidatePath('/');
  revalidatePath('/turno');
  revalidatePath('/indicadores');
  if (shiftId) revalidatePath(`/turno/${shiftId}`);
}

const shiftIdSchema = z.object({ shiftId: z.string().min(1) });

export async function startShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.start');
    const input = parseOrThrow(shiftIdSchema, formDataToObject(formData));
    const { startShift } = await import('@/server/services/shifts');
    const shift = await startShift(user, input.shiftId);
    refresh(shift.id);
    return {
      ok: true as const,
      message: `Turno ${SHIFT_TYPE_LABEL[shift.type]} iniciado. Revisa y confirma la entrega anterior.`,
    };
  });
}

const receiveSchema = z.object({
  shiftId: z.string().min(1),
  handoverId: z
    .string()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  observations: zOptionalString,
});

export async function receiveHandoverAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.receive');
    const input = parseOrThrow(receiveSchema, formDataToObject(formData));
    await receiveHandover(user, input);
    refresh(input.shiftId);
    return {
      ok: true as const,
      message: 'Recepción confirmada. Tu turno está activo.',
    };
  });
}

export async function prepareHandoverAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = parseOrThrow(shiftIdSchema, formDataToObject(formData));
    const handover = await prepareHandover(user, input.shiftId);
    refresh(input.shiftId);
    revalidatePath(`/turno/entrega/${handover.id}`);
    return {
      ok: true as const,
      message: 'Resumen de entrega generado. Revísalo, agrega notas y envíalo.',
      id: handover.id,
    };
  });
}

const sendSchema = z.object({
  shiftId: z.string().min(1),
  notes: zOptionalString,
});

export async function sendHandoverAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = parseOrThrow(sendSchema, formDataToObject(formData));
    const handover = await sendHandover(user, input);
    refresh(input.shiftId);
    revalidatePath(`/turno/entrega/${handover.id}`);
    return {
      ok: true as const,
      message: 'Entrega enviada. El turno siguiente debe confirmarla.',
      id: handover.id,
    };
  });
}

export async function cancelHandoverPreparationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = parseOrThrow(shiftIdSchema, formDataToObject(formData));
    await cancelHandoverPreparation(user, input.shiftId);
    refresh(input.shiftId);
    return { ok: true as const, message: 'Preparación cancelada. Tu turno sigue activo.' };
  });
}

const closeSchema = z.object({
  shiftId: z.string().min(1),
  notes: zOptionalString,
});

export async function closeShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.close');
    const input = parseOrThrow(closeSchema, formDataToObject(formData));
    await closeShift(user, input);
    refresh(input.shiftId);
    return { ok: true as const, message: 'Turno cerrado.' };
  });
}

const handoverNoteSchema = z.object({
  handoverId: z.string().min(1),
  level: z.nativeEnum(HandoverLevel),
  title: z.string().trim().min(3, 'Escribe la nota (mínimo 3 caracteres)').max(300),
  detail: zOptionalString,
});

/** Nota manual dentro de la entrega, clasificada por urgencia. */
export async function addHandoverNoteAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = parseOrThrow(handoverNoteSchema, formDataToObject(formData));

    const handover = await prisma.shiftHandover.findUnique({
      where: { id: input.handoverId },
      include: { fromShift: { include: { assignments: true } } },
    });
    if (!handover) throw new NotFoundError('La entrega no existe.');
    if (handover.status !== HandoverStatus.BORRADOR) {
      throw new RuleError('La entrega ya fue enviada: no admite nuevas notas.');
    }
    if (!handover.fromShift.assignments.some((a) => a.userId === user.id)) {
      throw new RuleError('Sólo quien está en el turno puede agregar notas a su entrega.');
    }

    const last = await prisma.handoverItem.findFirst({
      where: { handoverId: input.handoverId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    await prisma.handoverItem.create({
      data: {
        handoverId: input.handoverId,
        level: input.level,
        section: 'Observaciones del turno',
        title: input.title,
        detail: input.detail,
        manual: true,
        order: (last?.order ?? 0) + 1,
      },
    });

    revalidatePath(`/turno/entrega/${input.handoverId}`);
    revalidatePath('/turno');
    return { ok: true as const, message: 'Nota agregada a la entrega.' };
  });
}

export async function removeHandoverNoteAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = parseOrThrow(
      z.object({ itemId: z.string().min(1) }),
      formDataToObject(formData),
    );

    const item = await prisma.handoverItem.findUnique({
      where: { id: input.itemId },
      include: { handover: { include: { fromShift: { include: { assignments: true } } } } },
    });
    if (!item) throw new NotFoundError('La nota no existe.');
    if (!item.manual) throw new RuleError('El resumen automático no se edita manualmente.');
    if (item.handover.status !== HandoverStatus.BORRADOR) {
      throw new RuleError('La entrega ya fue enviada.');
    }
    if (!item.handover.fromShift.assignments.some((a) => a.userId === user.id)) {
      throw new RuleError('Sólo quien está en el turno puede editar su entrega.');
    }

    await prisma.handoverItem.delete({ where: { id: input.itemId } });
    revalidatePath(`/turno/entrega/${item.handoverId}`);
    return { ok: true as const, message: 'Nota eliminada.' };
  });
}

/** Programación de turnos y asignación de personal (supervisión). */
export async function scheduleShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.manage');
    const input = parseOrThrow(shiftScheduleSchema, formDataToObject(formData));

    for (const userId of input.userIds) {
      await assertAssignable(userId);
    }

    const date = new Date(input.date);
    date.setHours(0, 0, 0, 0);
    const shift = await ensureShift(date, input.type, user.id);

    const window = plannedWindow(date, input.type);
    await prisma.shift.update({
      where: { id: shift.id },
      data: {
        notes: input.notes,
        plannedStart: window.start,
        plannedEnd: window.end,
      },
    });

    if (input.userIds.length > 0) {
      await prisma.shiftAssignment.deleteMany({
        where: { shiftId: shift.id, userId: { notIn: input.userIds } },
      });
      await prisma.shiftAssignment.createMany({
        data: input.userIds.map((userId, index) => ({
          shiftId: shift.id,
          userId,
          role: index === 0 ? 'TITULAR' : 'APOYO',
        })),
        skipDuplicates: true,
      });
    }

    await recordAudit({
      entity: 'Shift',
      entityId: shift.id,
      action: AuditAction.EDITAR,
      summary: `Turno ${SHIFT_TYPE_LABEL[input.type]} del ${date.toLocaleDateString('es-CL')} programado con ${input.userIds.length} persona(s)`,
      user,
      after: { userIds: input.userIds, notes: input.notes },
    });

    refresh(shift.id);
    revalidatePath('/admin/turnos');
    return { ok: true as const, message: 'Turno programado.' };
  });
}

/** Anula un turno programado que no se usará (por ejemplo, error de carga). */
export async function cancelShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.manage');
    const input = parseOrThrow(
      z.object({ shiftId: z.string().min(1), reason: z.string().trim().min(5) }),
      formDataToObject(formData),
    );
    const shift = await getShiftById(input.shiftId);
    if (shift.status !== ShiftStatus.PROGRAMADO) {
      throw new RuleError('Sólo pueden anularse turnos que aún no han iniciado.');
    }
    await prisma.shift.update({
      where: { id: shift.id },
      data: { status: ShiftStatus.ANULADO, notes: input.reason },
    });
    await recordAudit({
      entity: 'Shift',
      entityId: shift.id,
      action: AuditAction.CAMBIO_ESTADO,
      summary: `Turno ${SHIFT_TYPE_LABEL[shift.type]} anulado`,
      user,
      before: { status: shift.status },
      after: { status: ShiftStatus.ANULADO },
      reason: input.reason,
    });
    refresh(shift.id);
    revalidatePath('/admin/turnos');
    return { ok: true as const, message: 'Turno anulado.' };
  });
}
