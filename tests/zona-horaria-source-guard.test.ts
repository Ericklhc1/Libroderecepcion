import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('guardas de zona horaria en superficies operativas', () => {
  it('la configuración de servidor no puede desviarse de America/Santiago', () => {
    const env = source('src/lib/env.ts');
    expect(env).toContain("HOTEL_TIMEZONE: z.literal('America/Santiago').default('America/Santiago')");
  });

  it('las fechas calendario de turnos no se formatean como instantes de Santiago', () => {
    const shiftPage = source('src/app/(app)/turno/page.tsx');
    const adminPage = source('src/app/(app)/admin/turnos/page.tsx');
    const options = source('src/server/services/options.ts');
    const supervision = source('src/server/services/supervision-center.ts');

    expect(shiftPage).not.toContain('formatDate(pendingClosure.date)');
    expect(shiftPage).not.toContain('formatDate(item.date)');
    expect(adminPage).not.toContain('formatDate(shift.date)');
    expect(options).not.toContain("shift.date.toLocaleDateString('es-CL')");
    expect(supervision).not.toContain("row.date.toLocaleDateString('es-CL')");

    expect(shiftPage).toContain('formatCalendarDate(pendingClosure.date)');
    expect(adminPage).toContain('formatCalendarDate(shift.date)');
  });

  it('los snapshots de entrega no dependen de la zona del proceso', () => {
    const snapshot = source('src/server/services/handover-snapshot.ts');
    expect(snapshot).not.toContain("date.toLocaleString('es-CL'");
    expect(snapshot).toContain('formatDateTime(date)');
  });

  it('los rangos de informes no fijan manualmente UTC-3', () => {
    const reports = source('src/server/services/supervisor-reports.ts');
    expect(reports).not.toContain('T00:00:00-03:00');
    expect(reports).not.toContain('T23:59:59.999-03:00');
    expect(reports).toContain('hotelWallDateTime');
  });

  it('todos los formularios datetime-local pasan por la zona del hotel al persistir', () => {
    const action = source('src/server/action.ts');
    const schemas = source('src/server/schemas.ts');
    const liveCash = source('src/server/actions/live-cash.ts');
    const operationalAlarms = source('src/server/actions/operational-alarms.ts');

    expect(action).toContain("import { parseHotelDateInput } from '@/domain/time'");
    expect(action).toContain('parseHotelDateInput(v)');
    expect(action).not.toContain('Date.parse(v)');
    expect(action).not.toContain('new Date(v)');

    expect(schemas).toContain('occurredAt: zOptionalDate');
    expect(schemas).toContain('startsAt: zOptionalDate');
    expect(schemas).toContain('scheduledAt: zOptionalDate');
    expect(schemas).toContain('dueAt: zOptionalDate');
    expect(schemas).toContain('checkIn: zOptionalDate');
    expect(schemas).toContain('checkOut: zOptionalDate');

    expect(liveCash).toContain('parseHotelDateTimeLocal(input.effectiveAt)');
    expect(operationalAlarms).toContain('parseHotelDateTimeLocal(input.dueAtLocal)');
  });

  it('un cierre de Caja antiguo no invita a reconstruirlo con la Caja actual', () => {
    const shiftPage = source('src/app/(app)/turno/page.tsx');
    expect(shiftPage).toContain('pendingClosureIsStale');
    expect(shiftPage).toContain('Requiere Administrador de sistema');
    expect(shiftPage).toContain('No reconstruyas ese turno con la Caja actual');
  });
});
