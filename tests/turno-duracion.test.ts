import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ShiftStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  MAX_SHIFT_HOURS,
  customWindow,
  plannedWindow,
  windowHours,
} from '@/domain/shift';
import { ensureShift, getStartableShifts, slotKey } from '@/server/services/shifts';
import { RuleError } from '@/server/errors';

/**
 * Turnos de duración libre hasta doce horas, y turnos archivables.
 *
 * El horario nominal de cada tipo sigue cubriendo el caso normal. Lo de acá es
 * el turno que no encaja —una cobertura de doce horas, una entrada a las 6— y
 * el archivado, que es lo contrario de anular: anular vale antes de empezar,
 * archivar vale cuando ya terminó.
 */
describe('duración del turno', () => {
  const DIA = new Date(2026, 8, 16);

  it('el horario nominal sigue siendo el de siempre', () => {
    const manana = plannedWindow(DIA, ShiftType.MANANA);
    expect(windowHours(manana.start, manana.end)).toBe(8);

    // La noche cruza la medianoche y también son ocho horas.
    const noche = plannedWindow(DIA, ShiftType.NOCHE);
    expect(windowHours(noche.start, noche.end)).toBe(8);
  });

  it('acepta una jornada de doce horas', () => {
    const { start, end } = customWindow(DIA, '07:00', 12);
    expect(start.getHours()).toBe(7);
    expect(end.getHours()).toBe(19);
    expect(windowHours(start, end)).toBe(12);
  });

  it('acepta medias horas y una entrada a cualquier hora', () => {
    const { start, end } = customWindow(DIA, '06:30', 7.5);
    expect(start.getHours()).toBe(6);
    expect(start.getMinutes()).toBe(30);
    expect(windowHours(start, end)).toBe(7.5);
    expect(end.getHours()).toBe(14);
  });

  it('una ventana que cruza la medianoche termina al día siguiente', () => {
    const { start, end } = customWindow(DIA, '20:00', 10);
    expect(start.getDate()).toBe(16);
    expect(end.getDate()).toBe(17);
    expect(end.getHours()).toBe(6);
  });

  it('rechaza más de doce horas', () => {
    expect(MAX_SHIFT_HOURS).toBe(12);
    expect(() => customWindow(DIA, '07:00', 12.5)).toThrow(RuleError);
    expect(() => customWindow(DIA, '07:00', 24)).toThrow(/más de 12 horas/);
  });

  it('rechaza duraciones imposibles y horas mal escritas', () => {
    expect(() => customWindow(DIA, '07:00', 0)).toThrow(RuleError);
    expect(() => customWindow(DIA, '07:00', -3)).toThrow(RuleError);
    // Fracciones más finas que la media hora no significan nada en un mesón.
    expect(() => customWindow(DIA, '07:00', 7.25)).toThrow(/horas o medias horas/);
    for (const hora of ['7:00', '24:00', '07:60', 'mañana', '', '0700']) {
      expect(() => customWindow(DIA, hora, 8), `aceptó «${hora}»`).toThrow(RuleError);
    }
  });
});

describe('turnos archivables', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('un turno archivado deja de ofrecerse para tomar', async () => {
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const hoy = new Date();
    const turno = await ensureShift(hoy, ShiftType.MANANA);

    // Antes de archivar, la franja se ofrece.
    const clave = slotKey(hoy, ShiftType.MANANA);
    const antes = await getStartableShifts();
    expect(antes.map((slot) => slot.key)).toContain(clave);

    await prisma.shift.update({
      where: { id: turno.id },
      data: { archivedAt: new Date() },
    });

    /*
      Después de archivar la franja no aparece. Ojo: se comprueba contra el
      TURNO archivado, no contra la franja vacía, porque la franja del reloj
      se ofrece igual cuando no tiene fila. Acá tiene fila y está archivada.
    */
    const despues = await getStartableShifts();
    const coincidencia = despues.find((slot) => slot.key === clave);
    expect(coincidencia?.shiftId ?? null).not.toBe(turno.id);
  });

  it('archivar no borra nada: el turno conserva su estado y su fecha', async () => {
    const turno = await ensureShift(new Date(), ShiftType.TARDE);
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    await prisma.shift.update({
      where: { id: turno.id },
      data: { archivedAt: new Date(), archivedById: admin.id },
    });

    const despues = await prisma.shift.findUniqueOrThrow({ where: { id: turno.id } });
    expect(despues.status).toBe(ShiftStatus.PROGRAMADO);
    expect(despues.date.getTime()).toBe(turno.date.getTime());
    expect(despues.archivedById).toBe(admin.id);
  });

  it('desarchivar lo devuelve a las listas', async () => {
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const hoy = new Date();
    const turno = await ensureShift(hoy, ShiftType.MANANA);
    const clave = slotKey(hoy, ShiftType.MANANA);

    await prisma.shift.update({ where: { id: turno.id }, data: { archivedAt: new Date() } });
    await prisma.shift.update({ where: { id: turno.id }, data: { archivedAt: null } });

    const ofrecidas = await getStartableShifts();
    const coincidencia = ofrecidas.find((slot) => slot.key === clave);
    expect(coincidencia?.shiftId).toBe(turno.id);
  });
});
