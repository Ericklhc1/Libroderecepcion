import { describe, expect, it } from 'vitest';
import {
  assertValidQuantities,
  cashHandoverProblems,
  countDiscrepancies,
  countTotals,
  fromMinor,
  fundStatuses,
  minorUnitDigits,
  toMinor,
  type CountedDenomination,
} from '@/domain/cash';

/** Fondo fijo del hotel: CLP 100.000 y USD 150. */
const FONDOS = [
  { currency: 'CLP', minorAmount: 100_000 },
  { currency: 'USD', minorAmount: 15_000 },
];

/** Un arqueo que da exactamente CLP 100.000. */
const CLP_EXACTO: CountedDenomination[] = [
  { currency: 'CLP', minorValue: 20_000, quantity: 4 },
  { currency: 'CLP', minorValue: 10_000, quantity: 1 },
  { currency: 'CLP', minorValue: 5_000, quantity: 1 },
  { currency: 'CLP', minorValue: 2_000, quantity: 2 },
  { currency: 'CLP', minorValue: 1_000, quantity: 1 },
];

/** US$150 en billetes. */
const USD_EXACTO: CountedDenomination[] = [
  { currency: 'USD', minorValue: 10_000, quantity: 1 },
  { currency: 'USD', minorValue: 5_000, quantity: 1 },
];

describe('unidad menor de cada divisa', () => {
  it('el peso chileno no tiene centavos y el dólar sí', () => {
    /*
      Tratar el CLP como si tuviera centavos multiplicaría por cien cada
      monto: el fondo de 100.000 pasaría a valer diez millones.
    */
    expect(minorUnitDigits('CLP')).toBe(0);
    expect(minorUnitDigits('USD')).toBe(2);
    expect(toMinor(100_000, 'CLP')).toBe(100_000);
    expect(toMinor(150, 'USD')).toBe(15_000);
    expect(fromMinor(15_000, 'USD')).toBe(150);
    expect(fromMinor(100_000, 'CLP')).toBe(100_000);
  });

  it('un monto con decimales no se pierde por coma flotante', () => {
    // 150,50 × 100 en coma flotante da 15049.999...; debe dar 15050.
    expect(toMinor(150.5, 'USD')).toBe(15_050);
    expect(toMinor(0.07, 'USD')).toBe(7);
  });

  it('una divisa desconocida se asume con dos decimales', () => {
    expect(minorUnitDigits('GBP')).toBe(2);
  });
});

describe('total del arqueo', () => {
  it('suma cantidad por valor y agrupa por divisa', () => {
    const totales = countTotals([...CLP_EXACTO, ...USD_EXACTO]);
    expect(totales.get('CLP')).toBe(100_000);
    expect(totales.get('USD')).toBe(15_000);
  });

  it('las denominaciones con cantidad cero no aportan ni crean divisas', () => {
    const totales = countTotals([
      { currency: 'CLP', minorValue: 20_000, quantity: 0 },
      { currency: 'EUR', minorValue: 5_000, quantity: 0 },
    ]);
    expect(totales.get('CLP')).toBeUndefined();
    expect(totales.has('EUR')).toBe(false);
  });

  it('no distingue mayúsculas en el código de divisa', () => {
    const totales = countTotals([
      { currency: 'clp', minorValue: 10_000, quantity: 1 },
      { currency: 'CLP', minorValue: 10_000, quantity: 1 },
    ]);
    expect(totales.get('CLP')).toBe(20_000);
  });
});

describe('fondo fijo', () => {
  it('una caja exacta cuadra y no deja nada por entregar', () => {
    const estados = fundStatuses(FONDOS, [...CLP_EXACTO, ...USD_EXACTO]);

    expect(estados).toHaveLength(2);
    for (const estado of estados) {
      expect(estado.balanced, `${estado.currency} no cuadró`).toBe(true);
      expect(estado.surplusMinor).toBe(0);
      expect(estado.shortfallMinor).toBe(0);
    }
  });

  it('el excedente sobre el fondo es la recaudación a entregar a tesorería', () => {
    const conRecaudacion = [
      ...CLP_EXACTO,
      { currency: 'CLP', minorValue: 20_000, quantity: 3 },
    ];
    const [clp] = fundStatuses([FONDOS[0]!], conRecaudacion);

    expect(clp?.countedMinor).toBe(160_000);
    expect(clp?.fundMinor).toBe(100_000);
    expect(clp?.surplusMinor).toBe(60_000);
    expect(clp?.shortfallMinor).toBe(0);
    expect(clp?.balanced).toBe(false);
  });

  it('un faltante no se compensa: se reporta como faltante', () => {
    const incompleto = CLP_EXACTO.filter((line) => line.minorValue !== 20_000);
    const [clp] = fundStatuses([FONDOS[0]!], incompleto);

    expect(clp?.countedMinor).toBe(20_000);
    expect(clp?.shortfallMinor).toBe(80_000);
    expect(clp?.surplusMinor).toBe(0);
  });

  it('una divisa con fondo y sin nada contado aparece como faltante completo', () => {
    // Lo contrario —que la fila desapareciera— dejaría US$150 perdidos sin aviso.
    const estados = fundStatuses(FONDOS, CLP_EXACTO);
    const usd = estados.find((estado) => estado.currency === 'USD');

    expect(usd).toBeDefined();
    expect(usd?.shortfallMinor).toBe(15_000);
  });

  it('una divisa contada sin fondo configurado también aparece', () => {
    // Es dinero que está en el cajón: alguien tiene que responder por él.
    const estados = fundStatuses(FONDOS, [
      ...CLP_EXACTO,
      ...USD_EXACTO,
      { currency: 'EUR', minorValue: 5_000, quantity: 2 },
    ]);
    const eur = estados.find((estado) => estado.currency === 'EUR');

    expect(eur?.fundMinor).toBe(0);
    expect(eur?.countedMinor).toBe(10_000);
    expect(eur?.surplusMinor).toBe(10_000);
  });
});

