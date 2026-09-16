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
  currentShiftType,
  ensureShift,
  getStartableShifts,
  operationalDate,
  parseSlotKey,
  slotKey,
  startShift,
} from '@/server/services/shifts';
import { RuleError } from '@/server/errors';

/**
 * Los turnos no se reparten de antemano.
 *
 * Antes había que estar asignado a un turno para poder iniciarlo, así que si
 * nadie programaba nada, nadie podía trabajar. Ahora lo que habilita a tomar
 * una franja es que esté libre, y lo que la pone primera en la lista es que el
 * turno anterior haya dejado un cierre esperando confirmación.
 */
describe('turnos sin asignación previa', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('ofrece la franja que corresponde al reloj aunque nadie haya programado nada', async () => {
    const turnos = await prisma.shift.count();
    expect(turnos).toBe(0);

    const opciones = await getStartableShifts();

    expect(opciones.length).toBeGreaterThan(0);
    const ahora = opciones.find((slot) => slot.type === currentShiftType());
    expect(ahora, 'la franja del reloj no aparece').toBeDefined();
    // Todavía no existe fila: se crea al tomarla.
    expect(ahora?.shiftId).toBeNull();
  });

  it('un recepcionista toma el turno sin que nadie lo asigne, y queda registrado como titular', async () => {
    const recepcion = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const [opcion] = await getStartableShifts();
    expect(opcion).toBeDefined();

    const turno = await startShift(recepcion, parseSlotKey(opcion!.key));

    expect(turno.status).toBe(ShiftStatus.INICIADO);
    expect(turno.startedById).toBe(recepcion.id);

    /*
      La asignación no desapareció: dejó de ser requisito y pasó a ser el
      registro de quién tomó el turno. Es lo que consulta `getMyOpenShift`.
    */
    const asignacion = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: turno.id },
    });
    expect(asignacion.userId).toBe(recepcion.id);
    expect(asignacion.role).toBe('TITULAR');
  });

  it('el Administrador de sistema sigue fuera del ciclo de turnos', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const [opcion] = await getStartableShifts();

    await expect(startShift(admin, parseSlotKey(opcion!.key))).rejects.toThrow(RuleError);
    await expect(startShift(admin, parseSlotKey(opcion!.key))).rejects.toThrow(
      /no participa en la operación de turnos/,
    );
  });

  it('dos personas no pueden tomar la misma franja: la segunda recibe un error, no el turno', async () => {
    const primera = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const segunda = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const [opcion] = await getStartableShifts();
    const franja = parseSlotKey(opcion!.key);

    const turno = await startShift(primera, franja);

    await expect(startShift(segunda, franja)).rejects.toThrow(RuleError);

    // El turno sigue siendo de quien llegó primero.
    const asignaciones = await prisma.shiftAssignment.findMany({
      where: { shiftId: turno.id },
    });
    expect(asignaciones).toHaveLength(1);
    expect(asignaciones[0]?.userId).toBe(primera.id);
  });

  it('una franja ya tomada deja de ofrecerse', async () => {
    const recepcion = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const [opcion] = await getStartableShifts();
    await startShift(recepcion, parseSlotKey(opcion!.key));

    const despues = await getStartableShifts();
    expect(despues.map((slot) => slot.key)).not.toContain(opcion!.key);
  });

  it('un turno programado a mano sigue valiendo y no se duplica en la lista', async () => {
    const hoy = operationalDate();
    const tipo = currentShiftType();
    const programado = await ensureShift(hoy, tipo);

    const opciones = await getStartableShifts();
    const coincidencias = opciones.filter((slot) => slot.key === slotKey(hoy, tipo));

    expect(coincidencias).toHaveLength(1);
    // Ahora sí tiene fila, porque alguien la programó.
    expect(coincidencias[0]?.shiftId).toBe(programado.id);
  });

  it('rechaza una franja inventada en lugar de crear un turno cualquiera', async () => {
    for (const basura of ['', 'ayer:MANANA', '2026-13-01:MANANA', '2026-09-16:SIESTA']) {
      expect(() => parseSlotKey(basura), `aceptó «${basura}»`).toThrow(RuleError);
    }
  });

  it('una franja se identifica por fecha y tipo, no por un id de fila', () => {
    const fecha = new Date(2026, 8, 16, 18, 45);
    expect(slotKey(fecha, ShiftType.TARDE)).toBe('2026-09-16:TARDE');

    const vuelta = parseSlotKey('2026-09-16:TARDE');
    expect(vuelta.type).toBe(ShiftType.TARDE);
    expect(vuelta.date.getFullYear()).toBe(2026);
    expect(vuelta.date.getMonth()).toBe(8);
    expect(vuelta.date.getDate()).toBe(16);
    expect(vuelta.date.getHours()).toBe(0);
  });
});
