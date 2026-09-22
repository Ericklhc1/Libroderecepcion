import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GuaranteeState, GuaranteeStatus, RoomStayStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import {
  changeGuaranteeState,
  createGuarantee,
  listOpenGuarantees,
  softDeleteGuarantee,
} from '@/server/services/guarantees';
import { runAlertEngine } from '@/server/services/alert-engine';
import { getSupervisionData } from '@/server/services/supervision';
import { RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { getLiveCashState } from '@/server/services/live-cash';

/**
 * Garantías como entidad.
 *
 * La garantía cuelga de la **reserva**, así que sobrevive a los turnos y a un
 * cambio de habitación. `ReservationReference.guaranteeStatus` se conserva
 * —lo leen el motor de alertas y la entrega de turno— y este servicio es el
 * único que lo escribe a partir de las garantías.
 */
describe('garantías', () => {
  let user: CurrentUser;

  const reserva = async (options: { code: string; checkOut?: Date | null } = { code: 'R-1' }) =>
    prisma.reservationReference.create({
      data: {
        code: options.code,
        roomNumber: '404',
        checkOut: options.checkOut ?? null,
      },
      select: { id: true, code: true },
    });

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('se registra sobre la reserva con su monto y moneda', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 100000,
      currency: 'clp',
      state: GuaranteeState.VIGENTE,
    });

    const guarantee = await prisma.guarantee.findUniqueOrThrow({ where: { id } });
    expect(guarantee.state).toBe(GuaranteeState.VIGENTE);
    expect(guarantee.amount.toNumber()).toBe(100000);
    expect(guarantee.currency).toBe('CLP'); // normalizada a mayúsculas
    expect(guarantee.createdById).toBe(user.id);
  });

  it('acepta otra moneda además de CLP', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'EFECTIVO',
      amount: 150,
      currency: 'USD',
    });
    const guarantee = await prisma.guarantee.findUniqueOrThrow({ where: { id } });
    expect(guarantee.currency).toBe('USD');
  });

  it('la garantía en efectivo conserva la estadía exacta en Caja', async () => {
    const r = await reserva({ code: 'R-CONTEXTO' });
    const room = await prisma.room.findFirstOrThrow({ where: { number: '404' } });
    const stay = await prisma.roomStay.create({
      data: {
        businessDate: new Date(2026, 8, 19),
        roomId: room.id,
        reservationId: r.code,
        reservationRefId: r.id,
        guestNames: ['Huésped contexto'],
        status: RoomStayStatus.IN_HOUSE,
        sourceReport: 'IN_HOUSE',
      },
    });

    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      stayId: stay.id,
      kind: 'EFECTIVO',
      amount: 75_000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    const guarantee = await prisma.guarantee.findUniqueOrThrow({ where: { id } });
    expect(guarantee.stayId).toBe(stay.id);

    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: { guaranteeId: id, kind: 'GARANTIA_INGRESO' },
    });
    expect(movement.stayId).toBe(stay.id);
    expect(movement.roomId).toBe(room.id);
    expect(movement.reservationReferenceId).toBe(r.id);
  });

  it('no adivina una estadía para efectivo si la reserva ocupa varias habitaciones', async () => {
    const r = await reserva({ code: 'R-MULTI' });
    const room404 = await prisma.room.findFirstOrThrow({ where: { number: '404' } });
    const room412 = await prisma.room.findFirstOrThrow({ where: { number: '412' } });

    await prisma.roomStay.createMany({
      data: [
        {
          businessDate: new Date(2026, 8, 19),
          roomId: room404.id,
          reservationId: r.code,
          reservationRefId: r.id,
          guestNames: ['Huésped A'],
          status: RoomStayStatus.IN_HOUSE,
          sourceReport: 'IN_HOUSE',
        },
        {
          businessDate: new Date(2026, 8, 19),
          roomId: room412.id,
          reservationId: r.code,
          reservationRefId: r.id,
          guestNames: ['Huésped B'],
          status: RoomStayStatus.IN_HOUSE,
          sourceReport: 'IN_HOUSE',
        },
      ],
    });

    await expect(
      createGuarantee(user, {
        reservationReferenceId: r.id,
        kind: 'EFECTIVO',
        amount: 50_000,
        currency: 'CLP',
        state: GuaranteeState.VIGENTE,
      }),
    ).rejects.toThrow(/varias estadías activas/);
  });

  it('sincroniza el resumen de la reserva sin que nadie más lo escriba', async () => {
    const r = await reserva();

    const pendiente = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 50000,
      currency: 'CLP',
      state: GuaranteeState.PENDIENTE,
    });
    let reservation = await prisma.reservationReference.findUniqueOrThrow({ where: { id: r.id } });
    expect(reservation.guaranteeStatus).toBe(GuaranteeStatus.PENDIENTE);

    await changeGuaranteeState(user, { id: pendiente.id, state: GuaranteeState.VIGENTE });
    reservation = await prisma.reservationReference.findUniqueOrThrow({ where: { id: r.id } });
    expect(reservation.guaranteeStatus).toBe(GuaranteeStatus.VALIDADA);
  });

  it('una reserva sin garantías conserva el resumen que puso una persona', async () => {
    /*
      El campo existía antes que esta entidad. Derivar NO_REQUIERE sobre una
      reserva que nunca tuvo garantía borraría una decisión humana, así que la
      derivación devuelve `null` —no tocar— cuando no hay ninguna.
    */
    const sinGarantia = await reserva({ code: 'R-MANUAL' });
    await prisma.reservationReference.update({
      where: { id: sinGarantia.id },
      data: { guaranteeStatus: GuaranteeStatus.PENDIENTE },
    });

    // Se registra una garantía en OTRA reserva: la primera no se toca.
    const otra = await reserva({ code: 'R-OTRA' });
    await createGuarantee(user, {
      reservationReferenceId: otra.id,
      kind: 'TARJETA',
      amount: 1000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    const reservation = await prisma.reservationReference.findUniqueOrThrow({
      where: { id: sinGarantia.id },
    });
    expect(reservation.guaranteeStatus).toBe(GuaranteeStatus.PENDIENTE);
  });

  it('al eliminar la última garantía el resumen no se reinventa', async () => {
    /*
      Comportamiento deliberado: registrar una garantía vigente pone VALIDADA,
      y eliminarla después deja ese valor. No se vuelve a NO_REQUIERE porque el
      sistema no puede saber qué había antes, y adivinarlo sería peor que
      dejarlo. Corregirlo es tarea de quien administra la reserva.
    */
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 1000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });
    expect(
      (await prisma.reservationReference.findUniqueOrThrow({ where: { id: r.id } }))
        .guaranteeStatus,
    ).toBe(GuaranteeStatus.VALIDADA);

    await softDeleteGuarantee(user, { id, reason: 'registrada por error' });
    expect(
      (await prisma.reservationReference.findUniqueOrThrow({ where: { id: r.id } }))
        .guaranteeStatus,
    ).toBe(GuaranteeStatus.VALIDADA);
  });

  it('respeta las transiciones: una devuelta no vuelve a estar vigente', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 100000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await changeGuaranteeState(user, { id, state: GuaranteeState.DEVUELTA });
    await expect(
      changeGuaranteeState(user, { id, state: GuaranteeState.VIGENTE }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it('aplicarla parcialmente exige monto y motivo', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 100000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await expect(
      changeGuaranteeState(user, { id, state: GuaranteeState.APLICADA_PARCIALMENTE }),
    ).rejects.toBeInstanceOf(RuleError);

    await expect(
      changeGuaranteeState(user, {
        id,
        state: GuaranteeState.APLICADA_PARCIALMENTE,
        appliedAmount: 30000,
      }),
    ).rejects.toBeInstanceOf(RuleError);

    await changeGuaranteeState(user, {
      id,
      state: GuaranteeState.APLICADA_PARCIALMENTE,
      appliedAmount: 30000,
      applicationReason: 'consumo de minibar',
    });
    const guarantee = await prisma.guarantee.findUniqueOrThrow({ where: { id } });
    expect(guarantee.appliedAmount?.toNumber()).toBe(30000);
  });

  it('una garantía en efectivo parcialmente aplicada conserva sólo el remanente como custodia', async () => {
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    const r = await reserva({ code: 'R-CUSTODIA' });
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'EFECTIVO',
      amount: 100_000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await changeGuaranteeState(user, {
      id,
      state: GuaranteeState.APLICADA_PARCIALMENTE,
      appliedAmount: 30_000,
      applicationReason: 'Consumo imputado',
    });

    const state = await getLiveCashState();
    const clp = state.currencies.find((row) => row.currency === 'CLP');
    const guarantee = state.cashGuarantees.find((row) => row.id === id);

    expect(guarantee?.amount).toBe(70_000);
    expect(guarantee?.originalAmount).toBe(100_000);
    expect(clp?.guaranteeCustody).toBe(70_000);
    expect(clp?.operational).toBe(30_000);
    expect(clp?.expected).toBe(200_000);
  });

  it('una multa parcial devuelve el remanente y deja sólo lo retenido como saldo operacional', async () => {
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    const r = await reserva({ code: 'R-MULTA-PARCIAL' });
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'EFECTIVO',
      amount: 100_000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await changeGuaranteeState(user, {
      id,
      state: GuaranteeState.MULTA,
      penaltyAmount: 25_000,
      notes: 'Daño documentado',
    });

    const out = await prisma.cashMovement.findFirstOrThrow({
      where: { guaranteeId: id, kind: 'GARANTIA_DEVOLUCION' },
    });
    expect(out.amount.toNumber()).toBe(75_000);

    const state = await getLiveCashState();
    const clp = state.currencies.find((row) => row.currency === 'CLP');
    expect(state.cashGuarantees.find((row) => row.id === id)).toBeUndefined();
    expect(clp?.guaranteeCustody).toBe(0);
    expect(clp?.operational).toBe(25_000);
    expect(clp?.expected).toBe(125_000);
  });

  it('no se puede aplicar ni multar más de lo tomado', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 50000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await expect(
      changeGuaranteeState(user, {
        id,
        state: GuaranteeState.APLICADA_PARCIALMENTE,
        appliedAmount: 60000,
        applicationReason: 'daños',
      }),
    ).rejects.toBeInstanceOf(RuleError);
  });

  it('no permite cerrar una garantía en efectivo si todavía queda saldo reembolsable', async () => {
    const r = await reserva({ code: 'R-CIERRE-EFECTIVO' });
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'EFECTIVO',
      amount: 50_000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await expect(
      changeGuaranteeState(user, { id, state: GuaranteeState.CERRADA }),
    ).rejects.toThrow(/saldo reembolsable/i);
  });

  it('devolverla registra quién y cuándo', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'EFECTIVO',
      amount: 20000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    await changeGuaranteeState(user, { id, state: GuaranteeState.DEVUELTA });
    const guarantee = await prisma.guarantee.findUniqueOrThrow({ where: { id } });
    expect(guarantee.returnedById).toBe(user.id);
    expect(guarantee.returnedAt).not.toBeNull();
  });

  it('cada cambio queda en la auditoría, sin tabla de historial propia', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 100000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });
    await changeGuaranteeState(user, { id, state: GuaranteeState.DEVUELTA });

    const auditoria = await prisma.auditLog.findMany({
      where: { entity: 'Guarantee', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, summary: true, userId: true },
    });
    expect(auditoria).toHaveLength(2);
    expect(auditoria[0]!.action).toBe('CREAR');
    expect(auditoria[1]!.action).toBe('CAMBIO_ESTADO');
    expect(auditoria.every((linea) => linea.userId === user.id)).toBe(true);
  });

  it('la eliminada no aparece entre las abiertas', async () => {
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 1000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });
    expect(await listOpenGuarantees()).toHaveLength(1);

    await softDeleteGuarantee(user, { id, reason: 'duplicada' });
    expect(await listOpenGuarantees()).toHaveLength(0);
  });

  describe('alertas', () => {
    it('una garantía sin tomar genera GARANTIA_PENDIENTE, idempotente', async () => {
      const r = await reserva();
      await createGuarantee(user, {
        reservationReferenceId: r.id,
        kind: 'TARJETA',
        amount: 100000,
        currency: 'CLP',
        state: GuaranteeState.PENDIENTE,
      });

      await runAlertEngine();
      const primera = await prisma.alert.count({ where: { type: 'GARANTIA_PENDIENTE' } });
      expect(primera).toBeGreaterThan(0);

      // Repetir el motor no duplica: el dedupeKey es estable.
      await runAlertEngine();
      expect(await prisma.alert.count({ where: { type: 'GARANTIA_PENDIENTE' } })).toBe(primera);
    });

    it('la salida con garantía abierta genera la alerta crítica y se resuelve sola', async () => {
      const ayer = new Date(Date.now() - 24 * 3_600_000);
      const r = await reserva({ code: 'R-SALIDA', checkOut: ayer });
      const { id } = await createGuarantee(user, {
        reservationReferenceId: r.id,
        kind: 'TARJETA',
        amount: 100000,
        currency: 'CLP',
        state: GuaranteeState.VIGENTE,
      });

      await runAlertEngine();
      const alerta = await prisma.alert.findFirst({
        where: { type: 'GARANTIA_SIN_RESOLVER_EN_SALIDA' },
      });
      expect(alerta).not.toBeNull();
      expect(alerta?.level).toBe('CRITICA');
      expect(alerta?.guaranteeId).toBe(id);

      // Resolver la garantía apaga la alerta sin que nadie la toque.
      await changeGuaranteeState(user, { id, state: GuaranteeState.DEVUELTA });
      await runAlertEngine();
      const despues = await prisma.alert.findFirstOrThrow({
        where: { type: 'GARANTIA_SIN_RESOLVER_EN_SALIDA' },
      });
      expect(despues.status).toBe('RESUELTA');
    });

    it('un saldo pendiente genera SALDO_PENDIENTE y se apaga al cobrarlo', async () => {
      const r = await reserva({ code: 'R-SALDO', checkOut: null });
      await prisma.reservationReference.update({
        where: { id: r.id },
        data: { balanceDue: 45000 },
      });

      await runAlertEngine();
      expect(await prisma.alert.count({ where: { type: 'SALDO_PENDIENTE' } })).toBe(1);

      await prisma.reservationReference.update({ where: { id: r.id }, data: { balanceDue: 0 } });
      await runAlertEngine();
      const alerta = await prisma.alert.findFirstOrThrow({ where: { type: 'SALDO_PENDIENTE' } });
      expect(alerta.status).toBe('RESUELTA');
    });
  });

  it('Supervisión muestra las garantías por resolver', async () => {
    const ayer = new Date(Date.now() - 24 * 3_600_000);
    const r = await reserva({ code: 'R-SUP', checkOut: ayer });
    await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 100000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    const { blocks } = await getSupervisionData();
    const bloque = blocks.find((block) => block.key === 'garantias');
    expect(bloque).toBeDefined();
    expect(bloque?.rows).toHaveLength(1);
    expect(bloque?.rows[0]!.ref).toBe('Reserva R-SUP');
    expect(bloque?.rows[0]!.meta).toContain('salida vencida');
  });

  it('sobrevive a un cambio de habitación: cuelga de la reserva', async () => {
    /*
      La garantía no referencia la habitación en ningún punto. Mover la
      estadía de habitación no la toca, que es el comportamiento que hace
      falta para el cambio de habitación de la fase siguiente.
    */
    const r = await reserva();
    const { id } = await createGuarantee(user, {
      reservationReferenceId: r.id,
      kind: 'TARJETA',
      amount: 100000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    const origen = await prisma.room.findFirstOrThrow({ where: { number: '404' } });
    const destino = await prisma.room.findFirstOrThrow({ where: { number: '412' } });
    const stay = await prisma.roomStay.create({
      data: {
        businessDate: new Date(2026, 8, 15),
        roomId: origen.id,
        reservationId: r.code,
        reservationRefId: r.id,
        guestNames: ['Huésped'],
        status: RoomStayStatus.IN_HOUSE,
        sourceReport: 'IN_HOUSE',
      },
      select: { id: true },
    });

    await prisma.roomStay.update({ where: { id: stay.id }, data: { roomId: destino.id } });

    const guarantee = await prisma.guarantee.findUniqueOrThrow({
      where: { id },
      select: { state: true, reservationReferenceId: true },
    });
    expect(guarantee.state).toBe(GuaranteeState.VIGENTE);
    expect(guarantee.reservationReferenceId).toBe(r.id);
  });
});
