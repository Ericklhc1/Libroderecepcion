import { describe, expect, it } from 'vitest';
import { coverageSlots, scheduledAt, dayWindow, coverageGaps, dateDays, holidayDates, plannedMinutes, scheduleAllowed, slotSchema, templateSchema, templateWindow, weeklyTotals, weeklyHoursSchema, weeklyHoursToMinutes, formatScheduleHours, type IntervalSlot } from '@/domain/schedule';
import { HOTEL_TIME_ZONE } from '@/domain/time';
const clock = (startTime: string, endTime: string, crossesMidnight = false) => ({ startTime, endTime, crossesMidnight, breakMinutes: 0, breakPaid: false });
function slot(id: string, date: string, start: string, end: string, night = false): IntervalSlot { return { collaboratorId: id, functionName: 'Recepcionista', kind: 'TURNO', ...templateWindow(date, clock(start, end, night)), breakPaid: false }; }
describe('malla: fechas, glosa y horas', () => {
  it('conserva once horas y fecha siguiente de RN01 en Santiago', () => {
    const s = slot('a', '2026-10-31', '21:00', '08:00', true);
    expect(plannedMinutes(s)).toBe(660); expect(s.startAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z'); expect(s.endAt?.toISOString()).toBe('2026-11-01T11:00:00.000Z'); expect(HOTEL_TIME_ZONE).toBe('America/Santiago');
  });
  it('usa la duración real al cruzar el cambio de hora, sin fijar once horas', () => {
    expect(plannedMinutes(slot('a', '2026-04-04', '21:00', '08:00', true))).toBe(720);
    expect(plannedMinutes(slot('a', '2026-09-05', '21:00', '08:00', true))).toBe(600);
    expect(() => templateWindow('2026-09-06', clock('00:30', '08:00'))).toThrow('no existe');
  });
  it('usa el inicio civil real cuando la medianoche se omite y no incluye la fecha anterior', () => {
    const spring = dayWindow('2026-09-06'); const before = dayWindow('2026-09-05'); const autumn = dayWindow('2026-04-04');
    expect(spring.startAt.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect((spring.endAt.getTime() - spring.startAt.getTime()) / 3600000).toBe(23);
    expect((before.endAt.getTime() - before.startAt.getTime()) / 3600000).toBe(24);
    expect((autumn.endAt.getTime() - autumn.startAt.getTime()) / 3600000).toBe(25);
    expect(holidayDates(slot('a', '2026-09-05', '21:00', '23:30'), [{ date: '2026-09-06', name: 'Prueba' }])).toEqual([]);
  });
  it('no configura ni descuenta colación, tampoco en registros heredados', () => {
    const window = templateWindow('2026-10-01', { ...clock('08:00', '19:00'), breakStartTime: '13:00', breakMinutes: 60 });
    expect(window.breakStartAt).toBeNull(); expect(window.breakEndAt).toBeNull();
    const s = { collaboratorId: 'a', functionName: 'Recepcionista', kind: 'TURNO', ...window, breakPaid: false, breakStartAt: new Date('2026-10-01T16:00:00Z'), breakEndAt: new Date('2026-10-01T17:00:00Z') };
    expect(plannedMinutes(s)).toBe(660); expect(plannedMinutes({ ...s, breakPaid: true })).toBe(660);
    expect(templateSchema.safeParse({ departmentId: 'x', code: 'D', label: 'Día', ...clock('08:00', '19:00'), breakMinutes: 60 }).success).toBe(false);
  });
  it('interpreta referencias semanales como horas, no como minutos', () => {
    expect(weeklyHoursToMinutes(42)).toBe(2520); expect(weeklyHoursSchema.parse('42,5')).toBe(42.5);
    expect(weeklyHoursToMinutes(42.5)).toBe(2550); expect(formatScheduleHours(2550)).toBe('42,5 h');
    expect(weeklyHoursSchema.safeParse(2520).success).toBe(false); expect(weeklyHoursSchema.safeParse(-1).success).toBe(false);
  });
  it('reconoce los dos feriados atravesados por una noche', () => {
    const s = slot('a', '2026-10-31', '21:00', '08:00', true);
    expect(holidayDates(s, [{ date: '2026-10-31', name: 'Evangélicas' }, { date: '2026-11-01', name: 'Todos los Santos' }, { date: '2026-11-02', name: 'Otro' }])).toHaveLength(2);
  });
  it('separa horas por semana calendario cuando una noche cruza del domingo al lunes', () => {
    const s = slot('a', '2026-10-04', '21:00', '08:00', true); const total = weeklyTotals([s]);
    expect(total['a:2026-09-28']).toBe(180); expect(total['a:2026-10-05']).toBe(480);
  });
  it('no confunde ocho días con una semana ni acepta fechas normalizadas incorrectamente', () => {
    expect(dateDays('2026-10-01', '2026-10-08')).toHaveLength(8);
    expect(() => dateDays('2026-02-30', '2026-03-02')).toThrow();
    expect(() => dateDays('2026-01-01', '2026-04-01')).toThrow();
  });
  it('no convierte descansos en extras y exige extensión positiva', () => {
    expect(slotSchema.safeParse({ collaboratorId: 'x', date: '2026-10-01', kind: 'LIBRE', extraKind: 'TURNO_EXTRA' }).success).toBe(false);
    expect(slotSchema.safeParse({ collaboratorId: 'x', date: '2026-10-01', kind: 'TURNO', templateId: 't', extraKind: 'EXTENSION', extraMinutes: 0 }).success).toBe(false);
    expect(templateSchema.safeParse({ departmentId: 'x', code: 'RN01', label: 'Noche', ...clock('21:00', '08:00') }).success).toBe(false);
  });
  it('el administrador participa; otros roles necesitan autorización explícita', () => {
    expect(scheduleAllowed({ roleKey: 'ADMINISTRADOR_SISTEMA', permissions: [] }, 'schedule.manage')).toBe(true);
    expect(scheduleAllowed({ roleKey: 'SUPERVISOR_RECEPCION', permissions: [] })).toBe(false);
    expect(scheduleAllowed({ roleKey: 'HOUSEKEEPING', permissions: ['schedule.self.view'] }, 'schedule.manage')).toBe(false);
  });
});
describe('cobertura por franja y función', () => {
  const rule = { name: 'Tarde', functionName: 'Recepcionista', weekdays: [0,1,2,3,4,5,6], startTime: '19:00', endTime: '21:00', crossesMidnight: false, minimum: 2 };
  it('detecta la brecha de una persona entre 19 y 21 aunque se cubra todo el día', () => {
    const people = [slot('a', '2026-10-03', '08:00', '19:00'), slot('b', '2026-10-03', '11:00', '22:00'), slot('c', '2026-10-03', '21:00', '08:00', true)];
    const gaps = coverageGaps(['2026-10-03'], [rule], people); expect(gaps).toHaveLength(1); expect(gaps[0]?.scheduled).toBe(1); expect(gaps[0]?.required).toBe(2);
  });
  it('cuenta personas únicas y funciones exactas sin descontar colaciones', () => {
    const base = slot('a', '2026-10-03', '19:00', '22:00');
    const other = { ...slot('b', '2026-10-03', '19:00', '22:00'), ...templateWindow('2026-10-03', { ...clock('19:00', '22:00'), breakStartTime: '20:00', breakMinutes: 30, breakPaid: true }), breakPaid: true };
    const irrelevant = { ...slot('c', '2026-10-03', '19:00', '22:00'), functionName: 'Seguridad' };
    const gaps = coverageGaps(['2026-10-03'], [rule], [base, base, other, irrelevant]); expect(gaps).toEqual([]);
  });
  it('no cuenta extras pendientes ni descuenta colación en la franja actual', () => {
    const base = slot('a', '2026-10-03', '19:00', '22:00');
    const extension = { ...base, baseEndAt: base.endAt, endAt: new Date(base.endAt!.getTime() + 3600000), extraKind: 'EXTENSION', extraStatus: 'PENDIENTE' };
    expect(scheduledAt(coverageSlots([extension])[0]!, new Date('2026-10-04T01:30:00Z'))).toBe(false);
    expect(coverageSlots([{ ...base, extraKind: 'TURNO_EXTRA', extraStatus: 'PENDIENTE' }])).toEqual([]);
    expect(coverageSlots([{ ...base, extraKind: 'TURNO_EXTRA', extraStatus: 'APROBADO' }])).toHaveLength(1);
    expect(scheduledAt({ ...base, breakStartAt: base.startAt, breakEndAt: new Date(base.startAt!.getTime() + 1800000) }, base.startAt!)).toBe(true);
  });
  it('evalúa una franja que comienza en la medianoche omitida por cambio de hora', () => {
    const night = slot('a', '2026-09-05', '21:00', '08:00', true);
    expect(coverageGaps(['2026-09-06'], [{ ...rule, startTime: '00:00', endTime: '08:00', minimum: 1 }], [night])).toEqual([]);
  });
  it('reconoce cobertura nocturna iniciada el día anterior', () => {
    const night = slot('a', '2026-10-02', '21:00', '08:00', true);
    expect(coverageGaps(['2026-10-03'], [{ ...rule, startTime: '00:00', endTime: '08:00', minimum: 1 }], [night])).toEqual([]);
  });
});