describe('diferencia entre lo declarado y lo confirmado', () => {
  it('si los dos conteos coinciden no hay nada que mostrar', () => {
    expect(countDiscrepancies(CLP_EXACTO, CLP_EXACTO)).toEqual([]);
  });

  it('coinciden aunque el desglose de billetes sea distinto', () => {
    // Dos de 50.000 no existen en CLP; se usa otro desglose del mismo total.
    const otroDesglose: CountedDenomination[] = [
      { currency: 'CLP', minorValue: 10_000, quantity: 10 },
    ];
    expect(countTotals(otroDesglose).get('CLP')).toBe(100_000);
    expect(countDiscrepancies(CLP_EXACTO, otroDesglose)).toEqual([]);
  });

  it('informa sólo las divisas que no cuadran, con el signo correcto', () => {
    const confirmado: CountedDenomination[] = [
      { currency: 'CLP', minorValue: 10_000, quantity: 9 },
      ...USD_EXACTO,
    ];
    const diferencias = countDiscrepancies([...CLP_EXACTO, ...USD_EXACTO], confirmado);

    expect(diferencias).toHaveLength(1);
    expect(diferencias[0]?.currency).toBe('CLP');
    expect(diferencias[0]?.declaredMinor).toBe(100_000);
    expect(diferencias[0]?.confirmedMinor).toBe(90_000);
    // Negativo: quien recibe contó menos de lo que le declararon.
    expect(diferencias[0]?.differenceMinor).toBe(-10_000);
  });
});

describe('qué impide entregar el turno', () => {
  it('una caja que cuadra se entrega sin explicaciones', () => {
    const estados = fundStatuses(FONDOS, [...CLP_EXACTO, ...USD_EXACTO]);
    expect(cashHandoverProblems({ statuses: estados, hasNotes: false })).toEqual([]);
  });

  it('una caja descuadrada sin una palabra no se entrega', () => {
    const estados = fundStatuses([FONDOS[0]!], [
      { currency: 'CLP', minorValue: 10_000, quantity: 2 },
    ]);
    const problemas = cashHandoverProblems({ statuses: estados, hasNotes: false });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('falta 80000 CLP');
  });

  it('una caja descuadrada CON explicación se entrega: el faltante existe y hay que declararlo', () => {
    const estados = fundStatuses([FONDOS[0]!], [
      { currency: 'CLP', minorValue: 10_000, quantity: 2 },
    ]);
    expect(cashHandoverProblems({ statuses: estados, hasNotes: true })).toEqual([]);
  });

  it('el excedente también cuenta como descuadre que hay que explicar', () => {
    const estados = fundStatuses([FONDOS[0]!], [
      ...CLP_EXACTO,
      { currency: 'CLP', minorValue: 20_000, quantity: 1 },
    ]);
    const problemas = cashHandoverProblems({ statuses: estados, hasNotes: false });
    expect(problemas[0]).toContain('sobra 20000 CLP');
  });
});

describe('validación del conteo', () => {
  it('rechaza cantidades negativas o fraccionarias', () => {
    expect(() => assertValidQuantities([{ quantity: -1 }])).toThrow();
    expect(() => assertValidQuantities([{ quantity: 2.5 }])).toThrow();
    expect(() => assertValidQuantities([{ quantity: Number.NaN }])).toThrow();
  });

  it('acepta cero y enteros positivos', () => {
    expect(() => assertValidQuantities([{ quantity: 0 }, { quantity: 12 }])).not.toThrow();
  });
});
