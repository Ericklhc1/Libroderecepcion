import { EntryStatus, TaskStatus } from '@prisma/client';
import { addCalendarDateDays, calendarDateKey, hotelCalendarDate, hotelDayStart, hotelWallDateTime } from './time';

/** Successful outcomes. Cancellation is terminal but never successful completion. */
export const TASK_COMPLETED_STATUSES: TaskStatus[] = [TaskStatus.COMPLETADA, TaskStatus.VALIDADA];
export const ENTRY_RESOLVED_STATUSES: EntryStatus[] = [EntryStatus.RESUELTO, EntryStatus.CERRADO];
export type MetricRange = { from: Date; to: Date };
export function normalizeMetricDays(input: number): 7 | 30 | 90 {
  return input === 7 || input === 90 ? input : 30;
}

/** Includes today plus days-1 local calendar days; the current day is partial. */
export function metricPeriod(inputDays = 30, now = new Date()) {
  const days = normalizeMetricDays(inputDays);
  const start = (date: Date, offset: number) => hotelDayStart(hotelWallDateTime(calendarDateKey(addCalendarDateDays(hotelCalendarDate(date), offset)), 12));
  const from = start(now, -(days - 1));
  return {
    days,
    current: { from, to: now },
    previous: {
      from: start(from, -days),
      to: new Date(from.getTime() - 1),
    },
  };
}

/** @db.Date is a calendar key at UTC midnight, never a hotel-time instant. */
export function metricCalendarRange(range: MetricRange) {
  return { gte: hotelCalendarDate(range.from), lte: hotelCalendarDate(range.to) };
}

/** A historical closure is an explicit fallback, never an invented resolution event. */
export function incidentResolutionAt(row: { resolvedAt: Date | null; closedAt: Date | null }) {
  return row.resolvedAt ?? row.closedAt;
}

export const SHARED_METRIC_SCOPE = 'Tareas: universo de operación compartida, excluye las vinculadas a seguimientos privados o reservados. Coordinación usa tus permisos y puede mostrar otro universo.';
export const TASK_COMPLETION_DEFINITION = 'COMPLETADA o VALIDADA, por fecha de ejecución (completedAt). REALIZADA espera validación y no cuenta como terminada. Sin plazo se considera en plazo.';
export const INCIDENT_RESOLUTION_DEFINITION = 'Desde el hecho hasta resolvedAt; sin esa fecha, se usa el cierre histórico closedAt y se informa aparte. Reabrir retira el resultado vigente. No se imputan fechas faltantes.';

export function signedMoney(currency: string, value: number) {
  return `${currency} ${value > 0 ? '+' : ''}${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}
