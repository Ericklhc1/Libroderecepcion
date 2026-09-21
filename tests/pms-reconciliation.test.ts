import { describe, expect, it } from 'vitest';
import {
  decideStayReconciliation,
  reconcileStayState,
  type IncomingEvidence,
  type ReconciliationEvidence,
} from '@/domain/pms/reconciliation';
import { buildRoomSnapshot } from '@/domain/rooms';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function stored(
  overrides: Partial<ReconciliationEvidence> = {},
): ReconciliationEvidence {
  return {
    id: 'stay-1',
    reservationId: 'R-100',
    externalId: 'LOC-100',
    guestNames: ['Ana Pérez'],
    roomId: 'room-406',
    arrivalDate: day('2026-09-20'),
    departureDate: day('2026-09-22'),
    businessDate: day('2026-09-20'),
    status: 'CHECK_IN',
    stage: 'PENDIENTE',
    roomMove: false,
    ...overrides,
  };
}

function incoming(
  overrides: Partial<IncomingEvidence> = {},
): IncomingEvidence {
  return {
    reservationId: 'R-100',
    externalId: 'LOC-100',
    guestNames: ['Ana Pérez'],
    roomId: 'room-406',
    arrivalDate: day('2026-09-20'),
    departureDate: day('2026-09-22'),
    businessDate: day('2026-09-20'),
    status: 'IN_HOUSE',
    ...overrides,
  };
}

