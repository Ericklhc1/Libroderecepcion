import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { scheduleCalendarDays, scheduleDateIssue, scheduleDestinationIssue, scheduleHref, scheduleInitialCursor, scheduleMinimumDate, preserveScheduleContextHref } from '@/domain/schedule-navigation';
import { ScheduleCalendar } from '@/components/schedule/calendar';
import { ScheduleAreaSelector } from '@/components/schedule/schedule-area-selector';
import { ScheduleSlotFields } from '@/components/schedule/schedule-forms';
import { GroupedNav } from '@/components/layout/app-sidebar';
import { visibleNavGroups } from '@/components/layout/nav-items';
import { formatCalendarDate } from '@/lib/format';
import type { CalendarPlan, CalendarSlot, SchedulePerson } from '@/components/schedule/schedule-forms';

const location = vi.hoisted(() => ({ pathname: '/equipo', search: 'area=hk&malla=octubre&seccion=colaboradores' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname, useSearchParams: () => new URLSearchParams(location.search), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/server/actions/schedule', () => ({
  cancelScheduleSlotAction: vi.fn(), moveScheduleSlotAction: vi.fn(), changeScheduleExtraAction: vi.fn(),
  createSchedulePlanAction: vi.fn(), addScheduleSlotAction: vi.fn(), publishSchedulePlanAction: vi.fn(), reviewScheduleImportAction: vi.fn(), applyScheduleImportAction: vi.fn(), acknowledgeScheduleAction: vi.fn(), refreshScheduleImportAction: vi.fn(),
}));

const plan: CalendarPlan = { id: 'octubre', humanId: 7, version: 1, status: 'BORRADOR', startDate: '2026-09-28', endDate: '2026-10-18' };
const now = '2026-10-07T15:00:00.000Z';
const person: SchedulePerson = { id: 'p1', name: 'Persona vigente', employeeCode: 'COL001', functionName: 'Recepción', weeklyMinutes: null, userId: 'u1', eligible: true };
const morning = { kind: 'TURNO', startTime: '08:00', endTime: '16:00', crossesMidnight: false };

function calendar(overrides: Partial<Parameters<typeof ScheduleCalendar>[0]> = {}) {
  return renderToStaticMarkup(createElement(ScheduleCalendar, { plan, people: [person], templates: [], slots: [], holidays: [], canManage: true, canApprove: false, currentUserId: 'u1', canReportOwn: false, now, totals: {}, ...overrides }));
}

describe('F12 · área y malla en la navegación', () => {
  it('construye contexto explícito y escapa los identificadores', () => {
    expect(scheduleHref({ area: 'hk', malla: 'octubre', seccion: 'colaboradores' })).toBe('/equipo?area=hk&malla=octubre&seccion=colaboradores');
    expect(scheduleHref({ area: 'área & 2', malla: null })).toBe('/equipo?area=%C3%A1rea+%26+2');
    expect(scheduleHref({})).toBe('/equipo');
  });

  it.each(['colaboradores', 'plantillas', 'cobertura', 'configuracion'])('conserva área/malla al abrir %s desde el lateral', (section) => {
    const href = preserveScheduleContextHref(`/equipo?seccion=${section}`, '/equipo', location.search);
    const params = new URL(href, 'https://example.invalid').searchParams;
    expect(Object.fromEntries(params)).toEqual({ seccion: section, area: 'hk', malla: 'octubre' });
  });

  it('vuelve al calendario con la misma malla y respeta destinos explícitos', () => {
    expect(preserveScheduleContextHref('/equipo', '/equipo', location.search)).toBe('/equipo?area=hk&malla=octubre');
    expect(preserveScheduleContextHref('/equipo?area=recepcion', '/equipo', location.search)).toBe('/equipo?area=recepcion');
    expect(preserveScheduleContextHref('/equipo?malla=noviembre', '/equipo', location.search)).toBe('/equipo?malla=noviembre&area=hk');
  });

  it('no añade filtros a otros módulos ni recupera contexto oculto', () => {
    expect(preserveScheduleContextHref('/admin/usuarios', '/equipo', location.search)).toBe('/admin/usuarios');
    expect(preserveScheduleContextHref('/equipo', '/coordinacion', location.search)).toBe('/equipo');
    expect(preserveScheduleContextHref('/equipo', '/equipo', 'seccion=colaboradores')).toBe('/equipo');
    expect(preserveScheduleContextHref('/equipo-extra', '/equipo', location.search)).toBe('/equipo-extra');
    expect(preserveScheduleContextHref('https://other.invalid/equipo', '/equipo', location.search)).toBe('https://other.invalid/equipo');
  });

  it('el enlace principal del sidebar hereda el contexto sin cambiar permisos', () => {
    const html = renderToStaticMarkup(createElement(GroupedNav, { groups: visibleNavGroups(['schedule.view', 'schedule.catalog.manage']) }));
    expect(html).toContain('href="/equipo?area=hk&amp;malla=octubre"');
    const forbidden = renderToStaticMarkup(createElement(GroupedNav, { groups: visibleNavGroups([]) }));
    expect(forbidden).not.toContain('href="/equipo');
  });

  it('el selector refleja cada selección del servidor, incluida un área sin datos y volver/avanzar', () => {
    const departments = [{ id: 'recepcion', name: 'Recepción' }, { id: 'hk', name: 'Housekeeping' }, { id: 'empty', name: 'Área sin malla' }];
    for (const departmentId of ['hk', 'recepcion', 'empty', 'recepcion', 'hk']) {
      const html = renderToStaticMarkup(createElement(ScheduleAreaSelector, { departments, departmentId, section: 'colaboradores' }));
      expect(html).toContain(`<option value="${departmentId}" selected="">`);
    }
    const source = readFileSync('src/components/schedule/schedule-area-selector.tsx', 'utf8');
    expect(source).toContain('value={departmentId} disabled={pending}');
    expect(source).toContain('scheduleHref({ area, seccion: section })');
    expect(source).not.toContain('localStorage');
  });

  it('todas las superficies de navegación usan el mismo constructor de contexto', () => {
    for (const filename of ['app-sidebar.tsx', 'fns-navigation.tsx', 'nav.tsx']) {
      const source = readFileSync(`src/components/layout/${filename}`, 'utf8');
      expect(source).toContain('preserveScheduleContextHref');
      expect(source).not.toMatch(/href=\{(?:item|subitem|first|link)\.href\}/);
    }
  });
});

