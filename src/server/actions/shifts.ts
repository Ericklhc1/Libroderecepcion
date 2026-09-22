'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuditAction, HandoverLevel, HandoverStatus, ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate } from '@/lib/format';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalString,
  type ActionState,
} from '@/server/action';
import { shiftScheduleSchema } from '@/server/schemas';
import { requirePermission, requirePermissionOrOwner } from '@/server/auth/guard';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import {
  activateShift,
  addShiftMember,
  cancelHandoverPreparation,
  closeShift,
  endShiftParticipation,
  getShiftById,
  getShiftDesk,
  openShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import {
  ARCHIVABLE_SHIFT_STATUSES,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPE_LABEL,
  SHIFT_WINDOW_LABEL,
  plannedWindow,
} from '@/domain/shift';
import { assertAssignable } from '@/server/services/users';

function refresh(shiftId?: string) {
  revalidatePath('/');
  revalidatePath('/supervision');
  revalidatePath('/turno');
  revalidatePath('/indicadores');
  if (shiftId) revalidatePath(`/turno/${shiftId}`);
}

const shiftIdSchema = z.object({ shiftId: z.string().min(1) });

const openShiftSchema = z.object({
  type: z
    .union([z.literal(''), z.enum(['DIA', 'NOCHE'])])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
});

export async function openShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.start');
    const input = parseOrThrow(openShiftSchema, formDataToObject(formData));

    const { shift } = await openShift(user, { type: input.type });
    const desk = await getShiftDesk(user);
    const activeShift =
      shift.status === ShiftStatus.INICIADO && !desk.pending && !desk.cashPending
        ? await activateShift(user, { shiftId: shift.id })
        : shift;

    refresh(activeShift.id);

    return {
      ok: true as const,
      message:
        activeShift.status === ShiftStatus.ACTIVO
          ? `Tu turno de ${SHIFT_TYPE_LABEL[activeShift.type]} está activo (${SHIFT_WINDOW_LABEL[activeShift.type]}).`
          : `Tu turno de ${SHIFT_TYPE_LABEL[activeShift.type]} quedó abierto y espera la recepción del relevo (${SHIFT_WINDOW_LABEL[activeShift.type]}).`,
    };
  });
}

const addMemberSchema = z.object({
  shiftId: z.string().min(1),
  userId: z.string().min(1),
});

export async function addShiftMemberAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.start');
    const input = parseOrThrow(addMemberSchema, formDataToObject(formData));

    await addShiftMember(user, input);
    refresh(input.shiftId);
    return { ok: true as const, message: 'Persona sumada al turno.' };
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
      message:
        'Entrega iniciada. Revisa Novedades, Caja y pendientes antes de enviarla al turno siguiente.',
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
      message: 'Entrega enviada. Queda en la bandeja para recepción y validación de Supervisión.',
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
    const input = parseOrThrow(closeSchema, formDataToObject(formData));
    const user = await requirePermissionOrOwner('shift.manage', async () => {
      const shift = await prisma.shift.findUnique({
        where: { id: input.shiftId },
        select: { assignments: { select: { userId: true } } },
      });
      return shift?.assignments.map((assignment) => assignment.userId) ?? [];
    });
    await closeShift(user, input);
    refresh(input.shiftId);
    return { ok: true as const, message: 'Turno cerrado y enviado a revisión posterior.' };
  });
}

const handoverNoteSchema = z.object({
  handoverId: z.string().min(1),
  level: z.nativeEnum(HandoverLevel),
  title: z.string().trim().min(3, 'Escribe la nota (mínimo 3 caracteres)').max(300),
  detail: zOptionalString,
});

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

/**
 * Acción heredada sólo para compatibilidad de historial antiguo.
 * La interfaz ya no ofrece programación de turnos; el flujo normal es abrir el
 * turno al comenzar la operación. Se conserva aquí para no romper referencias
 * históricas ni migraciones mientras se limpia el código muerto.
 */
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

    const dateKey = input.date.slice(0, 10);
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const window = plannedWindow(date, input.type);

    const existing = await prisma.shift.findFirst({
      where: {
        date,
        type: input.type,
        status: ShiftStatus.PROGRAMADO,
        archivedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    const shift = existing
      ? await prisma.shift.update({
          where: { id: existing.id },
          data: { notes: input.notes, plannedStart: window.start, plannedEnd: window.end },
        })
      : await prisma.shift.create({
          data: {
            date,
            type: input.type,
            notes: input.notes,
            plannedStart: window.start,
            plannedEnd: window.end,
            createdById: user.id,
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
      summary:
        `Turno de ${SHIFT_TYPE_LABEL[input.type]} (${SHIFT_WINDOW_LABEL[input.type]}) ` +
        `del ${formatCalendarDate(date)} creado con ${input.userIds.length} persona(s)`,
      user,
      after: { userIds: input.userIds, notes: input.notes },
    });

    refresh(shift.id);
    revalidatePath('/admin/turnos');
    return {
      ok: true as const,
      message: `Turno de ${SHIFT_TYPE_LABEL[input.type]} creado: ${SHIFT_WINDOW_LABEL[input.type]}.`,
    };
  });
}

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
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.shift.update({
        where: { id: shift.id },
        data: { status: ShiftStatus.ANULADO, notes: input.reason, actualEnd: shift.actualEnd ?? now },
      });
      await endShiftParticipation(tx, shift.id, now);
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

const archiveSchema = z.object({
  shiftId: z.string().min(1),
  reason: zOptionalString,
});

export async function archiveShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.manage');
    const input = parseOrThrow(archiveSchema, formDataToObject(formData));

    const shift = await getShiftById(input.shiftId);
    if (shift.archivedAt) throw new RuleError('Ese turno ya está archivado.');

    if (!ARCHIVABLE_SHIFT_STATUSES.includes(shift.status)) {
      throw new RuleError(
        `Un turno en estado ${SHIFT_STATUS_LABEL[shift.status]} está en curso: ciérralo antes de archivarlo.`,
      );
    }

    await prisma.shift.update({
      where: { id: shift.id },
      data: { archivedAt: new Date(), archivedById: user.id },
    });

    await recordAudit({
      entity: 'Shift',
      entityId: shift.id,
      action: AuditAction.EDITAR,
      user,
      summary:
        `Turno ${SHIFT_TYPE_LABEL[shift.type]} del ${formatCalendarDate(shift.date)} ` +
        `archivado${input.reason ? `: ${input.reason}` : ''}`,
      before: { archivedAt: null },
      after: { archivedAt: new Date().toISOString() },
    });

    refresh(shift.id);
    revalidatePath('/admin/turnos');
    return { ok: true as const, message: 'Turno archivado. Sigue en el historial.' };
  });
}

export async function unarchiveShiftAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.manage');
    const input = parseOrThrow(shiftIdSchema, formDataToObject(formData));

    const shift = await getShiftById(input.shiftId);
    if (!shift.archivedAt) throw new RuleError('Ese turno no está archivado.');

    await prisma.shift.update({
      where: { id: shift.id },
      data: { archivedAt: null, archivedById: null },
    });

    await recordAudit({
      entity: 'Shift',
      entityId: shift.id,
      action: AuditAction.EDITAR,
      user,
      summary: `Turno ${SHIFT_TYPE_LABEL[shift.type]} del ${formatCalendarDate(shift.date)} desarchivado`,
    });

    refresh(shift.id);
    revalidatePath('/admin/turnos');
    return { ok: true as const, message: 'Turno devuelto a las listas.' };
  });
}
