import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SOURCE_HEADERS,
  displayedSourceHeader,
  matchColumn,
  type ColumnField,
} from '@/domain/pms/columns';

const FNS_ACTIVITY_HEADERS: Array<[string, ColumnField]> = [
  ['ID', 'reservationId'],
  ['Tipo', 'pmsStatus'],
  ['Canal', 'channel'],
  ['Nombre', 'firstName'],
  ['Apellidos', 'lastName'],
  ['Lle.', 'arrival'],
  ['Salida', 'departure'],
  ['Hab', 'roomNumber'],
  ['Hué', 'guestCount'],
  ['Imp. tot', 'totalAmount'],
  ['Imp. pte', 'pendingAmount'],
  ['Tipo de pago', 'paymentType'],
];

describe('encabezados reales de Habitaciones con actividad', () => {
  it('reconoce las abreviaturas tal como las imprime FNS', () => {
    for (const [header, field] of FNS_ACTIVITY_HEADERS) {
      expect(matchColumn(header), header).toBe(field);
    }
  });

  it('mantiene separada la leyenda visible del nombre interno', () => {
    for (const [header, field] of FNS_ACTIVITY_HEADERS) {
      expect(ACTIVITY_SOURCE_HEADERS[field], field).toBe(header);
      expect(displayedSourceHeader('ACTIVIDAD', field, 'cualquier texto')).toBe(header);
    }
  });

  it('no reescribe los encabezados de los informes secundarios', () => {
    expect(displayedSourceHeader('IN_HOUSE', 'roomNumber', 'Hab.')).toBe('Hab.');
    expect(displayedSourceHeader('ENTRADAS', 'arrival', 'Lle.')).toBe('Lle.');
  });
});
