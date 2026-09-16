import { describe, expect, it } from 'vitest';
import { readStructuredReport, type TextFragment } from '@/domain/pms/layout';
import { activityStatus, normalizeReport } from '@/domain/pms/normalize';
import { sumByCurrency } from '@/domain/pms/money';

/**
 * «Habitaciones con actividad», el informe principal.
 *
 * Los fragmentos de estas pruebas reproducen la GEOMETRÍA exacta del informe
 * real —posiciones, saltos de línea y cortes incluidos— con nombres y códigos
 * inventados: el repositorio es público y los informes del PMS traen datos de
 * huéspedes reales, así que el archivo no puede entrar acá.
 *
 * Lo que se conserva del original es lo único que importa para el lector: las
 * cuatro trampas del diseño.
 *
 *   1. El número de habitación se imprime 1,5 puntos MÁS ABAJO que el resto de
 *      la fila, así que no está en la misma coordenada que sus datos.
 *   2. Los nombres, la forma de pago y hasta los importes se PARTEN en dos
 *      líneas: «CL$» en la fila y «117.622» debajo.
 *   3. Las filas de entrada no traen cantidad de huéspedes, así que las celdas
 *      NO están en el mismo orden en todas las filas y hay que ubicarlas por
 *      posición horizontal.
 *   4. El pie de totales cae bajo las mismas columnas de importe que las filas.
 *
 * El informe real se verificó aparte, contra los totales que él mismo declara:
 * 53 filas, 24 salidas, 19 ocupadas, 10 entradas, CL$ 11.301.339 y US$ 2435.34
 * de total, CL$ 531.896 y US$ 284.14 pendientes. Todo cuadró y cero filas con
 * problemas.
 */

/** Coordenadas de cada columna, tomadas del informe real. */
const X = {
  id: 40,
  tipo: 95,
  canal: 155,
  nombre: 205,
  apellidos: 275,
  llegada: 355,
  salida: 420,
  hab: 485,
  hue: 520,
  total: 560,
  pendiente: 640,
  pago: 720,
};

function header(y: number, page = 1): TextFragment[] {
  return [
    { page, y, x: X.id, text: 'ID' },
    { page, y, x: X.tipo, text: 'Tipo' },
    { page, y, x: X.canal, text: 'Canal' },
    { page, y, x: X.nombre, text: 'Nombre' },
    { page, y, x: X.apellidos, text: 'Apellidos' },
    { page, y, x: X.llegada, text: 'Lle.' },
    { page, y, x: X.salida, text: 'Salida' },
    { page, y, x: X.hab, text: 'Hab' },
    { page, y, x: X.hue, text: 'Hué' },
    { page, y, x: X.total, text: 'Imp. tot' },
    { page, y, x: X.pendiente, text: 'Imp. pte' },
    // «Tipo de pago» se imprime en dos líneas: «Tipo de» arriba y «pago» acá.
    { page, y, x: X.pago, text: 'pago' },
  ];
}

const TITLE: TextFragment[] = [
  { page: 1, y: 741, x: 40, text: 'Habitaciones con actividad - Hotel Ejemplo - 16/09/2026' },
];

/** La fila, con la habitación 1,5 puntos más abajo, como la imprime el PMS. */
function row(
  y: number,
  cells: {
    id: string;
    tipo: string;
    canal: string;
    nombre: string;
    apellidos?: string;
    llegada: string;
    salida: string;
    hab: string;
    hue?: string;
    total: string;
    pendiente: string;
    pago: string;
  },
): TextFragment[] {
  const out: TextFragment[] = [
    { page: 1, y, x: X.id, text: cells.id },
    { page: 1, y, x: X.tipo, text: cells.tipo },
    { page: 1, y, x: X.canal, text: cells.canal },
    { page: 1, y, x: X.nombre, text: cells.nombre },
    { page: 1, y, x: X.llegada, text: cells.llegada },
    { page: 1, y, x: X.salida, text: cells.salida },
    { page: 1, y, x: X.total, text: cells.total },
    { page: 1, y, x: X.pendiente, text: cells.pendiente },
    { page: 1, y, x: X.pago, text: cells.pago },
    // Trampa 1: la habitación va 1,5 puntos más abajo.
    { page: 1, y: y - 2, x: X.hab, text: cells.hab },
  ];
  if (cells.apellidos) out.push({ page: 1, y, x: X.apellidos, text: cells.apellidos });
  // Trampa 3: las entradas no traen esta celda.
  if (cells.hue) out.push({ page: 1, y, x: X.hue, text: cells.hue });
  return out;
}

