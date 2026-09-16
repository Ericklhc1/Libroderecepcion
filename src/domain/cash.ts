/**
 * Caja de recepción: fondo fijo, arqueo por denominación y egreso a tesorería.
 *
 * Todo lo de este archivo es aritmética pura, sin base de datos: así la regla
 * del fondo fijo se puede probar sin montar un turno completo.
 *
 * Tres ideas gobiernan el módulo:
 *
 *   1. El **fondo fijo** es lo que SIEMPRE debe quedar en el cajón. No es
 *      recaudación ni se entrega a tesorería: se traspasa de turno en turno.
 *   2. Lo que excede el fondo es recaudación y sale como **egreso**. Si falta
 *      para llegar al fondo, hay un **faltante**, que es un hecho grave y no
 *      se compensa solo.
 *   3. La **diferencia entre lo que declaró quien entrega y lo que contó quien
 *      recibe se calcula, nunca se almacena**. Un dato derivado que se guarda
 *      es un dato que se desincroniza, igual que los conflictos de importación.
 *
 * Los montos se manejan en la unidad menor de cada divisa (pesos para CLP,
 * centavos para USD) como enteros. Multiplicar cantidades por valores con
 * decimales en coma flotante produce 149.99999 donde debía haber 150.
 */

export type CashMediumValue = 'BILLETE' | 'MONEDA';

export const CASH_MEDIUM_LABELS: Record<CashMediumValue, string> = {
  BILLETE: 'Billete',
  MONEDA: 'Moneda',
};

export type CashCountKindValue = 'DECLARADO' | 'CONFIRMADO';

export const CASH_COUNT_KIND_LABELS: Record<CashCountKindValue, string> = {
  DECLARADO: 'Declarado por quien entrega',
  CONFIRMADO: 'Confirmado por quien recibe',
};

/** Una denominación con la cantidad contada. */
export type CountedDenomination = {
  currency: string;
  /** Valor en la unidad menor de la divisa: 20000 (CLP), 10000 = US$100. */
  minorValue: number;
  quantity: number;
};

/** Fondo fijo de una divisa, en la unidad menor. */
export type FundTarget = { currency: string; minorAmount: number };

/**
 * Cuántos decimales tiene la unidad menor de cada divisa.
 *
 * El peso chileno no usa centavos: CLP 1.000 son mil unidades menores, no cien
 * mil. Tratarlas igual que el dólar multiplicaría por cien cada monto.
 */
const MINOR_UNITS: Record<string, number> = { CLP: 0, USD: 2, EUR: 2 };

export function minorUnitDigits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

/** Pasa un monto escrito por una persona («150,50») a unidad menor. */
export function toMinor(amount: number, currency: string): number {
  const factor = 10 ** minorUnitDigits(currency);
  return Math.round(amount * factor);
}

/** Pasa unidad menor a monto legible. */
export function fromMinor(minor: number, currency: string): number {
  const factor = 10 ** minorUnitDigits(currency);
  return minor / factor;
}

/** Total contado por divisa, en unidad menor. */
export function countTotals(lines: CountedDenomination[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity === 0) continue;
    const currency = line.currency.toUpperCase();
    const previous = totals.get(currency) ?? 0;
    totals.set(currency, previous + line.minorValue * line.quantity);
  }
  return totals;
}

export type FundStatus = {
  currency: string;
  /** Lo que debe quedar en caja. */
  fundMinor: number;
  /** Lo que hay contado. */
  countedMinor: number;
  /**
   * Positivo: excedente sobre el fondo, que es la recaudación a entregar.
   * Negativo: faltante respecto del fondo.
   */
  differenceMinor: number;
  /** Excedente entregable a tesorería. Nunca negativo. */
  surplusMinor: number;
  /** Lo que falta para completar el fondo. Nunca negativo. */
  shortfallMinor: number;
  balanced: boolean;
};

/**
 * Compara lo contado con el fondo fijo de cada divisa.
 *
 * Se recorren los FONDOS, no lo contado: una divisa con fondo configurado y
 * cero contado es un faltante que hay que ver, no una fila que desaparece.
 * Una divisa contada sin fondo configurado también aparece, con fondo cero,
 * porque es dinero que está en el cajón y alguien tiene que responder por él.
 */
export function fundStatuses(
  funds: FundTarget[],
  lines: CountedDenomination[],
): FundStatus[] {
  const counted = countTotals(lines);
  const currencies = new Set<string>([
    ...funds.map((fund) => fund.currency.toUpperCase()),
    ...counted.keys(),
  ]);

  return [...currencies]
    .sort((a, b) => a.localeCompare(b))
    .map((currency) => {
      const fundMinor =
        funds.find((fund) => fund.currency.toUpperCase() === currency)?.minorAmount ?? 0;
      const countedMinor = counted.get(currency) ?? 0;
      const differenceMinor = countedMinor - fundMinor;
      return {
        currency,
        fundMinor,
        countedMinor,
        differenceMinor,
        surplusMinor: Math.max(differenceMinor, 0),
        shortfallMinor: Math.max(-differenceMinor, 0),
        balanced: differenceMinor === 0,
      };
    });
}

/**
 * Diferencia entre el arqueo declarado y el confirmado, por divisa.
 *
 * Sólo devuelve las divisas donde los dos conteos NO coinciden: si todo cuadra
 * no hay nada que mostrar, y una lista vacía es la respuesta correcta.
 */
export function countDiscrepancies(
  declared: CountedDenomination[],
  confirmed: CountedDenomination[],
): Array<{ currency: string; declaredMinor: number; confirmedMinor: number; differenceMinor: number }> {
  const a = countTotals(declared);
  const b = countTotals(confirmed);
  const currencies = new Set<string>([...a.keys(), ...b.keys()]);

  return [...currencies]
    .sort((x, y) => x.localeCompare(y))
    .map((currency) => {
      const declaredMinor = a.get(currency) ?? 0;
      const confirmedMinor = b.get(currency) ?? 0;
      return {
        currency,
        declaredMinor,
        confirmedMinor,
        differenceMinor: confirmedMinor - declaredMinor,
      };
    })
    .filter((row) => row.differenceMinor !== 0);
}

/**
 * ¿Se puede entregar el turno con este arqueo?
 *
 * No se exige que la caja cuadre para entregar —un faltante existe y hay que
 * poder declararlo, no esconderlo— pero sí que el arqueo esté hecho y que un
 * descuadre venga explicado. Una caja descuadrada sin una palabra es lo único
 * que se rechaza.
 */
export function cashHandoverProblems(params: {
  statuses: FundStatus[];
  hasNotes: boolean;
}): string[] {
  const problems: string[] = [];
  const unbalanced = params.statuses.filter((status) => !status.balanced);

  if (unbalanced.length > 0 && !params.hasNotes) {
    const detail = unbalanced
      .map((status) =>
        status.shortfallMinor > 0
          ? `falta ${fromMinor(status.shortfallMinor, status.currency)} ${status.currency}`
          : `sobra ${fromMinor(status.surplusMinor, status.currency)} ${status.currency}`,
      )
      .join('; ');
    problems.push(
      `La caja no coincide con el fondo fijo (${detail}). Explica la diferencia antes de entregar.`,
    );
  }
  return problems;
}

/** Cantidades negativas o con decimales no son un conteo de billetes. */
export function assertValidQuantities(lines: Array<{ quantity: number }>): void {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error('Las cantidades del arqueo deben ser números enteros no negativos.');
    }
  }
}
