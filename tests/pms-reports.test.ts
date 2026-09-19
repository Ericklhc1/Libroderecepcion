import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStructuredReport, type TextFragment } from '@/domain/pms/layout';
import { normalizeReport } from '@/domain/pms/normalize';
import { matchColumn, normalizeHeader } from '@/domain/pms/columns';

/**
 * Lectura de los tres informes del PMS.
 *
 * Los fixtures son los informes reales del Hotel HW Libertad: conservan
 * coordenadas, encabezados, identificadores de reserva y números de
 * habitación, con los nombres de los huéspedes sustituidos. Así estas pruebas
 * ejercitan la estructura de verdad sin versionar datos de huéspedes.
 */
function load(slug: string): TextFragment[] {
  return JSON.parse(readFileSync(`tests/fixtures/informe-${slug}.json`, 'utf-8'));
}

function read(slug: string) {
  const structured = readStructuredReport(load(slug));
  const normalized = normalizeReport(structured);
  if (!normalized) throw new Error(`No se pudo normalizar el informe ${slug}`);
  return { structured, normalized };
}

describe('diccionario de columnas', () => {
  it('reconoce los encabezados de los tres informes', () => {
    expect(matchColumn('ID')).toBe('reservationId');
    expect(matchColumn('Canal')).toBe('channel');
    expect(matchColumn('Cliente')).toBe('guestName');
    expect(matchColumn('Huéspedes')).toBe('guestName');
    expect(matchColumn('Nombre')).toBe('firstName');
    expect(matchColumn('Apellidos')).toBe('lastName');
    expect(matchColumn('Lle.')).toBe('arrival');
    expect(matchColumn('Salida')).toBe('departure');
    expect(matchColumn('Hab')).toBe('roomNumber');
    expect(matchColumn('Habitación')).toBe('roomNumber');
    expect(matchColumn('Tipo')).toBe('pmsStatus');
  });

  it('tolera variantes de otra plantilla sin tocar el código', () => {
    expect(matchColumn('Nº Reserva')).toBe('reservationId');
    expect(matchColumn('FECHA DE LLEGADA')).toBe('arrival');
    expect(matchColumn('Check-out')).toBe('departure');
    expect(matchColumn('Nombre completo')).toBe('guestName');
    expect(matchColumn('Hab. asignada')).toBe('roomNumber');
    expect(matchColumn('Comentario del recepcionista')).toBeNull();
  });

  it('no destruye palabras al quitar la marca de ordinal', () => {
    // Un normalizador descuidado convierte "Nombre" en "mbre".
    expect(normalizeHeader('Nombre')).toBe('nombre');
    expect(normalizeHeader('Nº Hab')).toBe('hab');
  });
});

describe('informe de entradas', () => {
  const { structured, normalized } = read('entradas');

  it('se identifica por su título y encuentra todas sus columnas', () => {
    expect(structured.kind).toBe('ENTRADAS');
    expect(structured.kindSource).toBe('título');
    expect(structured.unmapped).toEqual([]);
    expect(structured.columns.map((c) => c.field)).toEqual([
      'reservationId',
      'channel',
      'guestName',
      'arrival',
      'departure',
      'roomNumber',
    ]);
  });

  it('lee tantas filas como declara el propio informe', () => {
    const declared = structured.summary.find((s) => /check-?in/i.test(s.label));
    expect(declared?.numbers[0]).toBe(13);
    expect(normalized.stays).toHaveLength(13);
  });

  it('todas las filas quedan completas y en estado CHECK_IN', () => {
    for (const stay of normalized.stays) {
      expect(stay.operationalStatus).toBe('CHECK_IN');
      expect(stay.roomNumber).toBeTruthy();
      expect(stay.guestNames.length).toBeGreaterThan(0);
      expect(stay.arrivalDate).toBeInstanceOf(Date);
      expect(stay.issues).toEqual([]);
    }
  });

  it('une el número de habitación aunque el PMS lo imprima en otra línea', () => {
    const rooms = normalized.stays.map((stay) => stay.roomNumber);
    expect(rooms).toContain('408');
    expect(rooms).toContain('414');
    expect(rooms).toContain('515');
    expect(rooms).toContain('610');
  });

  it('conserva una reserva que ocupa dos habitaciones', () => {
    const shared = normalized.stays.filter((stay) => stay.reservationId === '7528705');
    expect(shared.map((stay) => stay.roomNumber).sort()).toEqual(['423', '426']);
  });

  it('no repite al titular cuando el PMS lo imprime dos veces', () => {
    /*
      El informe escribe el nombre del titular otra vez en la línea de
      continuación de las habitaciones 515 y 610. Son la misma persona, así que
      el huésped aparece una sola vez.
    */
    const repeated = normalized.stays.find((stay) => stay.roomNumber === '515');
    expect(repeated?.guestNames).toHaveLength(1);
    const alsoRepeated = normalized.stays.find((stay) => stay.roomNumber === '610');
    expect(alsoRepeated?.guestNames).toHaveLength(1);
  });
});

