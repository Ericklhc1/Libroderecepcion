import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftStatus, ShiftType } from '@prisma/client';
import {
  addShiftMember,
  closeShift,
  getCurrentShift,
  getMyOpenShift,
  getPendingHandover,
  getShiftDesk,
  getShiftsAwaitingReceipt,
  openShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import { RuleError } from '@/server/errors';
import {
  ROLE_KEYS,
  closeAllShifts,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

/**
 * El modelo de turnos, después de rehacerlo.
 *
 * Estas pruebas reemplazan a `turno-sin-asignacion.test.ts` y
 * `turno-duracion.test.ts`, que probaban dos cosas que ya no existen: una
 * lista de «franjas tomables» y las ventanas de duración libre.
 *
 * Lo que se protege ahora, y por qué:
 *
 * 1. **Dos ventanas fijas.** Cubierto en `shift-state.test.ts` (dominio puro).
 * 2. **Nada preestablecido.** Abrir el turno es un solo gesto, sin programar.
 * 3. **UN turno en curso a la vez.** Es la regla que el hotel pidió y la que
 *    evita que se pierda quién tenía la caja.
 * 4. **La entrega pendiente es única y se encuentra siempre.** Éste es el
 *    fallo que el usuario reportó: «no se puede recibir ni confirmar». Antes
 *    la entrega se buscaba por adyacencia de franjas y desaparecía en cuanto
 *    la cadena tenía un hueco.
 */
describe('modelo de turnos: dos ventanas, creados a voluntad, uno a la vez', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
    await closeAllShifts();
  });

  it('abre el turno sin que nadie lo haya programado', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    // Ni un turno en la base, y sin embargo se puede entrar al mesón.
    expect(await prisma.shift.count()).toBe(0);

    const { shift, joined } = await openShift(receptionist, { type: ShiftType.DIA });

    expect(joined).toBe(false);
    expect(shift.status).toBe(ShiftStatus.INICIADO);
    expect(shift.type).toBe(ShiftType.DIA);
    // Queda como titular: la asignación es consecuencia, no requisito.
    expect(shift.assignments).toHaveLength(1);
    expect(shift.assignments[0]!.userId).toBe(receptionist.id);
    expect(shift.assignments[0]!.role).toBe('TITULAR');
  });

  it('la ventana la decide el tipo, no quien abre el turno', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const { shift } = await openShift(receptionist, { type: ShiftType.NOCHE });

    expect(shift.plannedStart.getHours()).toBe(20);
    expect(shift.plannedEnd.getHours()).toBe(8);
  });

  it('sin tipo, propone el que corresponde al reloj', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const { shift } = await openShift(receptionist, {});

    const hour = new Date().getHours();
    expect(shift.type).toBe(hour >= 7 && hour < 20 ? ShiftType.DIA : ShiftType.NOCHE);
  });

  /* ------------------------ Un solo turno a la vez ------------------------ */

  it('si ya hay un turno abierto, el segundo que entra SE SUMA en lugar de abrir otro', async () => {
    const primero = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const segundo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    const abierto = await openShift(primero, { type: ShiftType.DIA });
    const siguiente = await openShift(segundo, { type: ShiftType.NOCHE });

    // Mismo turno, aunque el segundo pidiera otro tipo: se trabaja sobre el abierto.
    expect(siguiente.joined).toBe(true);
    expect(siguiente.shift.id).toBe(abierto.shift.id);
    expect(siguiente.shift.type).toBe(ShiftType.DIA);

    // Y sigue habiendo UN turno en curso, con dos personas.
    const enCurso = await prisma.shift.count({
      where: { status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA'] } },
    });
    expect(enCurso).toBe(1);
    expect(siguiente.shift.assignments).toHaveLength(2);
  });

  it('el primero es titular y quien se suma es apoyo', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const apoyo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    await openShift(titular, { type: ShiftType.DIA });
    const { shift } = await openShift(apoyo, {});

    const roles = new Map(shift.assignments.map((a) => [a.userId, a.role]));
    expect(roles.get(titular.id)).toBe('TITULAR');
    expect(roles.get(apoyo.id)).toBe('APOYO');
  });

  it('volver a entrar al turno propio no duplica la asignación', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const primera = await openShift(receptionist, { type: ShiftType.DIA });
    const segunda = await openShift(receptionist, { type: ShiftType.DIA });

    expect(segunda.shift.id).toBe(primera.shift.id);
    expect(segunda.joined).toBe(false);
    expect(segunda.shift.assignments).toHaveLength(1);
  });

  /*
    La garantía de verdad es el índice único parcial de la base. Se comprueba
    directamente: si alguien insertara un segundo turno en curso saltándose el
    servicio, PostgreSQL lo rechaza.
  */
  it('la base impide dos turnos en curso, no sólo el servicio', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await openShift(receptionist, { type: ShiftType.DIA });

    const date = new Date();
    date.setHours(0, 0, 0, 0);

    await expect(
      prisma.shift.create({
        data: {
          date,
          type: ShiftType.NOCHE,
          status: ShiftStatus.ACTIVO,
          plannedStart: date,
          plannedEnd: date,
        },
      }),
    ).rejects.toThrow();
  });

  it('el Administrador de sistema sigue fuera del ciclo de turnos', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    await expect(openShift(admin, { type: ShiftType.DIA })).rejects.toThrow(
      /no participa en la operación de turnos/,
    );
  });

  it('reutiliza un turno programado a mano en lugar de crear otro', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const programado = await createShift({ type: ShiftType.DIA, status: ShiftStatus.PROGRAMADO });
    await prisma.shift.update({
      where: { id: programado.id },
      data: { notes: 'Cobertura pedida por el supervisor', createdById: supervisor.id },
    });

    const { shift } = await openShift(receptionist, { type: ShiftType.DIA });

    expect(shift.id).toBe(programado.id);
    expect(shift.notes).toBe('Cobertura pedida por el supervisor');
    expect(await prisma.shift.count()).toBe(1);
  });

  /* ------------------------- Sumar gente al turno ------------------------- */

  it('quien está en el turno puede sumar a otra persona', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const refuerzo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    const { shift } = await openShift(titular, { type: ShiftType.DIA });
    await addShiftMember(titular, { shiftId: shift.id, userId: refuerzo.id });

    const actualizado = await prisma.shift.findUniqueOrThrow({
      where: { id: shift.id },
      include: { assignments: true },
    });
    expect(actualizado.assignments).toHaveLength(2);
  });

  it('el supervisor puede sumar gente sin estar en el turno', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const refuerzo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    const { shift } = await openShift(titular, { type: ShiftType.DIA });
    await addShiftMember(supervisor, { shiftId: shift.id, userId: refuerzo.id });

    expect(
      await prisma.shiftAssignment.count({ where: { shiftId: shift.id } }),
    ).toBe(2);
  });

  it('un tercero sin permiso no puede meter gente en un turno ajeno', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const ajeno = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Carla' });
    const victima = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    const { shift } = await openShift(titular, { type: ShiftType.DIA });

    await expect(
      addShiftMember(ajeno, { shiftId: shift.id, userId: victima.id }),
    ).rejects.toThrow(RuleError);
  });

  it('no se puede sumar gente a un turno ya terminado', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const refuerzo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    const { shift } = await openShift(titular, { type: ShiftType.DIA });
    await receiveHandover(titular, { shiftId: shift.id });
    await closeShift(titular, { shiftId: shift.id });

    await expect(
      addShiftMember(titular, { shiftId: shift.id, userId: refuerzo.id }),
    ).rejects.toThrow(/ya terminó/);
  });

  it('un rol no operativo no se puede sumar al turno', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    const { shift } = await openShift(titular, { type: ShiftType.DIA });
    await expect(
      addShiftMember(titular, { shiftId: shift.id, userId: admin.id }),
    ).rejects.toThrow(/no participa en la operación/);
  });

  /* ---------------- El relevo: lo que estaba roto de verdad ---------------- */

  /*
    Ésta es LA prueba del fallo reportado. Antes de la corrección, el segundo
    turno no encontraba la entrega del primero —la buscaba por adyacencia de
    franjas— y no había forma de recibir ni de cerrar.
  */
  it('el relevo completo funciona: entrego, queda en la bandeja, el siguiente lo recibe', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    // Turno 1: abre, activa y entrega.
    const { shift: primero } = await openShift(saliente, { type: ShiftType.DIA });
    await receiveHandover(saliente, { shiftId: primero.id });
    const draft = await prepareHandover(saliente, primero.id);
    await sendHandover(saliente, { shiftId: primero.id, notes: 'Todo en orden.' });

    // El cierre queda en la bandeja, sin destino: el relevo aún no existe.
    const enBandeja = await getShiftsAwaitingReceipt();
    expect(enBandeja).toHaveLength(1);
    expect(enBandeja[0]!.id).toBe(primero.id);

    const pendiente = await getPendingHandover();
    expect(pendiente?.id).toBe(draft.id);
    expect(pendiente?.toShiftId).toBeNull();

    // Un turno ENTREGA_ENVIADA no bloquea: el relevo puede abrir el suyo.
    const { shift: segundo, joined } = await openShift(entrante, { type: ShiftType.NOCHE });
    expect(joined).toBe(false);
    expect(segundo.id).not.toBe(primero.id);

    // Y encuentra la entrega. Esto es lo que antes devolvía null.
    const paraRecibir = await getPendingHandover(segundo.id);
    expect(paraRecibir?.id).toBe(draft.id);

    await receiveHandover(entrante, {
      shiftId: segundo.id,
      handoverId: draft.id,
      observations: 'Recibido conforme.',
    });

    const recibida = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: draft.id } });
    expect(recibida.status).toBe(HandoverStatus.RECIBIDA);
    expect(recibida.receivedById).toBe(entrante.id);
    // Al recibirla se escribe el destino real, que antes se intentaba adivinar.
    expect(recibida.toShiftId).toBe(segundo.id);

    // El turno que entregó quedó cerrado, y el nuevo está activo.
    const cerrado = await prisma.shift.findUniqueOrThrow({ where: { id: primero.id } });
    expect(cerrado.status).toBe(ShiftStatus.CERRADO);
    const activo = await getCurrentShift();
    expect(activo?.id).toBe(segundo.id);
    expect(activo?.status).toBe(ShiftStatus.ACTIVO);
  });

  it('el primer turno del hotel se activa sin entrega previa y lo deja registrado', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const { shift } = await openShift(receptionist, { type: ShiftType.DIA });

    expect(await getPendingHandover(shift.id)).toBeNull();
    await receiveHandover(receptionist, { shiftId: shift.id });

    const activo = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(activo.status).toBe(ShiftStatus.ACTIVO);
  });

  it('una entrega no se puede recibir dos veces', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });
    const tercero = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Carla' });

    const { shift: primero } = await openShift(saliente, { type: ShiftType.DIA });
    await receiveHandover(saliente, { shiftId: primero.id });
    const draft = await prepareHandover(saliente, primero.id);
    await sendHandover(saliente, { shiftId: primero.id });

    const { shift: segundo } = await openShift(entrante, { type: ShiftType.NOCHE });
    await receiveHandover(entrante, { shiftId: segundo.id, handoverId: draft.id });

    // Otro turno más tarde no puede volver a recibir la misma entrega.
    await sendHandoverLater(segundo.id, entrante);
    const { shift: tercerTurno } = await openShift(tercero, { type: ShiftType.DIA });
    await expect(
      receiveHandover(tercero, { shiftId: tercerTurno.id, handoverId: draft.id }),
    ).rejects.toThrow(/ya fue recibida/);
  });

  /* ------------------------------- La mesa -------------------------------- */

  it('la pizarra dice si hay turno abierto y si estoy dentro', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Ana' });
    const afuera = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto' });

    const vacia = await getShiftDesk(titular);
    expect(vacia.current).toBeNull();
    expect(vacia.iAmIn).toBe(false);

    await openShift(titular, { type: ShiftType.DIA });

    const mia = await getShiftDesk(titular);
    expect(mia.current).not.toBeNull();
    expect(mia.iAmIn).toBe(true);

    const ajena = await getShiftDesk(afuera);
    expect(ajena.current).not.toBeNull();
    expect(ajena.iAmIn).toBe(false);
  });

  it('quien entregó sigue viendo su turno hasta que alguien lo reciba', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const { shift } = await openShift(saliente, { type: ShiftType.DIA });
    await receiveHandover(saliente, { shiftId: shift.id });
    await prepareHandover(saliente, shift.id);
    await sendHandover(saliente, { shiftId: shift.id });

    const mio = await getMyOpenShift(saliente.id);
    expect(mio?.id).toBe(shift.id);
    expect(mio?.status).toBe(ShiftStatus.ENTREGA_ENVIADA);
  });

  /* ------------------------------ Archivar -------------------------------- */

  it('un turno archivado conserva su estado, su fecha y su historia', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const shift = await createShift({
      type: ShiftType.DIA,
      status: ShiftStatus.CERRADO,
      dayOffset: -3,
    });

    await prisma.shift.update({
      where: { id: shift.id },
      data: { archivedAt: new Date(), archivedById: supervisor.id },
    });

    const archivado = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(archivado.archivedAt).not.toBeNull();
    // Archivar no es borrar: el turno sigue ahí, con todo lo suyo.
    expect(archivado.status).toBe(ShiftStatus.CERRADO);
    expect(archivado.date.getTime()).toBe(shift.date.getTime());
    expect(archivado.type).toBe(ShiftType.DIA);
  });

  it('un turno archivado no se reutiliza al abrir uno nuevo', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const archivado = await createShift({
      type: ShiftType.DIA,
      status: ShiftStatus.PROGRAMADO,
    });
    await prisma.shift.update({
      where: { id: archivado.id },
      data: { archivedAt: new Date() },
    });

    const { shift } = await openShift(receptionist, { type: ShiftType.DIA });
    expect(shift.id).not.toBe(archivado.id);
  });
});

/** Cierra el turno dado enviando su entrega, para poder abrir otro después. */
async function sendHandoverLater(
  shiftId: string,
  user: Awaited<ReturnType<typeof createUser>>,
) {
  await prepareHandover(user, shiftId);
  await sendHandover(user, { shiftId });
}
