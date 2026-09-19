import { describe, expect, it } from 'vitest';
import { ShiftStatus, ShiftType } from '@prisma/client';
import {
  SHIFT_SCHEDULE,
  SHIFT_TRANSITIONS,
  SHIFT_WINDOW_LABEL,
  assertCanClose,
  assertTransition,
  canTransition,
  plannedWindow,
  shiftTypeAt,
} from '@/domain/shift';
import { RuleError } from '@/server/errors';
import { hotelDateKey, hotelWallDateTime } from '@/domain/time';
import { formatTime } from '@/lib/format';

/**
 * Pruebas de la máquina de estados del turno. Son unitarias y puras: describen
 * el contrato que después verifica la prueba de integración del ciclo completo.
 */
describe('máquina de estados del turno', () => {
  it('permite únicamente el ciclo previsto', () => {
    expect(canTransition(ShiftStatus.PROGRAMADO, ShiftStatus.INICIADO)).toBe(true);
    expect(canTransition(ShiftStatus.INICIADO, ShiftStatus.ACTIVO)).toBe(true);
    expect(canTransition(ShiftStatus.ACTIVO, ShiftStatus.PREPARANDO_ENTREGA)).toBe(true);
    expect(
      canTransition(ShiftStatus.PREPARANDO_ENTREGA, ShiftStatus.ENTREGA_ENVIADA),
    ).toBe(true);
    expect(canTransition(ShiftStatus.ENTREGA_ENVIADA, ShiftStatus.CERRADO)).toBe(true);
    // Compatibilidad histórica: RECIBIDO se conserva, aunque ya no sea requisito.
    expect(canTransition(ShiftStatus.ENTREGA_ENVIADA, ShiftStatus.RECIBIDO)).toBe(true);
    expect(canTransition(ShiftStatus.RECIBIDO, ShiftStatus.CERRADO)).toBe(true);
  });

  it('rechaza saltos de estado contradictorios', () => {
    expect(canTransition(ShiftStatus.PROGRAMADO, ShiftStatus.ACTIVO)).toBe(false);
    expect(canTransition(ShiftStatus.PROGRAMADO, ShiftStatus.CERRADO)).toBe(false);
    expect(canTransition(ShiftStatus.INICIADO, ShiftStatus.ENTREGA_ENVIADA)).toBe(false);
    expect(canTransition(ShiftStatus.ACTIVO, ShiftStatus.ENTREGA_ENVIADA)).toBe(false);
    expect(canTransition(ShiftStatus.ACTIVO, ShiftStatus.CERRADO)).toBe(false);
  });

  it('los estados finales no admiten más transiciones', () => {
    expect(SHIFT_TRANSITIONS[ShiftStatus.CERRADO]).toHaveLength(0);
    expect(SHIFT_TRANSITIONS[ShiftStatus.ANULADO]).toHaveLength(0);
  });

  it('explica en lenguaje operativo la transición imposible', () => {
    expect(() => assertTransition(ShiftStatus.CERRADO, ShiftStatus.ACTIVO)).toThrow(RuleError);
    expect(() => assertTransition(ShiftStatus.CERRADO, ShiftStatus.ACTIVO)).toThrow(
      /Cerrado → Turno activo/,
    );
  });

  it('permite volver a ACTIVO si la entrega se preparó por error', () => {
    expect(canTransition(ShiftStatus.PREPARANDO_ENTREGA, ShiftStatus.ACTIVO)).toBe(true);
  });
});

describe('regla de cierre de turno', () => {
  /*
    El cierre no sirve como atajo desde ACTIVO. El contrato del saliente es:
    preparar entrega -> actualizar informes -> caja/elementos -> enviar -> cerrar.
    La recepción del turno siguiente es independiente y no bloquea ese cierre.
  */
  it('bloquea el cierre de un turno que no inició la entrega', () => {
    expect(() =>
      assertCanClose({ status: ShiftStatus.INICIADO, handoverStatus: 'NONE' }),
    ).toThrow(/primero prepara la entrega/i);
  });

  it('bloquea el cierre con la entrega en borrador', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.PREPARANDO_ENTREGA,
        handoverStatus: 'BORRADOR',
      }),
    ).toThrow(/primero prepara la entrega/i);
  });

  it('con la entrega enviada, el saliente puede cerrar sin esperar recepción', () => {
    expect(() =>
      assertCanClose({ status: ShiftStatus.ENTREGA_ENVIADA, handoverStatus: 'ENVIADA' }),
    ).not.toThrow();
  });

  it('permite cerrar cuando la entrega fue recibida', () => {
    expect(() =>
      assertCanClose({ status: ShiftStatus.RECIBIDO, handoverStatus: 'RECIBIDA' }),
    ).not.toThrow();
  });

  it('bloquea cerrar directamente desde ACTIVO aunque todavía no exista entrega', () => {
    expect(() =>
      assertCanClose({ status: ShiftStatus.ACTIVO, handoverStatus: 'NONE' }),
    ).toThrow(/primero prepara la entrega/i);
  });

  it('no permite cerrar dos veces', () => {
    expect(() =>
      assertCanClose({ status: ShiftStatus.CERRADO, handoverStatus: 'RECIBIDA' }),
    ).toThrow(/ya está cerrado/);
  });
});

describe('las dos ventanas fijas', () => {
  it('son exactamente dos y cubren el día completo sin huecos', () => {
    expect(SHIFT_SCHEDULE.DIA.startHour).toBe(7);
    expect(SHIFT_SCHEDULE.DIA.endHour).toBe(20);
    expect(SHIFT_SCHEDULE.NOCHE.startHour).toBe(20);
    expect(SHIFT_SCHEDULE.NOCHE.endHour).toBe(8);
    expect(Object.keys(SHIFT_SCHEDULE)).toEqual(['DIA', 'NOCHE']);
  });

  it('se leen como las dice el hotel', () => {
    expect(SHIFT_WINDOW_LABEL.DIA).toBe('07:00 a 20:00');
    expect(SHIFT_WINDOW_LABEL.NOCHE).toBe('20:00 a 08:00');
  });

  it('el turno de día no cruza la medianoche y el de noche sí', () => {
    const base = new Date('2026-09-16T00:00:00.000Z');
    const dia = plannedWindow(base, ShiftType.DIA);
    expect(formatTime(dia.start)).toBe('07:00');
    expect(formatTime(dia.end)).toBe('20:00');

    const noche = plannedWindow(base, ShiftType.NOCHE);
    expect(formatTime(noche.start)).toBe('20:00');
    expect(formatTime(noche.end)).toBe('08:00');
    expect(hotelDateKey(noche.end)).toBe('2026-09-17');
  });

  it('propone el turno según el reloj, en los dos bordes', () => {
    expect(shiftTypeAt(hotelWallDateTime('2026-09-16', 7, 0))).toBe(ShiftType.DIA);
    expect(shiftTypeAt(hotelWallDateTime('2026-09-16', 19, 59))).toBe(ShiftType.DIA);
    expect(shiftTypeAt(hotelWallDateTime('2026-09-16', 20, 0))).toBe(ShiftType.NOCHE);
    expect(shiftTypeAt(hotelWallDateTime('2026-09-16', 6, 59))).toBe(ShiftType.NOCHE);
    expect(shiftTypeAt(hotelWallDateTime('2026-09-16', 3, 0))).toBe(ShiftType.NOCHE);
  });
});
