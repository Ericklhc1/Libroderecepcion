import { dateDays, datePlus, scheduleAssignmentStarted, templateWindow, validDate } from '@/domain/schedule';
import { hotelDateKey } from '@/domain/time';

type SchedulePeriod = { startDate: string; endDate: string };
type ScheduleContext = { area?: string | null; malla?: string | null; seccion?: string | null };
export type ScheduleView = 'semana' | 'ciclo' | 'mes';

/** The URL is the source of truth; changing areas must choose that area's own plan. */
export function scheduleHref(context: ScheduleContext): string {
  const params = new URLSearchParams();
  for (const key of ['area', 'malla', 'seccion'] as const) if (context[key]) params.set(key, context[key]);
  return `/equipo${params.size ? `?${params}` : ''}`;
}

/** Keep Equipo context only inside Equipo. Never carry permissions or unrelated filters. */
export function preserveScheduleContextHref(href: string, pathname: string, search: string): string {
  if (pathname !== '/equipo' || !/^\/equipo(?:[?#]|$)/.test(href)) return href;
  const target = new URL(href, 'https://navigation.invalid');
  const current = new URLSearchParams(search);
  const area = target.searchParams.get('area') ?? current.get('area');
  if (area) target.searchParams.set('area', area);
  if (!target.searchParams.has('malla') && area === current.get('area')) {
    const plan = current.get('malla');
    if (plan) target.searchParams.set('malla', plan);
  }
  return target.pathname + target.search + target.hash;
}

export function scheduleInitialCursor(plan: SchedulePeriod, today: string): string {
  return today < plan.startDate ? plan.startDate : today > plan.endDate ? plan.endDate : today;
}

export function scheduleCalendarDays(view: ScheduleView, cursor: string): string[] {
  if (view === 'mes') {
    const date = new Date(`${cursor}T00:00:00Z`);
    return dateDays(`${cursor.slice(0, 7)}-01`, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10));
  }
  const weekday = new Date(`${cursor}T00:00:00Z`).getUTCDay();
  const start = view === 'semana' ? datePlus(cursor, -(weekday === 0 ? 6 : weekday - 1)) : cursor;
  return dateDays(start, datePlus(start, view === 'semana' ? 6 : 7));
}

export function scheduleMinimumDate(plan: SchedulePeriod, today: string): string {
  return today > plan.startDate ? today : plan.startDate;
}

export function scheduleDateIssue(plan: SchedulePeriod, date: string, today: string): string | null {
  if (!validDate(date)) return 'Selecciona una fecha válida.';
  if (date < plan.startDate || date > plan.endDate) return 'La fecha debe estar dentro del periodo de esta malla.';
  if (date < today) return 'No se puede programar en una fecha pasada.';
  return null;
}

type DestinationSlot = { kind: string; startTime: string | null; endTime: string | null; crossesMidnight: boolean };
export function scheduleDestinationIssue({ plan, date, person, now, slot }: {
  plan: SchedulePeriod;
  date: string;
  person?: { eligible?: boolean } | null;
  now: string;
  slot?: DestinationSlot;
}): string | null {
  if (!person || person.eligible === false) return 'Selecciona un colaborador habilitado en esta área.';
  const instant = new Date(now);
  const dateIssue = scheduleDateIssue(plan, date, hotelDateKey(instant));
  if (dateIssue) return dateIssue;
  if (slot?.kind === 'TURNO') {
    if (!slot.startTime || !slot.endTime) return 'La asignación no tiene un horario válido.';
    try {
      const window = templateWindow(date, { startTime: slot.startTime, endTime: slot.endTime, crossesMidnight: slot.crossesMidnight, breakMinutes: 0, breakPaid: false });
      if (scheduleAssignmentStarted({ date: new Date(`${date}T00:00:00Z`), startAt: window.startAt }, instant)) return 'La hora de inicio ya pasó. Elige otra fecha o un horario futuro.';
    } catch (error) {
      return error instanceof Error ? error.message : 'El horario no es válido para esa fecha.';
    }
  }
  return null;
}