/** Línea de continuación: completa celdas de la fila de arriba. */
function continuation(
  y: number,
  parts: Array<{ x: number; text: string }>,
): TextFragment[] {
  return parts.map((part) => ({ page: 1, y, x: part.x, text: part.text }));
}

function read(fragments: TextFragment[]) {
  const structured = readStructuredReport(fragments);
  const normalized = normalizeReport(structured);
  if (!normalized) throw new Error('el informe no se pudo normalizar');
  return { structured, normalized };
}

describe('se reconoce como el informe principal', () => {
  it('por el título', () => {
    const { structured } = read([...TITLE, ...header(692), ...row(679, CASO_OCUPADA)]);
    expect(structured.kind).toBe('ACTIVIDAD');
    expect(structured.kindSource).toBe('título');
  });

  it('y por las columnas, si el título faltara', () => {
    const { structured } = read([...header(692), ...row(679, CASO_OCUPADA)]);
    expect(structured.kind).toBe('ACTIVIDAD');
    expect(structured.kindSource).toBe('columnas');
  });

  it('mapea las doce columnas, sin dejar ninguna sin reconocer', () => {
    const { structured } = read([...TITLE, ...header(692), ...row(679, CASO_OCUPADA)]);
    expect(structured.unmapped).toEqual([]);
    const fields = structured.columns.map((c) => c.field);
    for (const field of [
      'reservationId',
      'pmsStatus',
      'channel',
      'firstName',
      'lastName',
      'arrival',
      'departure',
      'roomNumber',
      'guestCount',
      'totalAmount',
      'pendingAmount',
      'paymentType',
    ] as const) {
      expect(fields, `falta ${field}`).toContain(field);
    }
  });
});

const CASO_OCUPADA = {
  id: '7000001',
  tipo: 'Ocupada',
  canal: 'Telefono',
  nombre: 'GRUPO',
  apellidos: 'EJEMPLO',
  llegada: '10/09/2026',
  salida: '21/09/2026',
  hab: '404',
  hue: '2',
  total: 'CL$ 916.300',
  pendiente: 'CL$ 0',
  pago: 'Al Hotel',
};

const CASO_SALIDA = {
  id: '7000002',
  tipo: 'Check-out',
  canal: 'Booking',
  nombre: 'Ana',
  apellidos: 'Perez',
  llegada: '15/09/2026',
  salida: '16/09/2026',
  hab: '407',
  hue: '2',
  total: 'CL$ 60.703',
  pendiente: 'CL$ 0',
  pago: 'Al Hotel',
};

/** Entrada en la MISMA habitación: no trae cantidad de huéspedes. */
const CASO_ENTRADA = {
  id: '7000003',
  tipo: 'Check-in',
  canal: 'Booking',
  nombre: 'Bruno',
  apellidos: 'Soto',
  llegada: '16/09/2026',
  salida: '17/09/2026',
  hab: '407',
  total: 'US$ 53.98',
  pendiente: 'US$ 53.98',
  pago: 'Al Hotel',
};

