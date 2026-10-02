import { z } from 'zod';

/** Only the authenticated request can supply this envelope, never a model tool. */
export const frontiStepSchema = z.object({
  action: z.string().min(1).max(100),
  fields: z.record(z.union([z.string().max(6000), z.array(z.string().max(1000)).max(100)])).refine(v => Object.keys(v).length <= 100, 'Demasiados campos.'),
}).strict();
export const frontiPlanSchema = z.object({
  requestKey: z.string().uuid(),
  instruction: z.string().trim().min(3).max(6000),
  steps: z.array(frontiStepSchema).min(1).max(12),
}).strict();
export type FrontiStep = z.infer<typeof frontiStepSchema>;
export type FrontiPlan = z.infer<typeof frontiPlanSchema>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  return JSON.stringify(value);
}

export function instructionMode(text: string): 'execute' | 'prepare' | 'cancel' | 'query' {
  const s = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (/^(cancela|deten|no lo hagas|olvida)\b/.test(s)) return 'cancel';
  if (/[?¿]/.test(s) || /\b(simula|simulacion|ejemplo|hipotetic|explica|que pasaria|como puedo|podrias|propuesta|prepara|borrador|no ejecutes|no registres)\b/.test(s)) return 'prepare';
  return /^(crea|registra|anota|asigna|reasigna|recibe|confirma|inicia|resuelve|cierra|guarda|actualiza|publica|devuelve|entrega|ejecuta)\b/.test(s) ? 'execute' : 'query';
}

/** Explicit exact command: no model can add steps, identities or approvals. */
export function parseExactFrontiCommand(message: string): FrontiStep[] | null {
  if (!message.startsWith('/ejecutar ')) return null;
  return z.array(frontiStepSchema).min(1).max(12).parse(JSON.parse(message.slice(10)));
}

export function executionSummary(steps: Array<{ action: string; status: string; result: unknown }>): string {
  return steps.map((s, i) => `${i + 1}. ${s.action}: ${s.status}${s.result && typeof s.result === 'object' && 'message' in s.result ? ' · ' + String(s.result.message) : ''}`).join('\n');
}

export function executionStatus(row: {cancelledAt:Date|null; authorizedAt:Date|null; steps:Array<{status:string}>}) {
  if (row.cancelledAt) return 'CANCELLED';
  if (row.steps.every(s=>s.status==='SUCCEEDED')) return 'SUCCEEDED';
  if (row.steps.some(s=>['INTERVENTION','CHANGED'].includes(s.status))) return 'INTERVENTION';
  if (row.steps.some(s=>s.status==='RUNNING')) return 'RUNNING';
  if (row.steps.some(s=>s.status==='SUCCEEDED')) return 'PARTIAL';
  return row.authorizedAt ? 'AUTHORIZED' : 'PREPARED';
}
