/**
 * Caja de recepción: composición financiera, arqueo del fondo fijo por
 * denominación y transferencias internas.
 *
 * Regla central:
 * - las DENOMINACIONES representan exclusivamente el FONDO FIJO;
 * - las GARANTÍAS EN EFECTIVO se validan una a una, por separado;
 * - el SALDO OPERACIONAL se concilia mediante sus movimientos y transferencias.
 *
 * La composición total sigue siendo útil para saber qué dinero está bajo
 * custodia, pero nunca se usa para exigir que el recepcionista mezcle garantías
 * con el conteo por billetes/monedas del fondo fijo.
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

export type CountedDenomination = {
  currency: string;
  /** Valor en la unidad menor de la divisa: 20000 (CLP), 10000 = US$100. */
  minorValue: number;
  quantity: number;
};

export type FundTarget = { currency: string; minorAmount: number };

/**
 * Composición esperada de una divisa en la Caja física.
 *
 * operationalMinor puede ser negativo si los egresos/ajustes superaron la
 * recaudación disponible. En ese caso no existe monto transferible.
 */
export type CashExpectation = {
  currency: string;
  fundMinor: number;
  guaranteeCustodyMinor: number;
  operationalMinor: number;
  expectedMinor: number;
  transferableMinor: number;
};

export type CashPosition = CashExpectation & {
  countedMinor: number;
  /** contado - esperado; ésta es la diferencia real de arqueo. */
  differenceMinor: number;
  /** Sobrante físico no explicado sobre lo esperado. NO es recaudación. */
  overageMinor: number;
  /** Faltante físico respecto de lo esperado. */
  shortfallMinor: number;
  /**
   * Alias histórico para no romper consumidores antiguos.
   * Desde v1.3.1 significa sobrante físico NO explicado, nunca monto transferible.
   */
  surplusMinor: number;
  balanced: boolean;
};

/** Nombre histórico conservado por compatibilidad de tipos. */
export type FundStatus = CashPosition;

const MINOR_UNITS: Record<string, number> = { CLP: 0, USD: 2, EUR: 2 };

export function minorUnitDigits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

export function toMinor(amount: number, currency: string): number {
  const factor = 10 ** minorUnitDigits(currency);
  return Math.round(amount * factor);
}

export function fromMinor(minor: number, currency: string): number {
  const factor = 10 ** minorUnitDigits(currency);
  return minor / factor;
}

export function countTotals(lines: CountedDenomination[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity === 0) continue;
    const currency = line.currency.toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + line.minorValue * line.quantity);
  }
  return totals;
}

export function normalizeExpectation(input: {
  currency: string;
  fundMinor?: number;
  guaranteeCustodyMinor?: number;
  operationalMinor?: number;
}): CashExpectation {
  const currency = input.currency.toUpperCase();
  const fundMinor = input.fundMinor ?? 0;
  const guaranteeCustodyMinor = input.guaranteeCustodyMinor ?? 0;
  const operationalMinor = input.operationalMinor ?? 0;
  const expectedMinor = fundMinor + guaranteeCustodyMinor + operationalMinor;
  return {
    currency,
    fundMinor,
    guaranteeCustodyMinor,
    operationalMinor,
    expectedMinor,
    transferableMinor: Math.max(operationalMinor, 0),
  };
}

/** Compara el conteo físico contra la composición esperada real de Caja. */
export function cashStatuses(
  expectations: CashExpectation[],
  lines: CountedDenomination[],
): CashPosition[] {
  const counted = countTotals(lines);
  const currencies = new Set<string>([
    ...expectations.map((row) => row.currency.toUpperCase()),
    ...counted.keys(),
  ]);

  return [...currencies]
    .sort((a, b) => a.localeCompare(b))
    .map((currency) => {
      const expectation =
        expectations.find((row) => row.currency.toUpperCase() === currency) ??
        normalizeExpectation({ currency });
      const countedMinor = counted.get(currency) ?? 0;
      const differenceMinor = countedMinor - expectation.expectedMinor;
      const overageMinor = Math.max(differenceMinor, 0);
      return {
        ...expectation,
        currency,
        countedMinor,
        differenceMinor,
        overageMinor,
        surplusMinor: overageMinor,
        shortfallMinor: Math.max(-differenceMinor, 0),
        balanced: differenceMinor === 0,
      };
    });
}

/**
 * Compatibilidad para código/pruebas que sólo modelan fondo fijo.
 * No debe usarse para el cierre real cuando existen movimientos o garantías.
 */
export function fundStatuses(
  funds: FundTarget[],
  lines: CountedDenomination[],
): FundStatus[] {
  return cashStatuses(
    funds.map((fund) =>
      normalizeExpectation({ currency: fund.currency, fundMinor: fund.minorAmount }),
    ),
    lines,
  );
}

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
 * Una diferencia del fondo fijo se puede declarar y entregar; ocultarla no.
 * Las garantías se validan aparte y no alteran este cálculo.
 */
export function cashHandoverProblems(params: {
  statuses: CashPosition[];
  hasNotes: boolean;
}): string[] {
  const unbalanced = params.statuses.filter((status) => !status.balanced);
  if (unbalanced.length === 0 || params.hasNotes) return [];

  const detail = unbalanced
    .map((status) =>
      status.shortfallMinor > 0
        ? `falta ${fromMinor(status.shortfallMinor, status.currency)} ${status.currency}`
        : `sobra ${fromMinor(status.overageMinor, status.currency)} ${status.currency}`,
    )
    .join('; ');

  return [
    `El efectivo contado no coincide con el efectivo esperado (${detail}). Explica la diferencia antes de entregar.`,
  ];
}

export function assertValidQuantities(lines: Array<{ quantity: number }>): void {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new Error('Las cantidades del arqueo deben ser números enteros no negativos.');
    }
  }
}
