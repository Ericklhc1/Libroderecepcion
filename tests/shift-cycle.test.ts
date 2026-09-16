import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import {
  cancelHandoverPreparation,
  closeShift,
  getPendingHandover,
  getMyOpenShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Ciclo completo del turno contra la base de datos real. Cubre tanto el camino
 * feliz como cada estado contradictorio que el sistema debe bloquear.
 */
describe('ciclo de turno de punta a punta', () => {
  let morning: CurrentUser;
  let evening: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    morning = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno mañana' });
    evening = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno tarde' });
  });

  it('recorre programado → iniciado → activo → entrega → recibido → cerrado', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.DIA });

    // 1. Inicio de turno
    const started = await openShiftAs(morning, shiftA);
    expect(started.status).toBe(ShiftStatus.INICIADO);
    expect(started.actualStart).not.toBeNull();
    expect(started.startedById).toBe(morning.id);

    // 2. No hay entrega previa: el turno se activa y queda constancia
    const activated = await receiveHandover(morning, { shiftId: shiftA.id });
    expect(activated.status).toBe(ShiftStatus.ACTIVO);
    const activationLog = await prisma.auditLog.findFirst({
      where: { entity: 'Shift', entityId: shiftA.id, action: 'TURNO_RECIBIR' },
    });
    expect(activationLog?.summary).toContain('sin entrega previa');

    // 3. Preparación de la entrega
    const draft = await prepareHandover(morning, shiftA.id);
    expect(draft.status).toBe(HandoverStatus.BORRADOR);
    /*
      REVISADO: el destino ya NO se adivina al preparar la entrega. Cuando
      alguien entrega, el turno que va a recibir todavía no existe. Queda nulo
      y lo escribe quien la recibe. Intentar deducirlo por adyacencia de
      franjas era la causa de que no se pudiera recibir.
    */
    expect(draft.toShiftId).toBeNull();
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } })).status).toBe(
      ShiftStatus.PREPARANDO_ENTREGA,
    );

    // 4. Envío
    const sent = await sendHandover(morning, {
      shiftId: shiftA.id,
      notes: 'Pendiente la 318 con mantenimiento.',
    });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
    expect(sent.issuedById).toBe(morning.id);
    expect(sent.issuedAt).not.toBeNull();
    expect(sent.snapshot).not.toBeNull();
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } })).status).toBe(
      ShiftStatus.ENTREGA_ENVIADA,
    );

    // El turno entrante ve la entrega como pendiente de recibir
    const incoming = await getPendingHandover(shiftB.id);
    expect(incoming?.id).toBe(sent.id);

    // 5. Recepción por el turno siguiente
    await openShiftAs(evening, shiftB);
    const received = await receiveHandover(evening, {
      shiftId: shiftB.id,
      handoverId: sent.id,
      observations: 'Recibido conforme.',
    });
    expect(received.status).toBe(ShiftStatus.ACTIVO);

    const confirmed = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: sent.id } });
    expect(confirmed.status).toBe(HandoverStatus.RECIBIDA);
    expect(confirmed.receivedById).toBe(evening.id);
    expect(confirmed.receivedAt).not.toBeNull();
    expect(confirmed.receiverObservations).toBe('Recibido conforme.');

    // 6. El turno saliente se cierra al confirmarse la recepción
    const closedA = await prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } });
    expect(closedA.status).toBe(ShiftStatus.CERRADO);

    // Y el emisor recibe el aviso de que su entrega fue recibida
    const notification = await prisma.notification.findFirst({
      where: { userId: morning.id, entity: 'ShiftHandover' },
    });
    expect(notification?.title).toContain('recibida');
  });

  it('notifica al turno entrante cuando la entrega se envía', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await createShift({ userId: evening.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    const notification = await prisma.notification.findFirst({
      where: { userId: evening.id, type: 'ENTREGA_DISPONIBLE' },
    });
    expect(notification).not.toBeNull();
  });

  it('el resumen automático se regenera y conserva las notas manuales', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });

    const draft = await prepareHandover(morning, shiftA.id);
    await prisma.handoverItem.create({
      data: {
        handoverId: draft.id,
        level: 'IMPORTANTE',
        section: 'Observaciones del turno',
        title: 'Llave del ascensor de servicio en recepción',
        manual: true,
        order: 9999,
      },
    });

    await prepareHandover(morning, shiftA.id);

    const items = await prisma.handoverItem.findMany({ where: { handoverId: draft.id } });
    expect(items.filter((i) => i.manual)).toHaveLength(1);
    expect(items.find((i) => i.manual)?.title).toContain('ascensor de servicio');
  });
});

