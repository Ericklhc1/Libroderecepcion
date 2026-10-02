import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { DELEGATION_STOPS, executionSummary, parseExactFrontiCommand, type FrontiStep } from '@/domain/fronti-execution';
import { createDynamicDelegation, executeDelegatedPlan, prepareExecution, createDelegation, executePlan, readExecution, cancelExecution } from './service';
import { RuleError } from '@/server/errors';
import { automationSummary } from '@/server/services/operational-automation';
import { formatDateTime } from '@/lib/format';
import { executionActor } from './service';
import { FRONTI_ACTIONS } from './catalog';

/** Deterministic commands use only this authenticated user's current message. */
export async function executeFrontiCommand(message: string, requestKey?: string) {
  if(message.startsWith('/delegar-dinamica ')){
    const input:unknown=JSON.parse(message.slice('/delegar-dinamica '.length));
    if(!input||typeof input!=='object'||Array.isArray(input)||'requestKey' in input||'instruction' in input)throw new RuleError('La autorización debe provenir de tu mensaje actual.');
    const row=await createDynamicDelegation({...input,requestKey:requestKey??randomUUID(),instruction:message});
    return {reply:`Delegación dinámica registrada, sin ejecutar acciones. Consulta sus campos, ámbito, presupuesto y vigencia en /fronti/procedimientos?ejecucion=${row.id}. Para usarla: /usar-delegacion-dinamica seguido de {"id":"${row.id}","steps":[...]}. Para revocar: /revocar-delegacion ${row.id}.`,confirmations:[]};
  }
  if(message.startsWith('/usar-delegacion-dinamica ')){
    const {z}=await import('zod');const {frontiStepSchema}=await import('@/domain/fronti-execution');
    const input=z.object({id:z.string().min(1).max(100),steps:z.array(frontiStepSchema).min(1).max(12)}).strict().parse(JSON.parse(message.slice('/usar-delegacion-dinamica '.length)));
    const result=await executeDelegatedPlan(input.id,{requestKey:requestKey??randomUUID(),instruction:message,steps:input.steps});
    return {reply:executionSummary(result.steps)+'\n'+result.href,confirmations:[]};
  }
  if (message.startsWith('/delegar ')) {
    const input: unknown = JSON.parse(message.slice(9));
    if (!input || typeof input !== 'object' || Array.isArray(input) || 'requestKey' in input || 'instruction' in input) throw new RuleError('Indica objetivo, vigencia y pasos exactos; la referencia de autorización proviene de tu mensaje.');
    const plan = await createDelegation({ ...input, requestKey: requestKey ?? randomUUID(), instruction: message });
    const result = await readExecution(plan.id);
    return { reply: `Delegación registrada. ${result.steps.length} acciones exactas, cada una como máximo una vez. Vigencia: ${formatDateTime(result.availableAt!)} a ${formatDateTime(result.expiresAt)}. Crear la delegación no ejecuta acciones ni programa un cron.\n${DELEGATION_STOPS.join('\n')}\nEjecutar: /usar-delegacion ${plan.id}\nRevocar: /revocar-delegacion ${plan.id}\n${executionSummary(result.steps)}\n${result.href}`, confirmations: [] };
  }
  const delegation = /^\/(usar|revocar)-delegacion ([a-z0-9]+)$/.exec(message);
  if (delegation) {
    const current = await readExecution(delegation[2]!);
    if (!['DELEGATION','DYNAMIC'].includes(current.authorizationKind)) throw new RuleError('La referencia no corresponde a una delegación.');
    if (delegation[1] === 'revocar') return { reply: (current.cancelledAt ? 'Delegación ya revocada. El historial y los efectos realizados se conservan.' : (await cancelExecution(current.id)).message) + '\n' + current.href, confirmations: [] };
    const result = await executePlan(current.id, false);
    return { reply: executionSummary(result.steps) + '\n' + result.href, confirmations: [] };
  }
  if (message.trim().toLowerCase() === '/delegaciones') return { reply: 'Consulta tus delegaciones, vigencia, límites y resultados en /fronti/procedimientos?delegaciones=1. Sólo tú puedes utilizarlas; cada paso se ejecuta como máximo una vez.', confirmations: [] };
  if (message.trim().toLowerCase() === '/resumen') {
    const user=await executionActor(); const summary=await automationSummary(user,user.departmentId ?? undefined);
    return {reply:`Resumen al ${formatDateTime(summary.generatedAt)}. Alcance: ${summary.scope}. ${summary.complete?'Lectura completa dentro de este acceso.':'Lectura parcial: se alcanzó el límite de consulta.'}\n${summary.denominator} asuntos: ${summary.metrics.unassigned} sin responsable, ${summary.metrics.unreceived} asignados sin recibir, ${summary.metrics.overdue} vencidos, ${summary.metrics.blocked} bloqueados.\n${summary.sources.map(r=>`• ${r.title}: ${r.owner}. ${r.nextAction}${r.dueAt?' · Plazo '+formatDateTime(r.dueAt):''} · ${r.href}`).join('\n')}\nSe muestran ${summary.sources.length} fuentes de ${summary.denominator}. ${summary.note}\nIndicadores y cambios de turno: /coordinacion/indicadores · Tus procedimientos Fronti: /fronti/procedimientos · Coordinación: /coordinacion`,confirmations:[]};
  }
  if (message.trim().toLowerCase() === '/procedimientos') return { reply: FRONTI_ACTIONS.map(a => `${a.label}: ${a.name}`).join('\n') + '\nCobertura y controles: /fronti/procedimientos', confirmations: [] };
  const cancel = /^\/cancelar ([a-z0-9]+)$/.exec(message);
  if (cancel) return { reply: (await cancelExecution(cancel[1]!)).message, confirmations: [] };
  const status = /^\/estado ([a-z0-9]+)$/.exec(message);
  if (status) { const result = await readExecution(status[1]!); return { reply: executionSummary(result.steps) + '\n' + result.href, confirmations: [] }; }
  let steps = parseExactFrontiCommand(message);
  // Deliberately exact syntax. Other natural language is resolved by the existing tool loop.
  const simple = /^(?:crea|registra|anota) una (novedad|tarea):\s*(.{3,200})$/i.exec(message);
  if (!steps && simple && !/[?¿\n]/.test(message)) {
    const title = simple[2]!.trim();
    steps = [simple[1]!.toLowerCase() === 'tarea'
      ? { action: 'createTaskAction', fields: { title, description: title, priority: 'MEDIA' } }
      : { action: 'createEntryAction', fields: { type: 'NOVEDAD', title, description: title, priority: 'MEDIA' } }];
  }
  if (!steps) return null;
  const plan = await prepareExecution({ requestKey: requestKey ?? randomUUID(), instruction: message, steps });
  const result = await executePlan(plan.id, true);
  return { reply: executionSummary(result.steps) + '\n' + result.href, confirmations: [] };
}

export function commandReference(message: string) { return createHash('sha256').update(message).digest('hex'); }
export type { FrontiStep };
