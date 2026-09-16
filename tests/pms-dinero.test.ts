import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  parseMoney,
  sameMoney,
  sumByCurrency,
} from '@/domain/pms/money';
import {
  PAYMENT_TYPE_LABELS,
  collectsAtDesk,
  parsePaymentType,
} from '@/domain/pms/payment';

/**
 * Importes del informe de actividad.
 *
 * Todos los valores de estas pruebas están copiados del informe real
 * «Habitaciones con actividad - Hotel HW LIBERTAD - 16/09/2026». No son
 * ejemplos inventados: son las cifras que el sistema va a tener que leer.
 *
 * El punto significa cosas distintas en cada moneda, y ahí está todo el
 * peligro: en `CL$ 916.300` separa miles y en `US$ 204.12` separa centavos.
 * Interpretarlo sin mirar la moneda convierte novecientos dieciséis mil pesos
 * en novecientos dieciséis con treinta, y ese número termina en el arqueo.
 */
describe('importes en pesos', () => {
  it('el punto es separador de miles, no decimal', () => {
    expect(parseMoney('CL$ 916.300')).toEqual({ amount: 916300, currency: 'CLP' });
    expect(parseMoney('CL$ 64.511')).toEqual({ amount: 64511, currency: 'CLP' });
    expect(parseMoney('CL$ 15.000')).toEqual({ amount: 15000, currency: 'CLP' });
    expect(parseMoney('CL$ 117.622')).toEqual({ amount: 117622, currency: 'CLP' });
  });

  it('lee los totales del pie, con dos grupos de miles', () => {
    // Del pie del informe: CL$ 11.301.339 total y CL$ 531.896 pendiente.
    expect(parseMoney('CL$ 11.301.339')).toEqual({ amount: 11301339, currency: 'CLP' });
    expect(parseMoney('CL$ 531.896')).toEqual({ amount: 531896, currency: 'CLP' });
  });

  it('el cero es cero', () => {
    expect(parseMoney('CL$ 0')).toEqual({ amount: 0, currency: 'CLP' });
  });
});

describe('importes en dólares', () => {
  it('el punto es separador decimal', () => {
    expect(parseMoney('US$ 204.12')).toEqual({ amount: 204.12, currency: 'USD' });
    expect(parseMoney('US$ 53.98')).toEqual({ amount: 53.98, currency: 'USD' });
    expect(parseMoney('US$ 49.38')).toEqual({ amount: 49.38, currency: 'USD' });
  });

  it('admite una sola cifra decimal, como la imprime el informe', () => {
    // El informe escribe US$ 57.2 y US$ 274.25 en la misma página.
    expect(parseMoney('US$ 57.2')).toEqual({ amount: 57.2, currency: 'USD' });
    expect(parseMoney('US$ 265.1')).toEqual({ amount: 265.1, currency: 'USD' });
  });

  it('admite importes sin decimales', () => {
    expect(parseMoney('US$ 115')).toEqual({ amount: 115, currency: 'USD' });
    expect(parseMoney('US$ 300')).toEqual({ amount: 300, currency: 'USD' });
    expect(parseMoney('US$ 0')).toEqual({ amount: 0, currency: 'USD' });
  });

  it('lee el total del pie sin confundir los miles', () => {
    // US$ 2435.34: dos mil cuatrocientos treinta y cinco con treinta y cuatro.
    expect(parseMoney('US$ 2435.34')).toEqual({ amount: 2435.34, currency: 'USD' });
    expect(parseMoney('US$ 284.14')).toEqual({ amount: 284.14, currency: 'USD' });
  });
});

describe('lo que NO se interpreta', () => {
  /*
    La prueba que protege el dinero: un importe sin moneda no se guarda como
    peso «por si acaso». El informe mezcla las dos monedas, así que adivinar
    tiene el cincuenta por ciento de equivocarse.
  */
  it('un importe sin moneda no se interpreta', () => {
    expect(parseMoney('916.300')).toBeNull();
    expect(parseMoney('204.12')).toBeNull();
  });

  it('el texto vacío o ilegible no se interpreta', () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('CL$')).toBeNull();
    expect(parseMoney('CL$ pendiente')).toBeNull();
  });

  it('tolera el espacio ausente y las variantes de escritura', () => {
    expect(parseMoney('CL$916.300')).toEqual({ amount: 916300, currency: 'CLP' });
    expect(parseMoney('US$53.98')).toEqual({ amount: 53.98, currency: 'USD' });
    expect(parseMoney('  CL$  64.511  ')).toEqual({ amount: 64511, currency: 'CLP' });
  });
});

