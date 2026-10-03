import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { canonicalJson, executionSummary } from '@/domain/fronti-execution';
import { listLostFound } from '@/server/services/lost-found';
import { NotFoundError, RuleError } from '@/server/errors';
import { executionActor, prepareExecution, executePlan } from './service';

type Intent = { action: 'CONSULTAR' | 'MOVER' | 'ENTREGAR' | 'DISPONER' | 'REABRIR'; humanId: number; note?: string; location?: string; evidence?: string };
export function parseNaturalCustody(message: string): Intent | null {
  if (/[\r\n¿?]/.test(message) || message.length > 3300) return null;
  const text = message.trim();
  const query = /^(?:consulta|muestra) (?:el )?(?:resultado del |historial del )?objeto #([1-9]\d*)\.?$/i.exec(text);
  if (query) return { action: 'CONSULTAR', humanId: Number(query[1]) };
  const move = /^mueve (?:el )?objeto #([1-9]\d*) a ([^:]+)(?::\s*(.*))?$/i.exec(text);
  if (move) return { action: 'MOVER', humanId: Number(move[1]), location: move[2]!.trim(), note: move[3]?.trim() };
  const finish = /^registra la (entrega|disposición final|disposicion final) del objeto #([1-9]\d*)(?::\s*(.*?))?(?:;\s*evidencia:\s*(.*))?$/i.exec(text);
  if (finish) return { action: finish[1]!.toLowerCase() === 'entrega' ? 'ENTREGAR' : 'DISPONER', humanId: Number(finish[2]), note: finish[3]?.trim(), evidence: finish[4]?.trim() };
  const reopen = /^reabre (?:la custodia del )?objeto #([1-9]\d*)(?::\s*(.*))?$/i.exec(text);
  return reopen ? { action: 'REABRIR', humanId: Number(reopen[1]), note: reopen[2]?.trim() } : null;
}
export async function executeNaturalCustody(message: string, requestKey?: string) {
  const intent = parseNaturalCustody(message);
  if (!intent) return null;
  if (!Number.isSafeInteger(intent.humanId)) throw new RuleError('Indica un folio válido.');
  const user = await executionActor();
  const reply = (text: string) => ({ reply: text, confirmations: [] });
  if (intent.action !== 'CONSULTAR' && requestKey) {
    const previous = await prisma.frontiExecutionRequest.findUnique({ where: { userId_requestKey: { userId: user.id, requestKey } }, include: { execution: true } });
    if (previous) {
      if (previous.execution.instruction !== createHash('sha256').update(canonicalJson(message)).digest('hex')) throw new RuleError('El reintento contiene una instrucción distinta.');
      const result = await executePlan(previous.executionId, false);
      return reply(executionSummary(result.steps) + '\n' + result.href);
    }
  }
  const item = (await listLostFound(user, { humanId: intent.humanId }))[0];
  if (!item) throw new NotFoundError();
  if (intent.action === 'CONSULTAR') return reply(`Objeto #${item.humanId}: ${item.item}.\nCustodia: ${item.custodyLocation}. Responsable: ${item.custodian?.name ?? 'Sin responsable individual'}.\n${item.finalAction ? 'Resultado: ' + item.finalAction + ' · Evidencia: ' + item.evidenceNote : 'Permanece en custodia.'}\n${item.events.slice(0, 10).map(event => event.actorName + ' · ' + event.action + ': ' + (event.note ?? '')).join('\n')}\nHistorial completo: /custodia?q=${item.humanId}`);
  if (!intent.note) return reply('Indica el motivo o resultado después de dos puntos. No se ha modificado el objeto.');
  if (['ENTREGAR', 'DISPONER'].includes(intent.action) && !intent.evidence) return reply('Falta la evidencia o referencia del cierre. Añade «; evidencia: referencia». No se ha cerrado la custodia.');
  const plan = await prepareExecution({ requestKey: requestKey ?? randomUUID(), instruction: message, steps: [{ action: 'changeLostFoundAction', fields: {
    id: item.id, version: String(item.version), action: intent.action, note: intent.note,
    ...(intent.location ? { custodyLocation: intent.location } : {}), ...(intent.evidence ? { evidenceNote: intent.evidence } : {}),
  } }] });
  const result = await executePlan(plan.id, true);
  return reply(executionSummary(result.steps) + '\n' + result.href);
}
