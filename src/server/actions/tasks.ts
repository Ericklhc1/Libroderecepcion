'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import {
  restoreSchema,
  softDeleteSchema,
  taskAssignSchema,
  taskCreateSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from '@/server/schemas';
import { prisma } from '@/lib/prisma';
import { requirePermission, requirePermissionOrOwner } from '@/server/auth/guard';
import {
  assignTask,
  changeTaskStatus,
  createTask,
  restoreTask,
  softDeleteTask,
  toggleChecklistItem,
  updateTask,
} from '@/server/services/tasks';

function refresh(taskId?: string) {
  revalidatePath('/');
  revalidatePath('/tareas');
  revalidatePath('/libro');
  revalidatePath('/supervision');
  if (taskId) revalidatePath(`/tareas/${taskId}`);
}

export async function createTaskAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('task.create');
    const input = parseOrThrow(taskCreateSchema, formDataToObject(formData));
    if (input.assigneeId && input.assigneeId !== user.id) {
      await requirePermission('task.assign');
    }
    const task = await createTask(user, input);
    refresh(task.id);
    return { ok: true as const, message: `Tarea #${task.seq} creada.`, id: task.id };
  });
}

export async function updateTaskAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('task.edit');
    const input = parseOrThrow(taskUpdateSchema, formDataToObject(formData));
    const task = await updateTask(user, input);
    refresh(task.id);
    return { ok: true as const, message: 'Tarea actualizada.', id: task.id };
  });
}

export async function assignTaskAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('task.assign');
    const input = parseOrThrow(taskAssignSchema, formDataToObject(formData));
    const task = await assignTask(user, input);
    refresh(task.id);
    return { ok: true as const, message: 'Responsable actualizado.', id: task.id };
  });
}

export async function changeTaskStatusAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseOrThrow(taskStatusSchema, formDataToObject(formData));
    /*
      El responsable de una tarea puede moverla aunque no tenga `task.edit`.
      Es lo que hace útil al rol de Gerencia: sólo consulta, salvo sobre lo
      que se le asignó. El permiso se comprueba primero, así que quien lo
      tiene no paga la consulta extra.
    */
    const user = await requirePermissionOrOwner('task.edit', async () => {
      const task = await prisma.task.findUnique({
        where: { id: input.id },
        select: { assigneeId: true, createdById: true },
      });
      return [task?.assigneeId, task?.createdById];
    });
    const task = await changeTaskStatus(user, input);
    refresh(task.id);
    return { ok: true as const, message: 'Estado de la tarea actualizado.', id: task.id };
  });
}

const checklistSchema = z.object({
  itemId: z.string().min(1),
  done: z.union([z.literal('true'), z.literal('false')]).transform((v) => v === 'true'),
});

export async function toggleChecklistAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseOrThrow(checklistSchema, formDataToObject(formData));
    // Igual que el estado: el responsable marca los puntos de su tarea.
    const user = await requirePermissionOrOwner('task.edit', async () => {
      const item = await prisma.taskChecklistItem.findUnique({
        where: { id: input.itemId },
        select: { task: { select: { assigneeId: true, createdById: true } } },
      });
      return [item?.task.assigneeId, item?.task.createdById];
    });
    await toggleChecklistItem(user, input);
    refresh();
    return { ok: true as const, message: 'Checklist actualizado.' };
  });
}

export async function deleteTaskAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.delete');
    const input = parseOrThrow(softDeleteSchema, formDataToObject(formData));
    await softDeleteTask(user, input);
    refresh(input.id);
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Tarea eliminada. Queda recuperable.' };
  });
}

export async function restoreTaskAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.restore');
    const input = parseOrThrow(restoreSchema, formDataToObject(formData));
    await restoreTask(user, input);
    refresh(input.id);
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Tarea restaurada.' };
  });
}
