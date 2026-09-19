import { describe, expect, it } from 'vitest';
import { parseMoney } from '@/domain/pms/money';
import { hasBlockingPmsIssues, isBlockingPmsIssue } from '@/domain/pms/issues';

describe('PMS: importes con observaciones de FNS', () => {
  it('lee CLP 0 aunque FNS agregue una observación después', () => {
    expect(parseMoney('CL$ 0 Cartel no molestar')).toEqual({
      amount: 0,
      currency: 'CLP',
    });
  });

  it('lee USD 0 aunque FNS agregue una observación después', () => {
    expect(parseMoney('US$ 0 RESERVA GARANTIZADA!! TID: 306241441089123VI')).toEqual({
      amount: 0,
      currency: 'USD',
    });
  });

  it('conserva la interpretación de importes normales con texto posterior', () => {
    expect(parseMoney('CL$ 916.300 Abono realizado')).toEqual({
      amount: 916300,
      currency: 'CLP',
    });
  });

  it('no toma un número de una observación cuando no hay importe al inicio', () => {
    expect(parseMoney('CL$ Huésped tiene plancha, 10.000 solicitar en check out.')).toBeNull();
  });

  it('no inventa un importe cuando sólo viene la moneda', () => {
    expect(parseMoney('CL$')).toBeNull();
  });
});

describe('PMS: severidad de incidencias', () => {
  it('un importe ilegible es advertencia y no bloquea la estadía', () => {
    expect(
      hasBlockingPmsIssues([
        'No se pudo interpretar el importe pendiente «CL$ Huésped tiene plancha».',
      ]),
    ).toBe(false);
  });

  it('un problema estructural sigue bloqueando la estadía', () => {
    expect(isBlockingPmsIssue('La fila no trae número de habitación.')).toBe(true);
    expect(
      hasBlockingPmsIssues([
        'No se pudo interpretar el importe pendiente «CL$».',
        'La fila no trae número de habitación.',
      ]),
    ).toBe(true);
  });
});
