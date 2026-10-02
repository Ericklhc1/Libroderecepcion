import { z } from 'zod';
import { addCalendarDateDays, calendarDateKey, hotelDateKey, hotelWallDateTime } from './time';

export const procedureSchema = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().trim().min(3).max(3000),
  ownerId: z.string().min(1), priority: z.enum(['BAJA','MEDIA','ALTA','CRITICA']),
  nextAction: z.string().trim().min(3).max(1000), evidenceRequired: z.string().trim().min(3).max(1000),
  checklist: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  deadlineMinutes: z.number().int().min(1).max(43200),
  requiresIndependentValidation: z.boolean().default(true),
  catchUpDays: z.number().int().min(0).max(7).default(0),
  maxOccurrences: z.number().int().min(1).max(5).default(1),
}).strict();
export const escalationSchema = z.object({
  trigger: z.enum(['UNASSIGNED','UNRECEIVED','OVERDUE','BLOCKED']),
  kind: z.enum(['entry','task','housekeeping','followup']).nullable().default(null),
  priority: z.enum(['BAJA','MEDIA','ALTA','CRITICA']).nullable().default(null),
  receiptMinutes: z.number().int().min(1).max(43200),
  recipientId: z.string().min(1),
  maxItems: z.number().int().min(1).max(50).default(25),
}).strict();

export const substitutionSchema = escalationSchema.omit({recipientId:true}).extend({
  kind:z.enum(['entry','task','housekeeping']), mode:z.enum(['PROPOSE','APPLY']),
  candidateIds:z.array(z.string().min(1)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'No repitas suplentes.'),
  requirePublishedSchedule:z.boolean(), nextAction:z.string().min(3).max(1000),
}).strict();

/** Each occurrence is a Santiago wall-clock date, never an assumed 24-hour interval. */
export function procedureOccurrences(raw: unknown, now: Date) {
  const config = procedureSchema.parse(raw);
  const today = hotelDateKey(now);
  const dates: Array<{ key: string; at: Date }> = [];
  for (let ago = config.catchUpDays; ago >= 0; ago--) {
    const date = calendarDateKey(addCalendarDateDays(new Date(today + 'T00:00:00Z'), -ago));
    if (date < config.startDate || !config.weekdays.includes(new Date(date + 'T12:00:00Z').getUTCDay())) continue;
    const [hour, minute] = config.localTime.split(':').map(Number);
    const at = hotelWallDateTime(date, hour!, minute!);
    const observed = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    if (observed !== date + ' ' + config.localTime) throw new Error('La hora local no existe en America/Santiago: ' + date + ' ' + config.localTime);
    if (at <= now) dates.push({ key: date + 'T' + config.localTime, at });
  }
  // Recover only the newest bounded occurrences. Never flood the board with old tasks.
  return dates.slice(-config.maxOccurrences);
}

export function matchesAutomation(row: { kind: string; priority?: string; ownerId: string|null; receivedAt: Date|null; assignedAt: Date|null; availableAt: Date|null; dueAt: Date|null; status: string }, raw: unknown, now: Date) {
  const config = escalationSchema.parse(raw);
  if (config.kind && row.kind !== config.kind) return false;
  if (config.priority && row.priority !== config.priority) return false;
  if (row.availableAt && row.availableAt > now) return false;
  if (config.trigger === 'UNASSIGNED') return !row.ownerId;
  if (config.trigger === 'UNRECEIVED') return !!row.ownerId && !row.receivedAt && !!row.assignedAt && now.getTime() - Math.max(row.assignedAt.getTime(), row.availableAt?.getTime() ?? 0) >= config.receiptMinutes * 60000;
  if (config.trigger === 'OVERDUE') return !!row.dueAt && row.dueAt < now;
  return ['BLOQUEADO','BLOQUEADA'].includes(row.status);
}