describe('informe in house', () => {
  const { structured, normalized } = read('in-house');

  it('se identifica y lee sus columnas, incluida la de estado', () => {
    expect(structured.kind).toBe('IN_HOUSE');
    expect(structured.unmapped).toEqual([]);
    expect(structured.columns.map((c) => c.field)).toContain('pmsStatus');
  });

  it('lee las dos páginas y repite el encabezado en cada una', () => {
    expect(normalized.stays).toHaveLength(30);
    const pages = new Set(normalized.stays.map((stay) => stay.origin.page));
    expect([...pages].sort()).toEqual([1, 2]);
  });

  it('resuelve la llegada sin año contra la fecha del informe', () => {
    const stay = normalized.stays.find((s) => s.roomNumber === '608');
    // El informe imprime "28/08" y la fecha del informe es 14/09/2026.
    expect(stay?.arrivalDate?.getUTCFullYear()).toBe(2026);
    expect(stay?.arrivalDate?.getUTCMonth()).toBe(7);
    expect(stay?.arrivalDate?.getUTCDate()).toBe(28);
  });

  it('no confunde el pie del informe con un huésped más', () => {
    // "In-house 51" cae bajo la columna de huéspedes de la última fila.
    const last = normalized.stays.find((stay) => stay.roomNumber === '602');
    expect(last?.guestNames).toHaveLength(2);
    expect(last?.guestNames.join(' ')).not.toMatch(/\d/);
    expect(last?.guestNames.join(' ')).not.toMatch(/in-?house/i);
    expect(structured.summary.some((s) => /in-?house/i.test(s.label))).toBe(true);
  });

  it('conserva todos los huéspedes de una habitación', () => {
    const triple = normalized.stays.find((stay) => stay.roomNumber === '429');
    expect(triple?.guestNames).toHaveLength(3);
  });

  it('trae el estado que declara el PMS', () => {
    expect(normalized.stays.every((stay) => stay.pmsStatus === 'Ocupada')).toBe(true);
    expect(normalized.stays.every((stay) => stay.operationalStatus === 'IN_HOUSE')).toBe(true);
  });
});

describe('informe de salidas', () => {
  const { structured, normalized } = read('salidas');

  it('se identifica y separa nombre de apellidos', () => {
    expect(structured.kind).toBe('SALIDAS');
    expect(structured.unmapped).toEqual([]);
    const fields = structured.columns.map((c) => c.field);
    expect(fields).toContain('firstName');
    expect(fields).toContain('lastName');
  });

  it('lee tantas filas como declara el informe', () => {
    const declared = structured.summary.find((s) => /check-?out/i.test(s.label));
    expect(declared?.numbers[0]).toBe(14);
    expect(normalized.stays).toHaveLength(14);
  });

  it('une nombre y apellidos en un solo nombre', () => {
    for (const stay of normalized.stays) {
      expect(stay.guestNames[0]).toBeTruthy();
      expect(stay.operationalStatus).toBe('CHECK_OUT');
    }
    // La 518 sale sin apellidos en el informe: se conserva lo que hay.
    const single = normalized.stays.find((stay) => stay.roomNumber === '518');
    expect(single?.guestNames[0]).toBeTruthy();
  });

  it('conserva una reserva que libera dos habitaciones', () => {
    const shared = normalized.stays.filter((stay) => stay.reservationId === '7529545');
    expect(shared.map((stay) => stay.roomNumber).sort()).toEqual(['408', '414']);
  });
});

