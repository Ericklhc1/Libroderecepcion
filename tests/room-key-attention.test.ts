import { describe, expect, it } from 'vitest';
import {
  countRoomKeyIssues,
  type KeyFacts,
  type RoomSnapshot,
} from '@/domain/rooms';

function key(
  id: string,
  status: KeyFacts['status'],
  stayId: string | null,
  type: KeyFacts['type'] = 'PRINCIPAL',
): KeyFacts {
  return { id, code: id, type, status, stayId };
}

function occupiedSnapshot(keys: KeyFacts[]): RoomSnapshot {
  return {
    outgoing: null,
    current: {
      id: 'stay-current',
      reservationId: 'R-1',
      guestNames: ['Huésped'],
      status: 'IN_HOUSE',
      stage: 'CONFIRMADO',
      arrivalDate: null,
      departureDate: null,
      channel: null,
    },
    incoming: null,
    incomingState: null,
    sameReservationTurnaround: false,
    state: 'OCUPADA',
    mainKey: keys.find((item) => item.type === 'PRINCIPAL') ?? null,
    extraKeys: keys.filter((item) => item.type !== 'PRINCIPAL'),
    keysOut: keys.filter((item) =>
      ['ASIGNADA', 'COPIA_ADICIONAL', 'PENDIENTE_DEVOLUCION'].includes(item.status),
    ),
  };
}

describe('incidencias de llave en Inicio', () => {
  it('no confunde una llave correctamente asignada con una acción pendiente', () => {
    const snapshot = occupiedSnapshot([
      key('401-P', 'ASIGNADA', 'stay-current'),
      key('401-C1', 'COPIA_ADICIONAL', 'stay-current', 'COPIA'),
    ]);

    expect(countRoomKeyIssues(snapshot)).toBe(0);
  });

  it('detecta vínculos obsoletos y estados que sí requieren intervención', () => {
    const snapshot = occupiedSnapshot([
      key('401-P', 'ASIGNADA', 'otra-estadia'),
      key('401-C1', 'PENDIENTE_DEVOLUCION', 'stay-current', 'COPIA'),
      key('401-C2', 'EXTRAVIADA', null, 'COPIA'),
    ]);

    expect(countRoomKeyIssues(snapshot)).toBe(3);
  });
});