describe('el estado sale de cada fila, no del informe', () => {
  it('traduce las tres palabras de la columna Tipo', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, CASO_OCUPADA),
      ...row(659, CASO_SALIDA),
      ...row(639, CASO_ENTRADA),
    ]);
    expect(normalized.stays.map((s) => s.operationalStatus)).toEqual([
      'IN_HOUSE',
      'CHECK_OUT',
      'CHECK_IN',
    ]);
  });

  it('«Ocupada» es la estancia en curso', () => {
    expect(activityStatus('Ocupada')).toBe('IN_HOUSE');
    expect(activityStatus('OCUPADA')).toBe('IN_HOUSE');
  });

  it('acepta las variantes que podría imprimir el PMS', () => {
    expect(activityStatus('Check-in')).toBe('CHECK_IN');
    expect(activityStatus('check in')).toBe('CHECK_IN');
    expect(activityStatus('Salida')).toBe('CHECK_OUT');
  });

  /*
    Un tipo desconocido NO descarta la fila ni la corrige en silencio: se
    conserva con el problema anotado para que aparezca en el preview. Y el
    estado de respaldo es CHECK_IN, que es el que no otorga llave ni da nada
    por hecho: un dato ilegible no puede hacer que el sistema entregue una
    llave por su cuenta.
  */
  it('un tipo desconocido se marca como problema y no se adivina', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, { ...CASO_OCUPADA, tipo: 'Pendiente de asignar' }),
    ]);
    const stay = normalized.stays[0]!;
    expect(stay.issues.join(' ')).toMatch(/no se reconoce/i);
    expect(stay.operationalStatus).toBe('CHECK_IN');
    // Y el texto original se conserva, para poder decidir mirándolo.
    expect(stay.pmsStatus).toBe('Pendiente de asignar');
  });

  it('activityStatus no inventa nada', () => {
    expect(activityStatus(null)).toBeNull();
    expect(activityStatus('cualquier cosa')).toBeNull();
  });
});

describe('la habitación se lee aunque venga desalineada', () => {
  it('la toma de la línea de abajo, que es donde la imprime el PMS', () => {
    const { normalized } = read([...TITLE, ...header(692), ...row(679, CASO_OCUPADA)]);
    expect(normalized.stays[0]!.roomNumber).toBe('404');
  });
});

describe('salida y entrada en la misma habitación el mismo día', () => {
  /*
    El caso que verificaste en el informe real: habitaciones 407, 408 y 418 con
    una reserva que sale y otra que entra. NO es una inconsistencia, y tiene que
    producir DOS estancias para que la cola de la habitación pueda representarlo.
  */
  it('produce dos estancias, no una', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(659, CASO_SALIDA),
      ...row(639, CASO_ENTRADA),
    ]);

    const enLa407 = normalized.stays.filter((s) => s.roomNumber === '407');
    expect(enLa407).toHaveLength(2);
    expect(enLa407.map((s) => s.reservationId)).toEqual(['7000002', '7000003']);
    expect(enLa407.map((s) => s.operationalStatus)).toEqual(['CHECK_OUT', 'CHECK_IN']);
  });

  it('la entrada sin cantidad de huéspedes no descoloca sus otras celdas', () => {
    /*
      Trampa 3: la fila de entrada tiene una celda menos. Si el lector repartiera
      por orden en vez de por posición, el importe caería en la columna de
      huéspedes y la forma de pago en la de importes.
    */
    const { normalized } = read([...TITLE, ...header(692), ...row(639, CASO_ENTRADA)]);
    const stay = normalized.stays[0]!;
    expect(stay.guestCount).toBeNull();
    expect(stay.totalAmount).toEqual({ amount: 53.98, currency: 'USD' });
    expect(stay.pendingAmount).toEqual({ amount: 53.98, currency: 'USD' });
    expect(stay.payment?.type).toBe('AL_HOTEL');
    expect(stay.roomNumber).toBe('407');
    expect(stay.issues).toEqual([]);
  });
});