describe('identidad y conciliación de estadías PMS', () => {
  it('CHECK_IN → IN_HOUSE actualiza la misma estancia', () => {
    const current = stored();
    const evidence = incoming();
    const decision = decideStayReconciliation([current], evidence);
    expect(decision).toMatchObject({ kind: 'MATCH', stay: { id: current.id } });
    expect(reconcileStayState(current, evidence)).toEqual({
      status: 'IN_HOUSE',
      stage: 'CONFIRMADO',
      acceptIncomingDetails: true,
    });
  });

  it('IN_HOUSE → CHECK_OUT actualiza la misma estancia', () => {
    const current = stored({ status: 'IN_HOUSE', stage: 'CONFIRMADO' });
    const evidence = incoming({ status: 'CHECK_OUT' });
    expect(decideStayReconciliation([current], evidence).kind).toBe('MATCH');
    expect(reconcileStayState(current, evidence)).toEqual({
      status: 'CHECK_OUT',
      stage: 'PENDIENTE',
      acceptIncomingDetails: true,
    });
  });

  it('CHECK_IN → IN_HOUSE → CHECK_OUT conserva una sola identidad', () => {
    const first = stored();
    const housed = incoming();
    const middle = { ...first, ...reconcileStayState(first, housed) };
    const checkout = incoming({ status: 'CHECK_OUT' });
    expect(decideStayReconciliation([middle], checkout).kind).toBe('MATCH');
    expect(reconcileStayState(middle, checkout).status).toBe('CHECK_OUT');
  });

  it('cargar informes en orden inverso no retrocede CHECK_OUT', () => {
    const checkout = stored({ status: 'CHECK_OUT', stage: 'PENDIENTE' });
    const olderState = incoming({ status: 'IN_HOUSE' });
    expect(reconcileStayState(checkout, olderState)).toEqual({
      status: 'CHECK_OUT',
      stage: 'PENDIENTE',
      acceptIncomingDetails: false,
    });
  });

  it('una extensión posterior vuelve una salida pendiente a IN_HOUSE', () => {
    const checkout = stored({
      status: 'CHECK_OUT',
      stage: 'PENDIENTE',
      departureDate: day('2026-09-20'),
    });
    const extension = incoming({
      status: 'IN_HOUSE',
      businessDate: day('2026-09-21'),
      departureDate: day('2026-09-23'),
    });
    expect(reconcileStayState(checkout, extension)).toEqual({
      status: 'IN_HOUSE',
      stage: 'CONFIRMADO',
      acceptIncomingDetails: true,
    });
  });

  it('salida y nueva entrada el mismo día con otra llegada son dos ocurrencias', () => {
    const departure = stored({
      status: 'CHECK_OUT',
      stage: 'PENDIENTE',
      arrivalDate: day('2026-09-18'),
      departureDate: day('2026-09-20'),
    });
    const reentry = incoming({
      status: 'CHECK_IN',
      arrivalDate: day('2026-09-20'),
      departureDate: day('2026-09-21'),
    });
    expect(decideStayReconciliation([departure], reentry)).toEqual({ kind: 'CREATE' });
  });

  it('un reservationId reutilizado con fechas separadas crea otra estancia', () => {
    const old = stored({
      status: 'CHECK_OUT',
      stage: 'FINALIZADO',
      arrivalDate: day('2026-08-01'),
      departureDate: day('2026-08-03'),
    });
    expect(decideStayReconciliation([old], incoming())).toEqual({ kind: 'CREATE' });
  });

  it('fechas solapadas incompatibles generan excepción y no se mezclan', () => {
    const current = stored({ arrivalDate: day('2026-09-19') });
    const contradiction = incoming({ arrivalDate: day('2026-09-20') });
    expect(decideStayReconciliation([current], contradiction)).toMatchObject({
      kind: 'CONFLICT',
      issue: 'FECHAS_INCOMPATIBLES',
    });
  });

  it('el mismo localizador en otra habitación exige cambio registrado', () => {
    const current = stored({ roomId: 'room-405' });
    expect(decideStayReconciliation([current], incoming())).toMatchObject({
      kind: 'CONFLICT',
      issue: 'HABITACION_INCOMPATIBLE',
    });
  });

  it('el mismo identificador con huéspedes claramente diferentes genera excepción', () => {
    expect(
      decideStayReconciliation(
        [stored({ guestNames: ['Ana Pérez'] })],
        incoming({ guestNames: ['Bruno Soto'] }),
      ),
    ).toMatchObject({ kind: 'CONFLICT', issue: 'HUESPED_INCOMPATIBLE' });
  });

  it('un CHECK_OUT anterior al CHECK_IN genera excepción temporal', () => {
    expect(
      decideStayReconciliation(
        [stored({ businessDate: day('2026-09-21'), status: 'CHECK_IN' })],
        incoming({ businessDate: day('2026-09-20'), status: 'CHECK_OUT' }),
      ),
    ).toMatchObject({ kind: 'CONFLICT', issue: 'SECUENCIA_TEMPORAL_INVALIDA' });
  });

  it('dos ocupaciones vigentes distintas para la habitación generan excepción', () => {
    expect(
      decideStayReconciliation(
        [stored({ reservationId: 'R-OTRA', externalId: 'LOC-OTRA', status: 'IN_HOUSE' })],
        incoming({ status: 'IN_HOUSE' }),
      ),
    ).toMatchObject({ kind: 'CONFLICT', issue: 'OCUPACION_INCOMPATIBLE' });
  });

  it('un room move ya registrado concilia contra el segmento de destino', () => {
    const source = stored({
      id: 'segmento-origen',
      roomId: 'room-405',
      status: 'IN_HOUSE',
      stage: 'FINALIZADO',
      departureDate: day('2026-09-21'),
    });
    const target = stored({
      id: 'segmento-destino',
      roomId: 'room-406',
      arrivalDate: day('2026-09-21'),
      status: 'IN_HOUSE',
      stage: 'CONFIRMADO',
      roomMove: true,
    });
    const evidence = incoming({
      roomId: 'room-406',
      // El PMS conserva la llegada original aunque el Libro abrió el segmento
      // de destino el día 21.
      arrivalDate: day('2026-09-20'),
      status: 'IN_HOUSE',
    });
    expect(decideStayReconciliation([source, target], evidence)).toMatchObject({
      kind: 'MATCH',
      stay: { id: 'segmento-destino' },
    });
    expect(reconcileStayState(target, evidence)).toMatchObject({
      preserveArrivalDate: true,
    });
  });

  it('el snapshot oculta estados históricos competidores', () => {
    const shared = {
      reservationId: 'R-100',
      guestNames: ['Huésped'],
      arrivalDate: day('2026-09-20'),
      departureDate: day('2026-09-22'),
      channel: null,
    };
    const snapshot = buildRoomSnapshot(
      [
        { ...shared, id: 'in-house', status: 'IN_HOUSE', stage: 'CONFIRMADO' },
        { ...shared, id: 'checkout', status: 'CHECK_OUT', stage: 'PENDIENTE' },
      ],
      [],
    );
    expect(snapshot.current).toBeNull();
    expect(snapshot.outgoing?.id).toBe('checkout');
  });
});
