'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/guard';
import { runAction, formDataToObject, type ActionState } from '@/server/action';
import { mutationSchema, scheduleId } from '@/domain/schedule';
import { createSchedulePlan, addScheduleSlot, moveScheduleSlot, cancelScheduleSlot, publishSchedulePlan, changeScheduleExtra, acknowledgeSchedule } from '@/server/services/schedules';
import { saveScheduleCollaborator, saveScheduleTemplate, saveScheduleCoverage, saveScheduleGrant, saveScheduleHoliday } from '@/server/services/schedule-catalog';
import { reviewScheduleImport, applyScheduleImport } from '@/server/services/schedule-import';
import { RuleError } from '@/server/errors';

type Command = 'plan' | 'slot' | 'move' | 'cancel' | 'publish' | 'extra' | 'ack' | 'collaborator' | 'template' | 'coverage' | 'grant' | 'holiday' | 'review' | 'import';
async function execute(command: Command, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser(); const values = formDataToObject(formData); let id: string | undefined;
    const mutation = () => mutationSchema.parse(values);
    const flag = (name: string) => formData.get(name) === 'on' || formData.get(name) === 'true';
    if (command === 'plan') id = (await createSchedulePlan(user, values)).id;
    if (command === 'slot') id = (await addScheduleSlot(user, mutation(), values, typeof values.replaceSlotId === 'string' && values.replaceSlotId ? values.replaceSlotId : undefined)).id;
    if (command === 'move') id = (await moveScheduleSlot(user, mutation(), values)).id;
    if (command === 'cancel') id = (await cancelScheduleSlot(user, mutation(), scheduleId.parse(values.slotId))).id;
    if (command === 'publish') id = (await publishSchedulePlan(user, mutation())).id;
    if (command === 'extra') id = (await changeScheduleExtra(user, mutation(), values)).id;
    if (command === 'ack') await acknowledgeSchedule(user, scheduleId.parse(values.planId), z.coerce.number().int().positive().parse(values.version));
    if (command === 'collaborator') id = (await saveScheduleCollaborator(user, { ...values, departmentIds: formData.getAll('departmentIds').map(String), active: flag('active') } as Parameters<typeof saveScheduleCollaborator>[1])).id;
    if (command === 'template') id = (await saveScheduleTemplate(user, { ...values, crossesMidnight: flag('crossesMidnight'), breakPaid: flag('breakPaid') } as Parameters<typeof saveScheduleTemplate>[1])).id;
    if (command === 'coverage') id = (await saveScheduleCoverage(user, { ...values, weekdays: formData.getAll('weekdays').map(Number), crossesMidnight: flag('crossesMidnight'), active: flag('active') } as Parameters<typeof saveScheduleCoverage>[1])).id;
    if (command === 'grant') await saveScheduleGrant(user, scheduleId.parse(values.userId), scheduleId.parse(values.departmentId), flag('enabled'));
    if (command === 'holiday') id = (await saveScheduleHoliday(user, { ...values, active: flag('active') })).id;
    if (command === 'review') {
      const file = formData.get('file'); if (!(file instanceof File) || file.size === 0) throw new RuleError('Selecciona un archivo de malla.');
      if (file.size > 3 * 1024 * 1024) throw new RuleError('La carga admite archivos de hasta 3 MB.');
      id = (await reviewScheduleImport(user, scheduleId.parse(values.planId), file.name, new Uint8Array(await file.arrayBuffer()))).id;
    }
    if (command === 'import') id = (await applyScheduleImport(user, mutation(), scheduleId.parse(values.importId))).id;
    revalidatePath('/equipo');
    if (command === 'grant') revalidatePath('/', 'layout');
    return { ok: true as const, message: command === 'review' ? 'Archivo leído. Revisa las coincidencias antes de incorporarlo.' : command === 'ack' ? 'Recepción del horario confirmada.' : 'Cambio guardado con su historial.', id };
  });
}
export async function createSchedulePlanAction(_state: ActionState | null, data: FormData) { return execute('plan', data); }
export async function addScheduleSlotAction(_state: ActionState | null, data: FormData) { return execute('slot', data); }
export async function moveScheduleSlotAction(_state: ActionState | null, data: FormData) { return execute('move', data); }
export async function cancelScheduleSlotAction(_state: ActionState | null, data: FormData) { return execute('cancel', data); }
export async function publishSchedulePlanAction(_state: ActionState | null, data: FormData) { return execute('publish', data); }
export async function changeScheduleExtraAction(_state: ActionState | null, data: FormData) { return execute('extra', data); }
export async function acknowledgeScheduleAction(_state: ActionState | null, data: FormData) { return execute('ack', data); }
export async function saveScheduleCollaboratorAction(_state: ActionState | null, data: FormData) { return execute('collaborator', data); }
export async function saveScheduleTemplateAction(_state: ActionState | null, data: FormData) { return execute('template', data); }
export async function saveScheduleCoverageAction(_state: ActionState | null, data: FormData) { return execute('coverage', data); }
export async function saveScheduleGrantAction(_state: ActionState | null, data: FormData) { return execute('grant', data); }
export async function saveScheduleHolidayAction(_state: ActionState | null, data: FormData) { return execute('holiday', data); }
export async function reviewScheduleImportAction(_state: ActionState | null, data: FormData) { return execute('review', data); }
export async function applyScheduleImportAction(_state: ActionState | null, data: FormData) { return execute('import', data); }
