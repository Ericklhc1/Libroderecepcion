'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Priority, InspectionResult, Severity } from '@prisma/client';
import { requireUser } from '@/server/auth/guard';
import { runAction, type ActionState } from '@/server/action';
import * as center from '@/server/services/supervision-center';
const text = z.string().trim().min(1).max(10000);
const id = z.string().min(1).max(200);
const date = z.coerce.date();
const commands = z.discriminatedUnion('command', [
  z.object({ command: z.literal('iniciar'), priorities: text }),
  z.object({ command: z.literal('entregar'), id, note: text }),
  z.object({ command: z.literal('finalizar'), id }),
  z.object({ command: z.literal('nota'), title: text, body: text, visibility: z.enum(['PRIVADO', 'SUPERVISION']), priority: z.nativeEnum(Priority), nextReviewAt: z.string().optional() }),
  z.object({ command: z.literal('tarea'), title: text, description: text, acceptanceCriteria: text, assigneeId: id, collaboratorIds: z.array(id), priority: z.nativeEnum(Priority), dueAt: date, evidenceRequired: z.boolean() }),
  z.object({ command: z.literal('evidencia'), id, evidence: text }),
  z.object({ command: z.literal('plantilla'), name: text, area: text, points: text }),
  z.object({ command: z.literal('auditoria'), templateId: id, title: text, scope: text, sample: text, reviewedPeople: z.array(id), reviewedShifts: z.array(id) }),
  z.object({ command: z.literal('punto'), id, result: z.nativeEnum(InspectionResult), evidence: z.string(), observation: z.string(), severity: z.nativeEnum(Severity) }),
  z.object({ command: z.literal('cerrar-auditoria'), id, result: text, visibility: z.enum(['PRIVADO', 'SUPERVISION']) }),
  z.object({ command: z.literal('medida'), pointId: id, title: text, instruction: text, criteria: text, assigneeId: id, dueAt: date }),
]);
export async function supervisionAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = commands.parse({ ...Object.fromEntries(form), collaboratorIds: form.getAll('collaboratorIds'), reviewedPeople: form.getAll('reviewedPeople'), reviewedShifts: form.getAll('reviewedShifts'), evidenceRequired: form.get('evidenceRequired') === 'on' });
    switch (input.command) {
      case 'iniciar': await center.startSupervisionShift(user, input.priorities); break;
      case 'entregar': await center.handoverSupervisionShift(user, input.id, input.note); break;
      case 'finalizar': await center.finishSupervisionShift(user, input.id); break;
      case 'nota': await center.createSupervisionNote(user, { title: input.title, body: input.body, visibility: input.visibility, priority: input.priority, nextReviewAt: input.nextReviewAt ? date.parse(input.nextReviewAt) : undefined }); break;
      case 'tarea': { const { command: _command, ...data } = input; await center.createSupervisedTask(user, data); break; }
      case 'evidencia': await center.saveTaskEvidence(user, input.id, input.evidence); break;
      case 'plantilla': await center.createInspectionTemplate(user, { name: input.name, area: input.area, points: input.points.split('\n').map(p => p.trim()).filter(Boolean) }); break;
      case 'auditoria': { const { command: _command, ...data } = input; await center.startInspection(user, data); break; }
      case 'punto': { const { command: _command, id: pointId, ...data } = input; await center.updateInspectionPoint(user, pointId, data); break; }
      case 'cerrar-auditoria': await center.closeInspection(user, input.id, input.result, input.visibility); break;
      case 'medida': { const { command: _command, ...data } = input; await center.createCorrectiveMeasure(user, data); break; }
    }
    revalidatePath('/supervision');
    revalidatePath('/supervision/centro');
    revalidatePath('/tareas');
    if ('id' in input) revalidatePath(`/tareas/${input.id}`);
    return { ok: true as const, message: 'Actuación guardada.' };
  });
}