describe('F12 · periodo y acciones posibles', () => {
  it('abre la semana vigente cuando hoy está dentro de la malla', () => {
    expect(scheduleInitialCursor(plan, '2026-10-05')).toBe('2026-10-05');
    expect(scheduleCalendarDays('semana', scheduleInitialCursor(plan, '2026-10-05'))).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    const html = calendar({ now: '2026-10-05T17:00:00.000Z' });
    expect(html).toContain(`${formatCalendarDate('2026-10-05')}–${formatCalendarDate('2026-10-11')}`);
    expect(html).not.toContain('Malla histórica');
    expect(html).toContain('Ir a hoy');
  });

  it('explica las mallas históricas y futuras, usando el extremo cercano', () => {
    expect(scheduleInitialCursor(plan, '2026-11-01')).toBe(plan.endDate);
    expect(scheduleInitialCursor(plan, '2026-09-01')).toBe(plan.startDate);
    expect(calendar({ now: '2026-11-01T17:00:00Z' })).toContain('Malla histórica');
    expect(calendar({ now: '2026-09-01T17:00:00Z' })).toContain('Malla futura');
  });

  it('usa el día de Santiago aunque UTC esté en el día siguiente', () => {
    const html = calendar({ now: '2026-10-05T02:00:00Z' });
    expect(html).toContain(`${formatCalendarDate('2026-09-28')}–${formatCalendarDate('2026-10-04')}`);
  });

  it('cambia de vista sin reiniciar el cursor al inicio de la malla', () => {
    expect(scheduleCalendarDays('ciclo', '2026-10-07')).toHaveLength(8);
    expect(scheduleCalendarDays('mes', '2026-10-07')[0]).toBe('2026-10-01');
    const source = readFileSync('src/components/schedule/calendar.tsx', 'utf8');
    expect(source).not.toContain('setCursor(plan.startDate)');
  });

  it('deshabilita Programar pasado y permite hoy con comprobación posterior de hora', () => {
    const html = calendar();
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.find((button) => button.includes(`Programar a ${person.name} el ${formatCalendarDate('2026-10-06')}`))).toContain('disabled=""');
    expect(buttons.find((button) => button.includes(`Programar a ${person.name} el ${formatCalendarDate('2026-10-07')}`))).not.toContain('disabled=');
  });

  it('conserva filas sin habilitación pero no ofrece nuevas celdas', () => {
    const html = calendar({ people: [{ ...person, eligible: false }] });
    expect(html).toContain(person.name);
    expect(html).toContain('Sin habilitación actual');
    expect(html).not.toContain(`aria-label="Programar a ${person.name}`);
  });

  it('conserva la asignación futura inhabilitada como origen para su regularización', () => {
    const slot: CalendarSlot = { id: 'slot-1', collaboratorId: person.id, date: '2026-10-08', kind: 'LIBRE', code: 'LIBRE', templateId: null, startTime: null, endTime: null, crossesMidnight: false, startAt: null, endAt: null, extraKind: 'NINGUNO', extraMinutes: 0, extraStatus: 'NO_APLICA', reportedExtraMinutes: null, note: null, breakMinutes: 0, breakPaid: false, plannedMinutes: 0 };
    const html = calendar({ people: [{ ...person, eligible: false }], slots: [slot] });
    expect(html).toContain('draggable="true"');
    expect(html).toContain(`${person.name}, ${formatCalendarDate(slot.date)}, Libre`);
  });

  it('rechaza destinos pasados, fuera del periodo, fechas inválidas y personas no habilitadas', () => {
    expect(scheduleMinimumDate(plan, '2026-10-07')).toBe('2026-10-07');
    expect(scheduleMinimumDate(plan, '2026-09-01')).toBe(plan.startDate);
    expect(scheduleDateIssue(plan, '2026-10-06', '2026-10-07')).toMatch(/pasada/);
    expect(scheduleDateIssue(plan, '2026-10-19', '2026-10-07')).toMatch(/periodo/);
    expect(scheduleDateIssue(plan, '2026-02-30', '2026-10-07')).toMatch(/válida/);
    expect(scheduleDestinationIssue({ plan, date: '2026-10-08', person: { eligible: false }, now })).toMatch(/habilitado/);
    expect(scheduleDestinationIssue({ plan, date: '2026-10-08', now })).toMatch(/habilitado/);
  });

  it('rechaza mover una hora ya pasada hoy y acepta fechas u horas futuras', () => {
    expect(scheduleDestinationIssue({ plan, date: '2026-10-07', person, now, slot: morning })).toMatch(/inicio ya pasó/);
    expect(scheduleDestinationIssue({ plan, date: '2026-10-08', person, now, slot: morning })).toBeNull();
    expect(scheduleDestinationIssue({ plan, date: '2026-10-07', person, now, slot: { ...morning, startTime: '16:00', endTime: '23:00' } })).toBeNull();
    expect(scheduleDestinationIssue({ plan, date: '2026-10-07', person, now, slot: { ...morning, kind: 'LIBRE' } })).toBeNull();
  });

  it('rechaza una hora inexistente por el cambio de hora de Chile', () => {
    expect(scheduleDestinationIssue({ plan: { startDate: '2026-09-01', endDate: '2026-09-30' }, date: '2026-09-06', person, now: '2026-09-01T15:00:00Z', slot: { ...morning, startTime: '00:30', endTime: '08:00' } })).toMatch(/no existe por el cambio de hora/);
  });

  it('el formulario no ofrece personas históricas y muestra el límite de fecha vigente', () => {
    const html = renderToStaticMarkup(createElement(ScheduleSlotFields, {
      plan, now, people: [person, { ...person, id: 'p2', name: 'Persona no habilitada', eligible: false }],
      templates: [{ id: 'morning', code: 'RD01', label: 'Mañana', ...morning }], date: '2026-10-08',
    }));
    expect(html).toContain('value="p1"');
    expect(html).not.toContain('Persona no habilitada');
    expect(html).toContain('min="2026-10-07"');
    expect(html).toContain('max="2026-10-18"');
    expect(html.match(/<button[^>]*>Guardar asignación/)).not.toBeNull();
  });

  it.each([
    { date: '2026-10-06', people: [person], message: 'fecha pasada' },
    { date: '2026-10-07', people: [person], message: 'hora de inicio ya pasó' },
    { date: '2026-10-19', people: [person], message: 'periodo de esta malla' },
    { date: '2026-10-08', people: [{ ...person, eligible: false }], message: 'colaborador habilitado' },
  ])('deshabilita Guardar ante $message', ({ date, people, message }) => {
    const html = renderToStaticMarkup(createElement(ScheduleSlotFields, { plan, now, people, templates: [{ id: 'morning', code: 'RD01', label: 'Mañana', ...morning }], date }));
    expect(html.toLowerCase()).toContain(message);
    expect(html.match(/<button[^>]*>Guardar asignación/)?.[0]).toContain('disabled=""');
  });
});
