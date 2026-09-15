import { describe, expect, it } from 'vitest';
import { ShiftStatus, ShiftType } from '@prisma/client';
import {
  SHIFT_TRANSITIONS,
  assertCanClose,
  assertTransition,
  canTransition,
  nextShiftSlot,
  plannedWindow,
  previousShiftSlot,
  shiftOrder,
} from '@/domain/shift';
import { RuleError } from '@/server/errors';

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
    expect(canTransition(ShiftStatus.ENTREGA_ENVIADA, ShiftStatus.RECIBIDO)).toBe(true);
    expect(canTransition(ShiftStatus.RECIBIDO, ShiftStatus.CERRADO)).toBe(true);
  });

  it('rechaza saltos de estado contradictorios', () => {
    expect(canTransition(ShiftStatus.PROGRAMADO, ShiftStatus.ACTIVO)).toBe(false);
    expect(canTransition(ShiftStatus.PROGRAMADO, ShiftStatus.CERRADO)).toBe(false);
    expect(canTransition(ShiftStatus.INICIADO, ShiftStatus.ENTREGA_ENVIADA)).toBe(false);
    expect(canTransition(ShiftStatus.ENTREGA_ENVIADA, ShiftStatus.CERRADO)).toBe(false);
    expect(canTransition(ShiftStatus.ACTIVO, ShiftStatus.ENTREGA_ENVIADA)).toBe(false);
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
  it('bloquea el cierre sin entrega cuando existe turno siguiente', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.ACTIVO,
        hasNextShift: true,
        handoverStatus: 'NONE',
      }),
    ).toThrow(/sin enviar la entrega/);
  });

  it('bloquea el cierre con entrega en borrador', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.PREPARANDO_ENTREGA,
        hasNextShift: true,
        handoverStatus: 'BORRADOR',
      }),
    ).toThrow(/sin enviar la entrega/);
  });

  it('bloquea el cierre mientras la entrega no es confirmada', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.ENTREGA_ENVIADA,
        hasNextShift: true,
        handoverStatus: 'ENVIADA',
      }),
    ).toThrow(/aún no la confirma/);
  });

  it('permite cerrar cuando la entrega fue recibida', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.RECIBIDO,
        hasNextShift: true,
        handoverStatus: 'RECIBIDA',
      }),
    ).not.toThrow();
  });

  it('permite cerrar sin entrega si no hay turno siguiente', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.ACTIVO,
        hasNextShift: false,
        handoverStatus: 'NONE',
      }),
    ).not.toThrow();
  });

  it('no permite cerrar dos veces', () => {
    expect(() =>
      assertCanClose({
        status: ShiftStatus.CERRADO,
        hasNextShift: false,
        handoverStatus: 'RECIBIDA',
      }),
    ).toThrow(/ya está cerrado/);
  });
});

describe('secuencia de turnos', () => {
  it('ordena mañana, tarde y noche', () => {
    expect(shiftOrder(ShiftType.MANANA)).toBe(0);
    expect(shiftOrder(ShiftType.TARDE)).toBe(1);
    expect(shiftOrder(ShiftType.NOCHE)).toBe(2);
  });

  it('encadena la noche con la mañana del día siguiente', () => {
    expect(nextShiftSlot(ShiftType.MANANA)).toEqual({ type: ShiftType.TARDE, dayOffset: 0 });
    expect(nextShiftSlot(ShiftType.NOCHE)).toEqual({ type: ShiftType.MANANA, dayOffset: 1 });
    expect(previousShiftSlot(ShiftType.MANANA)).toEqual({
      type: ShiftType.NOCHE,
      dayOffset: -1,
    });
  });

  it('el turno de noche cruza la medianoche', () => {
    const date = new Date('2026-03-10T00:00:00');
    const noche = plannedWindow(date, ShiftType.NOCHE);
    expect(noche.start.getDate()).toBe(10);
    expect(noche.end.getDate()).toBe(11);

    const manana = plannedWindow(date, ShiftType.MANANA);
    expect(manana.start.getHours()).toBe(7);
    expect(manana.end.getHours()).toBe(15);
  });
});
