import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Invariante de turnos solapados:
 * cualquier camino que retire un turno activo debe cerrar también la
 * participación física de sus integrantes (ShiftAssignment.leftAt).
 *
 * Si no, el índice de "una participación activa por usuario" deja a la
 * persona bloqueada para siempre aunque el turno ya figure ANULADO.
 */
describe('anular un turno libera la participación', () => {
  const service = readFileSync('src/server/services/shifts.ts', 'utf-8');
  const shiftActions = readFileSync('src/server/actions/shifts.ts', 'utf-8');
  const adminActions = readFileSync('src/server/actions/admin-shifts.ts', 'utf-8');

  it('existe una única operación canónica para cerrar participación', () => {
    expect(service).toContain('export async function endShiftParticipation');
    expect(service).toMatch(/activatedAt:\s*\{\s*not:\s*null\s*\}/);
    expect(service).toMatch(/leftAt:\s*null/);
    expect(service).toMatch(/data:\s*\{\s*leftAt:\s*at\s*\}/);
  });

  it('la anulación normal usa la operación canónica', () => {
    const start = shiftActions.indexOf('export async function cancelShiftAction');
    const end = shiftActions.indexOf('const archiveSchema', start);
    const cancelAction = shiftActions.slice(start, end);

    expect(cancelAction).toContain('ShiftStatus.ANULADO');
    expect(cancelAction).toContain('endShiftParticipation(tx, shift.id, now)');
  });

  it('el retiro forzado del Administrador también libera la participación', () => {
    const start = adminActions.indexOf('export async function removeShiftFromOperationAction');
    const forcedRemoval = adminActions.slice(start);

    expect(forcedRemoval).toContain('ShiftStatus.ANULADO');
    expect(forcedRemoval).toContain('endShiftParticipation(tx, shift.id, now)');
  });
});