describe('tolerancia del lector', () => {
  it('no se cae con un informe vacío', () => {
    const structured = readStructuredReport([]);
    expect(structured.kind).toBeNull();
    expect(structured.records).toEqual([]);
    expect(normalizeReport(structured)).toBeNull();
  });

  it('reconoce el tipo por sus columnas cuando el título no lo dice', () => {
    const fragments: TextFragment[] = [
      { page: 1, x: 60, y: 560, text: 'Reporte diario' },
      { page: 1, x: 60, y: 520, text: 'ID' },
      { page: 1, x: 160, y: 520, text: 'Canal' },
      { page: 1, x: 250, y: 520, text: 'Nombre' },
      { page: 1, x: 350, y: 520, text: 'Apellidos' },
      { page: 1, x: 500, y: 520, text: 'Llegada' },
      { page: 1, x: 600, y: 520, text: 'Salida' },
      { page: 1, x: 690, y: 520, text: 'Hab' },
      { page: 1, x: 60, y: 500, text: '9001' },
      { page: 1, x: 160, y: 500, text: 'Directo' },
      { page: 1, x: 250, y: 500, text: 'Ana' },
      { page: 1, x: 350, y: 500, text: 'Pérez' },
      { page: 1, x: 500, y: 500, text: '12/09/2026' },
      { page: 1, x: 600, y: 500, text: '14/09/2026' },
      { page: 1, x: 690, y: 498, text: '401' },
    ];
    const structured = readStructuredReport(fragments);
    expect(structured.kind).toBe('SALIDAS');
    expect(structured.kindSource).toBe('columnas');
    const normalized = normalizeReport(structured);
    expect(normalized?.stays[0]?.guestNames).toEqual(['Ana Pérez']);
    expect(normalized?.stays[0]?.roomNumber).toBe('401');
  });

  it('avisa cuando una fila no trae habitación en lugar de inventarla', () => {
    const fragments: TextFragment[] = [
      { page: 1, x: 60, y: 560, text: 'Informe de entradas - 14/09/2026' },
      { page: 1, x: 60, y: 520, text: 'ID' },
      { page: 1, x: 250, y: 520, text: 'Cliente' },
      { page: 1, x: 500, y: 520, text: 'Llegada' },
      { page: 1, x: 690, y: 520, text: 'Hab' },
      { page: 1, x: 60, y: 500, text: '9002' },
      { page: 1, x: 250, y: 500, text: 'Sin habitación' },
      { page: 1, x: 500, y: 500, text: '14/09/2026' },
    ];
    const normalized = normalizeReport(readStructuredReport(fragments));
    expect(normalized?.stays[0]?.roomNumber).toBeNull();
    expect(normalized?.stays[0]?.issues.join(' ')).toMatch(/número de habitación/);
  });

  it('descarta los glifos invisibles de la plantilla', () => {
    const fragments: TextFragment[] = [
      { page: 1, x: 60, y: 520, text: 'ID' },
      // Glifo de fuente de iconos: si se colara, rompería el encabezado.
      { page: 1, x: 245, y: 521, text: '' },
      { page: 1, x: 250, y: 520, text: 'Cliente' },
      { page: 1, x: 500, y: 520, text: 'Llegada' },
      { page: 1, x: 690, y: 520, text: 'Hab' },
    ];
    const structured = readStructuredReport(fragments);
    expect(structured.unmapped).toEqual([]);
    expect(structured.columns.map((c) => c.field)).toEqual([
      'reservationId',
      'guestName',
      'arrival',
      'roomNumber',
    ]);
  });
});
