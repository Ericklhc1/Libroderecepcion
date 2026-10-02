import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { executionSummary, parseExactFrontiCommand, type FrontiStep } from '@/domain/fronti-execution';
import { prepareExecution, executePlan, readExecution, cancelExecution } from './service';
import { automationSummary } from '@/server/services/operational-automation';
import { formatDateTime } from '@/lib/format';
import { executionActor } from './service';
import { FRONTI_ACTIONS } from './catalog';

/** Deterministic commands use only this authenticated user's current message. */
export async function executeFrontiCommand(message: string, requestKey?: string) {
  if (message.trim().toLowerCase() === '/resumen') {
    const user=await executionActor(); const summary=await automationSummary(user,user.departmentId ?? undefined);
    return {reply:`Resumen al ${formatDateTime(summary.generatedAt)}. Alcance: ${summary.scope}. ${summary.complete?'Lectura completa dentro de este acceso.':'Lectura parcial: se alcanzó el límite de consulta.'}\n${summary.denominator} asuntos: ${summary.metrics.unassigned} sin responsable, ${summary.metrics.unreceived} asignados sin recibir, ${summary.metrics.overdue} vencidos, ${summary.metrics.blocked} bloqueados.\n${summary.sources.map(r=>`• ${r.title}: ${r.owner}. ${r.nextAction}${r.dueAt?' · Plazo '+formatDateTime(r.dueAt):''} · ${r.href}`).join('\n')}\nSe muestran ${summary.sources.length} fuentes de ${summary.denominator}. ${summary.note}\nTus procedimientos Fronti: /fronti/procedimientos · Coordinación: /coordinacion`,confirmations:[]};
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
