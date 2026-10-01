import { z } from 'zod';
import type { PermissionKey } from '@/lib/permissions';
import { addCalendarDateDays, hotelDateKey, hotelParts, hotelWallDateTime } from '@/domain/time';

export const SCHEDULE_PERMISSIONS = ['schedule.self.view', 'schedule.view', 'schedule.view.all', 'schedule.manage', 'schedule.publish', 'schedule.catalog.manage', 'schedule.extra.approve', 'schedule.configure'] as const satisfies readonly PermissionKey[];
export const SLOT_KINDS = ['TURNO', 'LIBRE', 'VACACIONES', 'AUSENCIA'] as const;
export const EXTRA_KINDS = ['NINGUNO', 'EXTENSION', 'TURNO_EXTRA'] as const;
export const SLOT_LABELS = { TURNO: 'Turno', LIBRE: 'Libre', VACACIONES: 'Vacaciones', AUSENCIA: 'Ausencia' };
export const EXTRA_LABELS: Record<string, string> = { NINGUNO: 'Sin extra', EXTENSION: 'Extensión', TURNO_EXTRA: 'Turno adicional', PENDIENTE: 'Pendiente de aprobación', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado', REPORTADO: 'Realización informada', VALIDADO: 'Realización validada', NO_APLICA: 'No aplica' };
export type ScheduleActor = { roleKey: string; permissions: readonly PermissionKey[] };
export function scheduleAllowed(user: ScheduleActor, permission?: PermissionKey): boolean {
  return user.roleKey === 'ADMINISTRADOR_SISTEMA' || (permission ? user.permissions.includes(permission) : SCHEDULE_PERMISSIONS.some((p) => user.permissions.includes(p)));
}
export function scheduleTeamAccess(user: ScheduleActor): boolean {
  return scheduleAllowed(user, 'schedule.view') || ['schedule.view.all', 'schedule.manage', 'schedule.publish', 'schedule.catalog.manage', 'schedule.extra.approve', 'schedule.configure'].some((p) => user.permissions.includes(p as PermissionKey));
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value && value >= '2020-01-01' && value <= '2100-12-31';
}
export const scheduleDate = z.string().refine(validDate, 'Indica una fecha calendario válida.');
export const scheduleTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Usa un horario HH:MM válido.');
export const scheduleId = z.string().min(1).max(100);
export const weeklyHoursSchema = z.preprocess((value) => typeof value === 'string' ? value.trim().replace(',', '.') : value,
  z.coerce.number().finite().min(0).max(168).refine((hours) => Math.abs(hours * 60 - Math.round(hours * 60)) < 0.000001, 'Usa horas enteras o fracciones como 42,5.'));
export function weeklyHoursToMinutes(hours: number): number { return Math.round(weeklyHoursSchema.parse(hours) * 60); }
export function formatScheduleHours(minutes: number): string { return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(minutes / 60)} h`; }

export const mutationSchema = z.object({ planId: scheduleId, version: z.coerce.number().int().positive(), requestKey: z.string().uuid(), reason: z.string().trim().max(1000).optional().default('') });
export const slotSchema = z.object({ collaboratorId: scheduleId, date: scheduleDate, kind: z.enum(SLOT_KINDS), templateId: z.string().max(100).optional(), extraKind: z.enum(EXTRA_KINDS).default('NINGUNO'), extraMinutes: z.coerce.number().int().min(0).max(720).default(0), note: z.string().trim().max(1000).optional().default('') }).superRefine((s, ctx) => {
  if (s.kind === 'TURNO' && !s.templateId) ctx.addIssue({ code: 'custom', message: 'Selecciona una plantilla del área.', path: ['templateId'] });
  if (s.kind !== 'TURNO' && (s.extraKind !== 'NINGUNO' || s.extraMinutes)) ctx.addIssue({ code: 'custom', message: 'Un descanso o ausencia no puede tener extras.' });
  if ((s.extraKind === 'EXTENSION') !== (s.extraMinutes > 0)) ctx.addIssue({ code: 'custom', message: 'Indica minutos adicionales sólo para una extensión.' });
});
export type SlotInput = z.infer<typeof slotSchema>;
export const templateSchema = z.object({ departmentId: scheduleId, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,16}$/), label: z.string().trim().min(1).max(100), startTime: scheduleTime, endTime: scheduleTime, crossesMidnight: z.boolean(), breakStartTime: z.literal('').optional().default(''), breakMinutes: z.literal(0).optional().default(0), breakPaid: z.literal(false).optional().default(false) }).superRefine((s, ctx) => {
  if ((!s.crossesMidnight && s.endTime <= s.startTime) || (s.crossesMidnight && s.endTime > s.startTime)) ctx.addIssue({ code: 'custom', message: 'Revisa el horario y el cruce de medianoche.' });
});
export type TemplateClock = { startTime: string; endTime: string; crossesMidnight: boolean; breakStartTime?: string | null; breakMinutes: number; breakPaid: boolean };
export function datePlus(key: string, days: number): string { return addCalendarDateDays(new Date(`${key}T00:00:00Z`), days).toISOString().slice(0, 10); }
export function dateDays(start: string, end: string): string[] {
  if (!validDate(start) || !validDate(end) || end < start || (Date.parse(end) - Date.parse(start)) / 86400000 > 62) throw new Error('El periodo debe tener entre 1 y 63 días.');
  const days: string[] = []; for (let day = start; day <= end; day = datePlus(day, 1)) days.push(day); return days;
}
function wall(key: string, time: string, strict = true): Date {
  if (!validDate(key) || !scheduleTime.safeParse(time).success) throw new Error('Fecha u hora inválida.');
  const value = hotelWallDateTime(key, Number(time.slice(0, 2)), Number(time.slice(3)));
  const p = hotelParts(value);
  if (`${p.year}-${p.month}-${p.day}` !== key || `${p.hour}:${p.minute}` !== time) {
    if (strict) throw new Error('Ese horario no existe por el cambio de hora de Chile. Revisa la plantilla para esa fecha.');
    // A skipped boundary begins at the first real civil minute after the gap.
    // The wall-time solver can otherwise return 23:00 of the previous date.
    const target = `${key}T${time}`;
    for (let offset = -120; offset <= 120; offset++) {
      const candidate = new Date(value.getTime() + offset * 60000); const c = hotelParts(candidate);
      if (`${c.year}-${c.month}-${c.day}T${c.hour}:${c.minute}` >= target) return candidate;
    }
    throw new Error('No se pudo resolver el límite de cobertura para esa fecha.');
  }
  return value;
}
export function dayWindow(date: string) { return { startAt: wall(date, '00:00', false), endAt: wall(datePlus(date, 1), '00:00', false) }; }
export function templateWindow(date: string, t: TemplateClock) {
  const startAt = wall(date, t.startTime); const endAt = wall(t.crossesMidnight ? datePlus(date, 1) : date, t.endTime);
  if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 25 * 3600000) throw new Error('La plantilla debe terminar después de comenzar y durar como máximo un día.');
  // Retain compatibility with historical snapshots, without applying breaks.
  return { startAt, endAt, breakStartAt: null as Date | null, breakEndAt: null as Date | null };
}
export type IntervalSlot = { collaboratorId: string; functionName: string; kind: string; startAt: Date | null; endAt: Date | null; baseEndAt?: Date | null; breakStartAt: Date | null; breakEndAt: Date | null; breakPaid: boolean; cancelledAt?: Date | null; extraStatus?: string; extraKind?: string };
export function coverageSlots<T extends IntervalSlot>(slots: T[]): T[] {
  const approved = (s: T) => ['APROBADO', 'REPORTADO', 'VALIDADO'].includes(s.extraStatus ?? '');
  return slots.filter((s) => !s.cancelledAt && (s.extraKind !== 'TURNO_EXTRA' || approved(s))).map((s) => s.extraKind === 'EXTENSION' && !approved(s) ? { ...s, endAt: s.baseEndAt ?? s.endAt } : s);
}
export function scheduledAt(s: IntervalSlot, now: Date): boolean {
  return s.kind === 'TURNO' && !!s.startAt && !!s.endAt && s.startAt <= now && s.endAt > now;
}
function overlap(a: number, b: number, c: number, d: number): number { return Math.max(0, Math.min(b, d) - Math.max(a, c)); }
export function plannedMinutes(s: IntervalSlot, from?: Date, to?: Date): number {
  if (s.cancelledAt || s.kind !== 'TURNO' || !s.startAt || !s.endAt) return 0;
  const a = from?.getTime() ?? s.startAt.getTime(); const b = to?.getTime() ?? s.endAt.getTime();
  const elapsed = overlap(a, b, s.startAt.getTime(), s.endAt.getTime());
  return Math.round(elapsed / 60000);
}
export function functionKey(value: string) { return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es'); }
export type CoverageRule = { name: string; functionName: string | null; weekdays: number[]; startTime: string; endTime: string; crossesMidnight: boolean; minimum: number };
export type CoverageGap = { date: string; name: string; startAt: string; endAt: string; required: number; scheduled: number };
export function coverageGaps(days: string[], rules: CoverageRule[], slots: IntervalSlot[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const date of days) for (const rule of rules) {
    if (!rule.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    // A coverage boundary spans civil time, including a skipped DST midnight.
    // Assigned shifts continue to require real, explicitly valid wall times.
    const w = { startAt: wall(date, rule.startTime, false), endAt: wall(rule.crossesMidnight ? datePlus(date, 1) : date, rule.endTime, false) };
    const candidates = slots.filter((s) => !s.cancelledAt && s.kind === 'TURNO' && s.startAt && s.endAt && s.startAt < w.endAt && s.endAt > w.startAt && (!rule.functionName || functionKey(s.functionName) === functionKey(rule.functionName)));
    const points = [...new Set([w.startAt.getTime(), w.endAt.getTime(), ...candidates.flatMap((s) => [s.startAt!, s.endAt!].filter((d): d is Date => !!d).map((d) => d.getTime()).filter((n) => n > w.startAt.getTime() && n < w.endAt.getTime()))])].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!; const b = points[i + 1]!;
      const available = new Set(candidates.filter((s) => s.startAt!.getTime() <= a && s.endAt!.getTime() >= b).map((s) => s.collaboratorId)).size;
      if (available >= rule.minimum) continue;
      const previous = gaps[gaps.length - 1];
      if (previous?.date === date && previous.name === rule.name && previous.scheduled === available && previous.endAt === new Date(a).toISOString()) previous.endAt = new Date(b).toISOString();
      else gaps.push({ date, name: rule.name, startAt: new Date(a).toISOString(), endAt: new Date(b).toISOString(), required: rule.minimum, scheduled: available });
    }
  }
  return gaps;
}
export function holidayDates(s: IntervalSlot, holidays: { date: string; name: string }[]): { date: string; name: string }[] {
  if (!s.startAt || !s.endAt || s.cancelledAt) return [];
  return holidays.filter((h) => { const w = dayWindow(h.date); return s.startAt! < w.endAt && s.endAt! > w.startAt; });
}
export function weeklyTotals(slots: IntervalSlot[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const s of slots) {
    if (!s.startAt || !s.endAt || s.cancelledAt || s.kind !== 'TURNO') continue;
    for (const date of dateDays(hotelDateKey(s.startAt), hotelDateKey(new Date(s.endAt.getTime() - 1)))) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); const monday = datePlus(date, -(weekday === 0 ? 6 : weekday - 1)); const w = dayWindow(date);
      const key = `${s.collaboratorId}:${monday}`; totals[key] = (totals[key] ?? 0) + plannedMinutes(s, w.startAt, w.endAt);
    }
  }
  return totals;
}