describe('invariantes del turno', () => {
  let morning: CurrentUser;
  let evening: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    morning = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno mañana' });
    evening = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Turno tarde' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('no permite iniciar dos veces el mismo turno', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);

    /*
      REVISADO DOS VECES, y esta versión es la que pidió el hotel. Entrar al
      mesón cuando ya tienes turno abierto no es un error: te devuelve TU
      turno. Lo que la invariante protege es que no se inicie dos veces —un
      solo TURNO_INICIAR, un solo `actualStart`— no que la segunda pulsación
      falle. Un error ahí sólo confundiría a quien recarga la pantalla.
    */
    const otraVez = await openShiftAs(morning, shift);
    expect(otraVez.id).toBe(shift.id);

    const started = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(started.status).toBe(ShiftStatus.INICIADO);
    expect(
      await prisma.auditLog.count({
        where: { entityId: shift.id, action: 'TURNO_INICIAR' },
      }),
    ).toBe(1);
  });

  /*
    REVISADO. La regla era «un turno abierto por usuario»; ahora es más fuerte:
    UN TURNO ABIERTO EN TODO EL HOTEL. Y no se expresa con un error, sino
    devolviendo el turno vigente: pedir abrir otro te mete en el que hay.
  */
  it('no hay dos turnos abiertos: pedir otro devuelve el vigente', async () => {
    const first = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const second = await createShift({ userId: morning.id, type: ShiftType.DIA });

    const abierto = await openShiftAs(morning, first);
    const otro = await openShiftAs(morning, second);

    expect(otro.id).toBe(abierto.id);
    expect(
      await prisma.shift.count({
        where: { status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA'] } },
      }),
    ).toBe(1);
  });

  /*
    DECISIÓN REVISADA. Antes esta prueba exigía estar asignado para iniciar un
    turno. Esa regla se eliminó a propósito: los turnos no se reparten de
    antemano y quien llega al mesón toma el que corresponde. La prueba se
    reemplaza por la invariante que SÍ sobrevive, que es la que de verdad
    protege la operación: un turno que alguien ya tomó no se le puede quitar.
  */
  it('quien no estaba asignado puede abrir un turno programado para otro', async () => {
    // El turno viene con `morning` apuntado por quien lo programó.
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });

    const taken = await openShiftAs(evening, shift);

    // Lo abre quien llegó, no quien estaba apuntado: eso es lo que importa.
    expect(taken.startedById).toBe(evening.id);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id, userId: evening.id },
    });
    /*
      Queda como APOYO, y es correcto: el turno ya tenía a alguien apuntado
      como titular. El papel lo decide lo que ya hay en el turno, no quién
      pulsa el botón.
    */
    expect(assignment.role).toBe('APOYO');
  });

  /*
    REVISADO. Antes el segundo recibía un error. Ahora SE SUMA al turno, que es
    lo que pasa de verdad en el mesón cuando entra el refuerzo. La invariante
    que sobrevive, y la que importa, es que el TITULAR no cambia: quien abrió
    el turno sigue respondiendo por la caja.
  */
  it('quien llega después se suma, y el titular sigue siendo quien abrió', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);

    const mismo = await openShiftAs(evening, shift);
    expect(mismo.id).toBe(shift.id);

    const current = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(current.startedById).toBe(morning.id);

    const apoyo = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: shift.id, userId: evening.id },
    });
    expect(apoyo.role).toBe('APOYO');
  });

  it('no permite recibir una entrega inexistente', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);

    await expect(
      receiveHandover(morning, { shiftId: shift.id, handoverId: 'no-existe' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('no permite recibir dos veces la misma entrega', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });

    await openShiftAs(evening, shiftB);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });

    // Segundo intento sobre la misma entrega, ya confirmada.
    await expect(
      receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id }),
    ).rejects.toThrow(/ya fue recibida/);
  });

  /*
    REVISADO. Antes «no corresponde» significaba «no es la franja siguiente».
    Eso desapareció con la adyacencia: cualquier turno puede recibir el cierre
    que esté en la bandeja, y es lo que arregla el atasco. Lo que sigue sin
    poder hacerse es recibir una entrega que NO es la pendiente: por ejemplo
    la propia, o una ya cerrada.
  */
  it('un turno no puede recibir su propia entrega', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });

    await expect(
      receiveHandover(morning, { shiftId: shiftA.id, handoverId: sent.id }),
    ).rejects.toThrow(RuleError);
  });

  /*
    REVISADO, y es la corrección del fallo reportado. Antes cerrar exigía que
    el turno siguiente existiera como fila; con los turnos creados a voluntad
    no existe, así que el cierre quedaba trabado. Ahora un turno activo que no
    entregó a nadie SÍ se puede cerrar: hay turnos que no relevan a nadie.
  */
  it('un turno activo sin entrega se puede cerrar', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });

    const closed = await closeShift(morning, { shiftId: shiftA.id });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
  });

  it('mientras el cierre espera en la bandeja, el turno no se cierra a mano', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    await expect(closeShift(morning, { shiftId: shiftA.id })).rejects.toThrow(/bandeja/);
  });

  it('permite cerrar sin entrega cuando no hay nada que entregar', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });

    const closed = await closeShift(morning, { shiftId: shift.id, notes: 'Sin novedades.' });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
    expect(closed.actualEnd).not.toBeNull();
    expect(closed.closedById).toBe(morning.id);
  });

  it('no permite enviar una entrega inexistente ni enviarla dos veces', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });

    await expect(sendHandover(morning, { shiftId: shift.id })).rejects.toThrow(
      /primero debes preparar la entrega/i,
    );

    await prepareHandover(morning, shift.id);
    await sendHandover(morning, { shiftId: shift.id });
    await expect(sendHandover(morning, { shiftId: shift.id })).rejects.toThrow(
      /ya fue enviada/,
    );
  });

  it('cada turno emite como máximo una entrega', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    const first = await prepareHandover(morning, shift.id);
    const second = await prepareHandover(morning, shift.id);

    // Preparar de nuevo reutiliza el borrador: no crea una segunda entrega.
    expect(second.id).toBe(first.id);
    expect(await prisma.shiftHandover.count({ where: { fromShiftId: shift.id } })).toBe(1);

    // Y la base rechaza cualquier intento de duplicarla.
    await expect(
      prisma.shiftHandover.create({
        data: { fromShiftId: shift.id, issuedById: morning.id },
      }),
    ).rejects.toThrow();
  });

  it('una entrega siempre tiene emisor y turno de origen', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    const handover = await prepareHandover(morning, shift.id);

    expect(handover.fromShiftId).toBe(shift.id);
    expect(handover.issuedById).toBe(morning.id);

    // El esquema no admite entregas huérfanas.
    await expect(
      prisma.shiftHandover.create({
        data: { fromShiftId: 'inexistente', issuedById: morning.id },
      }),
    ).rejects.toThrow();
  });

  it('sólo el personal del turno puede preparar o enviar su entrega', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });

    await expect(prepareHandover(evening, shift.id)).rejects.toThrow(
      /Sólo quien está en el turno/,
    );
  });

  it('permite cancelar la preparación y volver al turno activo', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });
    await prepareHandover(morning, shift.id);

    const reverted = await cancelHandoverPreparation(morning, shift.id);
    expect(reverted.status).toBe(ShiftStatus.ACTIVO);
    expect(await prisma.shiftHandover.count({ where: { fromShiftId: shift.id } })).toBe(0);
  });

  it('no permite cancelar una entrega ya enviada', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await createShift({ userId: evening.id, type: ShiftType.DIA });
    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    await sendHandover(morning, { shiftId: shiftA.id });

    await expect(cancelHandoverPreparation(morning, shiftA.id)).rejects.toThrow(RuleError);
  });

  it('el supervisor puede cerrar el turno de otra persona', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });

    const closed = await closeShift(supervisor, { shiftId: shift.id });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
    expect(closed.closedById).toBe(supervisor.id);
  });

  it('un tercero sin permisos de supervisión no puede cerrar un turno ajeno', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    await openShiftAs(morning, shift);
    await receiveHandover(morning, { shiftId: shift.id });

    await expect(closeShift(evening, { shiftId: shift.id })).rejects.toThrow(
      /Sólo quien está en el turno o un supervisor/,
    );
  });

  it('getMyOpenShift devuelve el turno vigente y nada cuando está cerrado', async () => {
    const shift = await createShift({ userId: morning.id, type: ShiftType.DIA });
    expect(await getMyOpenShift(morning.id)).toBeNull();

    await openShiftAs(morning, shift);
    expect((await getMyOpenShift(morning.id))?.id).toBe(shift.id);

    await receiveHandover(morning, { shiftId: shift.id });
    await closeShift(morning, { shiftId: shift.id });
    expect(await getMyOpenShift(morning.id)).toBeNull();
  });

  it('registra en auditoría cada paso del ciclo', async () => {
    const shiftA = await createShift({ userId: morning.id, type: ShiftType.DIA });
    const shiftB = await createShift({ userId: evening.id, type: ShiftType.DIA });

    await openShiftAs(morning, shiftA);
    await receiveHandover(morning, { shiftId: shiftA.id });
    await prepareHandover(morning, shiftA.id);
    const sent = await sendHandover(morning, { shiftId: shiftA.id });
    await openShiftAs(evening, shiftB);
    await receiveHandover(evening, { shiftId: shiftB.id, handoverId: sent.id });

    const actions = await prisma.auditLog.findMany({
      where: { entity: { in: ['Shift', 'ShiftHandover'] } },
      select: { action: true },
    });
    const kinds = new Set(actions.map((a) => a.action));

    expect(kinds).toContain('TURNO_INICIAR');
    expect(kinds).toContain('TURNO_RECIBIR');
    expect(kinds).toContain('TURNO_ENTREGAR');
    expect(kinds).toContain('TURNO_CERRAR');
    expect(kinds).toContain('CAMBIO_ESTADO');
  });
});