describe('lo que viene partido en dos líneas se reconstruye', () => {
  it('el apellido de continuación se suma a los huéspedes', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, CASO_SALIDA),
      ...continuation(671, [{ x: X.nombre, text: 'Carla' }, { x: X.apellidos, text: 'Rojas' }]),
    ]);
    expect(normalized.stays[0]!.guestNames).toEqual(['Ana Perez', 'Carla Rojas']);
  });

  /*
    El caso del informe real en la 517 y la 604: el importe pendiente se corta y
    la fila queda con «CL$» sin cifra. Antes esto dejaba un saldo de ciento
    diecisiete mil pesos leído como ilegible.
  */
  it('el importe cortado se reconstruye desde la línea siguiente', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, {
        ...CASO_ENTRADA,
        hab: '517',
        hue: '1',
        total: 'CL$ 117.622',
        pendiente: 'CL$',
      }),
      ...continuation(671, [{ x: X.pendiente, text: '117.622' }]),
    ]);
    const stay = normalized.stays[0]!;
    expect(stay.pendingAmount).toEqual({ amount: 117622, currency: 'CLP' });
    expect(stay.issues).toEqual([]);
  });

  it('la forma de pago cortada se reconstruye', () => {
    // «Prepago» en la fila y «Comision» debajo, como en el informe real.
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, { ...CASO_OCUPADA, pago: 'Prepago' }),
      ...continuation(671, [{ x: X.pago, text: 'Comision' }]),
    ]);
    const payment = normalized.stays[0]!.payment;
    expect(payment?.type).toBe('PREPAGO_COMISION');
    expect(payment?.raw).toBe('Prepago Comision');
  });

  it('una continuación con nombre Y forma de pago no pierde ninguno de los dos', () => {
    /*
      Era el fallo concreto: `Mota | Comision` no era «sólo nombres», así que la
      línea se descartaba entera —perdiendo el apellido y el tipo de pago— y
      además cortaba el hilo del registro.
    */
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, { ...CASO_OCUPADA, nombre: 'Rita', apellidos: 'Lima', pago: 'Prepago' }),
      ...continuation(671, [
        { x: X.apellidos, text: 'Duarte' },
        { x: X.pago, text: 'Comision' },
      ]),
    ]);
    const stay = normalized.stays[0]!;
    expect(stay.guestNames).toEqual(['Rita Lima', 'Duarte']);
    expect(stay.payment?.type).toBe('PREPAGO_COMISION');
  });
});

describe('una reserva en varias habitaciones', () => {
  /*
    En el informe real, una sola reserva ocupa OCHO habitaciones con importes y
    saldos distintos en cada una. Por eso el saldo pertenece a la estancia y no
    a la habitación: una puede tener saldo cero y otra de la misma reserva no.
  */
  it('produce una estancia por habitación, cada una con su saldo', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, { ...CASO_OCUPADA, hab: '404', total: 'CL$ 916.300', pendiente: 'CL$ 0' }),
      ...row(659, { ...CASO_OCUPADA, hab: '409', total: 'CL$ 931.300', pendiente: 'CL$ 15.000' }),
      ...row(639, { ...CASO_OCUPADA, hab: '410', total: 'CL$ 811.580', pendiente: 'CL$ 0' }),
    ]);

    expect(normalized.stays).toHaveLength(3);
    expect(new Set(normalized.stays.map((s) => s.reservationId))).toEqual(new Set(['7000001']));
    expect(normalized.stays.map((s) => s.roomNumber)).toEqual(['404', '409', '410']);
    expect(normalized.stays.map((s) => s.pendingAmount?.amount)).toEqual([0, 15000, 0]);
  });
});