describe('sumar sin mezclar monedas', () => {
  /*
    No existe una función que dé un total único, y es deliberado: sumar pesos
    con dólares da un número sin significado. El preview muestra las dos cifras
    por separado, como las declara el informe.
  */
  it('agrupa por moneda', () => {
    const totals = sumByCurrency([
      { amount: 916300, currency: 'CLP' },
      { amount: 53.98, currency: 'USD' },
      { amount: 15000, currency: 'CLP' },
      { amount: 57.2, currency: 'USD' },
      null,
    ]);
    expect(totals).toEqual({ CLP: 931300, USD: 111.18 });
  });

  it('el dólar se redondea a centavos al final, no en cada suma', () => {
    // Acumular en coma flotante arrastra milésimas: 0.1+0.2 no es 0.3.
    const totals = sumByCurrency([
      { amount: 0.1, currency: 'USD' },
      { amount: 0.2, currency: 'USD' },
    ]);
    expect(totals.USD).toBe(0.3);
  });

  it('sin importes, los totales son cero en las dos monedas', () => {
    expect(sumByCurrency([])).toEqual({ CLP: 0, USD: 0 });
  });

  it('el mismo número en monedas distintas nunca es el mismo importe', () => {
    expect(sameMoney({ amount: 100, currency: 'CLP' }, { amount: 100, currency: 'USD' })).toBe(
      false,
    );
    expect(sameMoney({ amount: 100, currency: 'CLP' }, { amount: 100, currency: 'CLP' })).toBe(
      true,
    );
  });
});

describe('formato, para poder compararlo a ojo con el informe', () => {
  it('escribe el peso sin decimales y el dólar con dos', () => {
    expect(formatMoney({ amount: 916300, currency: 'CLP' })).toBe('CL$ 916.300');
    expect(formatMoney({ amount: 53.98, currency: 'USD' })).toBe('US$ 53.98');
    expect(formatMoney({ amount: 57.2, currency: 'USD' })).toBe('US$ 57.20');
  });
});

describe('forma de pago', () => {
  it('reconoce las tres del informe', () => {
    expect(parsePaymentType('Al Hotel').type).toBe('AL_HOTEL');
    expect(parsePaymentType('Prepago Comision').type).toBe('PREPAGO_COMISION');
    expect(parsePaymentType('Credito Empresa').type).toBe('CREDITO_EMPRESA');
  });

  it('reconoce la misma forma con tilde', () => {
    // El informe la escribe sin tilde; una plantilla nueva podría ponerla.
    expect(parsePaymentType('Prepago Comisión').type).toBe('PREPAGO_COMISION');
    expect(parsePaymentType('Crédito Empresa').type).toBe('CREDITO_EMPRESA');
  });

  it('conserva SIEMPRE el texto original', () => {
    /*
      Es la regla que pediste: normalizar cuando hay equivalencia segura, pero
      no perder lo que vino. Si mañana el PMS cambia el texto, el dato sigue
      estando.
    */
    expect(parsePaymentType('Prepago Comision').raw).toBe('Prepago Comision');
    expect(parsePaymentType('  Al Hotel  ').raw).toBe('Al Hotel');
  });

  it('una forma desconocida no se fuerza a una categoría', () => {
    const parsed = parsePaymentType('Transferencia diferida');
    expect(parsed.type).toBe('OTRO');
    expect(parsed.raw).toBe('Transferencia diferida');
  });

  it('sin forma declarada, no se supone que se cobra en el mesón', () => {
    expect(parsePaymentType(null).type).toBe('OTRO');
    expect(collectsAtDesk('OTRO')).toBe(false);
  });

  /*
    La distinción que importa: de esto depende si el recepcionista cobra.
    Marcar un prepago como cobrable es cobrarle dos veces al huésped.
  */
  it('sólo «al hotel» se cobra en recepción', () => {
    expect(collectsAtDesk('AL_HOTEL')).toBe(true);
    expect(collectsAtDesk('PREPAGO_COMISION')).toBe(false);
    expect(collectsAtDesk('CREDITO_EMPRESA')).toBe(false);
  });

  it('las cuatro formas tienen etiqueta', () => {
    for (const type of ['AL_HOTEL', 'PREPAGO_COMISION', 'CREDITO_EMPRESA', 'OTRO'] as const) {
      expect(PAYMENT_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});
