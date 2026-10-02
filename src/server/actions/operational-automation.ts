'use server';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/server/auth/guard';
import { runAction, type ActionState } from '@/server/action';
import { saveAutomation, simulateAutomation, revokeAutomation } from '@/server/services/operational-automation';
import { formatDateTime } from '@/lib/format';
import { parseHotelDateInput } from '@/domain/time';
import { prisma } from '@/lib/prisma';

const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
export async function saveAutomationAction(_: ActionState|null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const kind = value(form, 'kind');
    const common = { id:value(form,'id')||undefined, version:value(form,'version')?Number(value(form,'version')):undefined, name: value(form,'name'), departmentId: value(form,'departmentId'), kind, expiresAt: parseHotelDateInput(value(form,'expiresAt') + 'T23:59'), enabled: false };
    const configuration = kind === 'PROCEDURE' ? {
      title: common.name, description: value(form,'description'), ownerId: value(form,'ownerId'), priority: value(form,'priority'), nextAction: value(form,'nextAction'), evidenceRequired: value(form,'evidenceRequired'), checklist: value(form,'checklist').split('\n').map(v=>v.trim()).filter(Boolean), startDate: value(form,'startDate'), localTime: value(form,'localTime'), weekdays: form.getAll('weekdays').map(Number), deadlineMinutes: Number(value(form,'deadlineHours'))*60, catchUpDays: Number(value(form,'catchUpDays')||0), maxOccurrences: 1,
    } : { trigger: value(form,'trigger'), kind: value(form,'workKind')||null, priority: value(form,'priority') || null, receiptMinutes: Number(value(form,'receiptMinutes')), recipientId: value(form,'recipientId'), maxItems: 25 };
    const row = await saveAutomation(user, { ...common, configuration });
    revalidatePath('/coordinacion/automatizaciones');
    return { ok: true, message: 'Guardado en pausa. Simula el resultado antes de habilitarlo.', id: row.id };
  });
}
export async function simulateAutomationAction(_: ActionState|null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const result = await simulateAutomation(await requirePermission('system.configure'), value(form,'id'));
    return { ok: true, message: `Simulación: ${result.effects.length} efectos propuestos. ${result.complete ? 'Alcance completo.' : 'Resultado parcial: hay más registros.'} ${result.explanation}\n${result.effects.slice(0,10).map(effect => 'occurrence' in effect ? `Crear tarea: ${effect.occurrence}, responsable ${effect.responsible}, plazo ${formatDateTime(effect.dueAt)}. ${effect.eligible?'Elegible.':'Sin responsable elegible.'}` : `Escalar ${effect.title} a ${effect.responsible}: ${effect.href}. ${effect.eligible?'Candidato del área; el acceso al origen se verifica al ejecutar.':'Sin destinatario elegible.'}`).join('\n')}${result.effects.length>10?'\nVista previa limitada a 10 efectos; no se ha ejecutado ninguno.':''}` };
  });
}
export async function setAutomationStateAction(_: ActionState|null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const id = value(form,'id');
    if (value(form,'state') === 'revoke') await revokeAutomation(user,id);
    else {
      const row = await prisma.operationalAutomation.findFirstOrThrow({ where: { id, ownerId: user.id } });
      await saveAutomation(user,{ id, version: Number(value(form,'version')), name: row.name, departmentId: row.departmentId, kind: row.kind, configuration: row.configuration, expiresAt: row.expiresAt, enabled: value(form,'state') === 'enable' });
    }
    revalidatePath('/coordinacion/automatizaciones');
    return { ok: true, message: 'Estado guardado. Se conserva el historial y las tareas existentes.' };
  });
}
