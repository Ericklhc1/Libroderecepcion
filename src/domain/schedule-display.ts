import { SLOT_LABELS } from './schedule';

/** One clock label for saved schedules, selectors, imports and Fronti. */
export function scheduleClock(value: { startTime?: string | null; endTime?: string | null; crossesMidnight?: boolean }): string {
  return value.startTime && value.endTime
    ? `${value.startTime}–${value.endTime}${value.crossesMidnight ? ' (día siguiente)' : ''}`
    : '';
}

export function scheduleLabel(value: { kind?: string; code: string; startTime?: string | null; endTime?: string | null; crossesMidnight?: boolean }): string {
  if (value.kind && value.kind !== 'TURNO') return SLOT_LABELS[value.kind as keyof typeof SLOT_LABELS] ?? value.code;
  return [value.code, scheduleClock(value)].filter(Boolean).join(' · ');
}

export function collaboratorReference(value: { employeeCode: string; username?: string | null }): string {
  return value.username ? `@${value.username}` : /^USR_/i.test(value.employeeCode) ? '' : value.employeeCode;
}
