'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/server/auth/guard';
import { runAction, type ActionState } from '@/server/action';
import { saveAutomation, simulateAutomation, revokeAutomation } from '@/server/services/operational-automation';
import { formatDateTime } from '@/lib/format';
import { parseHotelDateInput } from '@/domain/time';
import { substitutionAvailabilityReason } from '@/domain/substitution-availability';
import { prisma } from '@/lib/prisma';

const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
export async function saveAutomationAction(_: ActionState|null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const kind = value(form, 'kind');
    const common = { id:value(form,'id')||undefined, version:value(form,'version')?Number(value(form,'version')):undefined, name: value(form,'name'), departmentId: value(form,'departmentId'), kind, expiresAt: parseHotelDateInput(value(form,'expiresAt') + 'T23:59:59.999'), enabled: false };
    const configuration = kind === 'PROCEDURE' ? {
      title: common.name, description: value(form,'description'), ownerId: value(form,'ownerId'), priority: value(form,'priority'), nextAction: value(form,'nextAction'), evidenceRequired: value(form,'evidenceRequired'), checklist: value(form,'checklist').split('\n').map(v=>v.trim()).filter(Boolean), startDate: value(form,'startDate'), localTime: value(form,'localTime'), weekdays: form.getAll('weekdays').map(Number), deadlineMinutes: Number(value(form,'deadlineHours'))*60, catchUpDays: Number(value(form,'catchUpDays')||0), maxOccurrences: 1,
    } : kind==='SUBSTITUTION' ? {trigger:value(form,'trigger'),kind:value(form,'workKind'),priority:value(form,'priority')||null,receiptMinutes:Number(value(form,'receiptMinutes')),maxItems:25,mode:value(form,'mode'),candidateIds:value(form,'candidateIds').split(',').map(id=>id.trim()).filter(Boolean),requirePublishedSchedule:z.enum(['true','false']).parse(value(form,'requirePublishedSchedule'))==='true',waitForPublishedSchedule:z.enum(['true','false']).parse(value(form,'waitForPublishedSchedule')||'false')==='true',nextAction:value(form,'nextAction')} : { trigger: value(form,'trigger'), kind: value(form,'workKind')||null, priority: value(form,'priority') || null, receiptMinutes: Number(value(form,'receiptMinutes')), recipientId: value(form,'recipientId'), maxItems: 25 };
    const row = await saveAutomation(user, { ...common, configuration });
    revalidatePath('/coordinacion/automatizaciones');
    return { ok: true, message: 'Guardado en pausa. Simula el resultado antes de habilitarlo.', id: row.id };
  });
}
export async function simulateAutomationAction(_: ActionState|null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const result = await simulateAutomation(await requirePermission('system.configure'), value(form,'id'));
    // Iterating the original union preserves each effect's typed evidence; array
    // method inference can collapse substitution effects into the shared base shape.
    const lines:string[]=[];
    for(const effect of result.effects){
      if(lines.length===10)break;
      if('occurrence' in effect){
        lines.push(`Crear tarea: ${effect.occurrence}, responsable ${effect.responsible}, plazo ${formatDateTime(effect.dueAt)}. ${effect.eligible?'Elegible.':'Sin responsable elegible.'}`);
        continue;
      }
      if('availability' in effect&&effect.availability&&!effect.eligible){
        const preview=effect.availability, slot=preview.selection;
        lines.push(`${effect.title}: ${slot?`Pendiente; próxima franja publicada de ${preview.responsible}, ${formatDateTime(slot.startAt)} a ${formatDateTime(slot.effectiveEndAt)}, con autorización para asignar hasta ${formatDateTime(slot.eligibleUntil)}. Requiere revalidación; no asignado.`:substitutionAvailabilityReason(preview.reasonCode)} ${preview.policyState==='PAUSED'?'Política en pausa: sólo simulación. ':''}Leído ${formatDateTime(preview.generatedAt)}; consulta acotada hasta ${formatDateTime(preview.searchUntil)}. Siguiente acción: ${effect.nextAction}. ${effect.href}`);
        continue;
      }
      lines.push(`${effect.action==='PROPOSE'?'Proponer suplencia para':effect.action==='APPLY'?'Reasignar':'Escalar'} ${effect.title} a ${effect.responsible}: ${effect.href}. ${effect.eligible?'Candidato del área; el acceso al origen se verifica al ejecutar.':'Sin destinatario elegible.'}`);
    }
    const countLabel='waitingObserved' in result?'registros observados':'efectos propuestos';
    return { ok: true, message: `Simulación: ${result.effects.length} ${countLabel}. ${result.complete?'Alcance completo.':'Resultado parcial: hay más registros o evidencia pendiente.'} ${result.explanation}\n${lines.join('\n')}${result.effects.length>10?'\nVista previa limitada a 10 registros; no se ha ejecutado ninguno.':''}` };
  });
}
export async function setAutomationStateAction(_: ActionState|null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const id = value(form,'id');
    const state=z.enum(['pause','enable','revoke']).parse(value(form,'state'));
    const version=z.coerce.number().int().positive().parse(value(form,'version'));
    if (state === 'revoke') await revokeAutomation(user,id,version);
    else {
      const row = await prisma.operationalAutomation.findFirstOrThrow({ where: { id, ownerId: user.id } });
      await saveAutomation(user,{ id, version, name: row.name, departmentId: row.departmentId, kind: row.kind, configuration: row.configuration, expiresAt: row.expiresAt, enabled: state === 'enable' });
    }
    revalidatePath('/coordinacion/automatizaciones');
    return { ok: true, message: 'Estado guardado. Se conserva el historial y las tareas existentes.' };
  });
}