describe('las tres formas de pago del informe', () => {
  it('se reconocen y conservan su texto', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, { ...CASO_OCUPADA, hab: '401', pago: 'Al Hotel' }),
      ...row(659, { ...CASO_OCUPADA, hab: '402', pago: 'Prepago Comision' }),
      ...row(639, { ...CASO_OCUPADA, hab: '403', pago: 'Credito Empresa' }),
    ]);
    expect(normalized.stays.map((s) => s.payment?.type)).toEqual([
      'AL_HOTEL',
      'PREPAGO_COMISION',
      'CREDITO_EMPRESA',
    ]);
    expect(normalized.stays.map((s) => s.payment?.raw)).toEqual([
      'Al Hotel',
      'Prepago Comision',
      'Credito Empresa',
    ]);
  });
});

describe('el pie de totales no se confunde con una fila', () => {
  /*
    Trampa 4: los totales caen bajo las MISMAS columnas de importe. Sin la
    guarda de las dos marcas de moneda, esas cifras se sumaban al último
    registro leído y la última habitación del informe acabaría con un saldo de
    miles de dólares inexistente.
  */
  it('no contamina el último registro', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, CASO_OCUPADA),
      // Pie: dos marcas de moneda en la misma línea.
      ...continuation(300, [
        { x: X.total, text: 'US$ 2435.34' },
        { x: X.pendiente, text: 'US$' },
      ]),
      ...continuation(290, [{ x: X.pendiente, text: '284.14' }]),
      ...continuation(280, [
        { x: X.total, text: 'CL$' },
        { x: X.pendiente, text: 'CL$' },
      ]),
    ]);

    expect(normalized.stays).toHaveLength(1);
    const stay = normalized.stays[0]!;
    expect(stay.totalAmount).toEqual({ amount: 916300, currency: 'CLP' });
    expect(stay.pendingAmount).toEqual({ amount: 0, currency: 'CLP' });
  });

  it('la línea «Habitaciones Pasajeros Huéspedes» no se toma por un encabezado', () => {
    /*
      Mapea tres columnas del diccionario, así que sin exigir la columna de ID
      reemplazaría los límites reales al final del documento.
    */
    const { structured } = read([
      ...TITLE,
      ...header(692),
      ...row(679, CASO_OCUPADA),
      ...continuation(203, [
        { x: X.hab, text: 'Habitaciones' },
        { x: X.hue, text: 'Pasajeros' },
        { x: X.total, text: 'Huéspedes' },
      ]),
    ]);
    expect(structured.columns.map((c) => c.field)).toContain('reservationId');
    expect(structured.records).toHaveLength(1);
  });

  it('lee los totales declarados, incluido «Ocupada»', () => {
    const { structured } = read([
      ...TITLE,
      ...header(692),
      ...row(679, CASO_OCUPADA),
      ...continuation(189, [{ x: X.id, text: 'Check-in' }, { x: X.tipo, text: '10' }]),
      ...continuation(176, [{ x: X.id, text: 'Check-out' }, { x: X.tipo, text: '24' }]),
      ...continuation(163, [{ x: X.id, text: 'Ocupada' }, { x: X.tipo, text: '19' }]),
    ]);
    const labels = structured.summary.map((s) => s.label);
    expect(labels).toEqual(['Check-in', 'Check-out', 'Ocupada']);
    expect(structured.summary.map((s) => s.numbers[0])).toEqual([10, 24, 19]);
  });
});

describe('los totales se suman por moneda', () => {
  it('el informe mezcla pesos y dólares, y no se juntan', () => {
    const { normalized } = read([
      ...TITLE,
      ...header(692),
      ...row(679, { ...CASO_OCUPADA, hab: '404', total: 'CL$ 916.300', pendiente: 'CL$ 15.000' }),
      ...row(659, { ...CASO_ENTRADA, hab: '407', total: 'US$ 53.98', pendiente: 'US$ 53.98' }),
    ]);
    expect(sumByCurrency(normalized.stays.map((s) => s.totalAmount))).toEqual({
      CLP: 916300,
      USD: 53.98,
    });
    expect(sumByCurrency(normalized.stays.map((s) => s.pendingAmount))).toEqual({
      CLP: 15000,
      USD: 53.98,
    });
  });
});
