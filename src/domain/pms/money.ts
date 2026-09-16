/**
 * Importes del PMS, con su moneda.
 *
 * El informe imprime dos monedas en el mismo documento y el punto significa
 * cosas DISTINTAS en cada una:
 *
 *   CL$ 916.300   → novecientos dieciséis mil trescientos pesos
 *   US$ 204.12    → doscientos cuatro dólares con doce centavos
 *
 * El mismo carácter es separador de miles en una y separador decimal en la
 * otra, porque el peso chileno no tiene centavos. Interpretarlo sin mirar la
 * moneda es el error que convierte 916.300 pesos en 916,30 —o 204,12 dólares
 * en veinte mil— y esos números terminan en el arqueo de caja y en el saldo
 * que se le cobra al huésped.
 *
 * Por eso acá nunca se devuelve un número solo: se devuelve importe MÁS
 * moneda, juntos, y no hay ninguna función que sume importes de monedas
 * distintas.
 */

export type Currency = 'CLP' | 'USD';

export type Money = {
  /** Importe ya interpretado. Para CLP es entero; para USD admite centavos. */
  amount: number;
  currency: Currency;
};

export const CURRENCY_LABELS: Record<Currency, string> = {
  CLP: 'CL$',
  USD: 'US$',
};

/**
 * Cómo escribe el PMS cada moneda. Se admiten variantes con y sin espacio,
 * y `$` suelto se considera peso: es la moneda local del hotel.
 */
const CURRENCY_MARKS: Array<{ pattern: RegExp; currency: Currency }> = [
  { pattern: /^(?:us\$|usd|u\$s|\bus\b)/i, currency: 'USD' },
  { pattern: /^(?:cl\$|clp|\$)/i, currency: 'CLP' },
];

function detectCurrency(raw: string): { currency: Currency | null; rest: string } {
  const text = raw.trim();
  for (const { pattern, currency } of CURRENCY_MARKS) {
    const match = text.match(pattern);
    if (match) return { currency, rest: text.slice(match[0].length).trim() };
  }
  return { currency: null, rest: text };
}

/**
 * Convierte los dígitos a número sabiendo ya la moneda.
 *
 * En CLP los puntos y espacios son separadores de miles y se quitan; una coma
 * sería decimal, aunque el PMS del hotel no la usa. En USD el último separador
 * seguido de una o dos cifras es el decimal, y cualquier otro es de miles: así
 * `2435.34` son dos mil cuatrocientos treinta y cinco con treinta y cuatro, y
 * `1.234.56` —si alguna vez apareciera— son mil doscientos treinta y cuatro
 * con cincuenta y seis.
 */
function parseDigits(rest: string, currency: Currency): number | null {
  const cleaned = rest.replace(/\s/g, '');
  if (!cleaned) return null;
  if (!/^-?[\d.,]+$/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;

  let value: number;
  if (currency === 'CLP') {
    const comma = body.lastIndexOf(',');
    if (comma >= 0) {
      const decimals = body.slice(comma + 1);
      if (decimals.length > 2 || /\D/.test(decimals)) return null;
      value = Number(`${body.slice(0, comma).replace(/[.,]/g, '')}.${decimals}`);
    } else {
      value = Number(body.replace(/\./g, ''));
    }
  } else {
    const last = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
    if (last < 0) {
      value = Number(body);
    } else {
      const decimals = body.slice(last + 1);
      if (decimals.length >= 1 && decimals.length <= 2) {
        value = Number(`${body.slice(0, last).replace(/[.,]/g, '')}.${decimals}`);
      } else {
        // Tres cifras o más detrás del último punto: es separador de miles.
        value = Number(body.replace(/[.,]/g, ''));
      }
    }
  }

  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Lee un importe del informe.
 *
 * Devuelve `null` cuando el texto no trae moneda o no se puede interpretar. No
 * adivina: un importe sin moneda no se guarda como peso «por si acaso», porque
 * el informe mezcla las dos y equivocarse cuesta dinero real.
 */
export function parseMoney(raw: string | null | undefined): Money | null {
  if (!raw) return null;
  const { currency, rest } = detectCurrency(raw);
  if (!currency) return null;
  const amount = parseDigits(rest, currency);
  if (amount === null) return null;
  return { amount, currency };
}

/** Formatea un importe como lo escribe el PMS, para poder compararlo a ojo. */
export function formatMoney(money: Money): string {
  const { amount, currency } = money;
  const formatted =
    currency === 'CLP'
      ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(amount)
      : new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount);
  return `${CURRENCY_LABELS[currency]} ${formatted}`;
}

/**
 * Suma importes agrupándolos POR MONEDA.
 *
 * No existe una función que devuelva un total único, y es deliberado: sumar
 * pesos con dólares da un número sin significado, y el preview de la
 * importación tiene que mostrar «CL$ X pendientes» y «US$ Y pendientes» como
 * dos cifras separadas.
 */
export function sumByCurrency(amounts: Array<Money | null>): Record<Currency, number> {
  const totals: Record<Currency, number> = { CLP: 0, USD: 0 };
  for (const money of amounts) {
    if (!money) continue;
    totals[money.currency] += money.amount;
  }
  /*
    El dólar se redondea a centavos al final y no en cada suma: acumular
    204.12 + 274.25 + … en coma flotante arrastra un resto de milésimas que
    haría que el total no cuadrara con el que declara el informe.
  */
  totals.USD = Math.round(totals.USD * 100) / 100;
  return totals;
}

/** ¿Dos importes son el mismo? Distinta moneda nunca es lo mismo. */
export function sameMoney(a: Money | null, b: Money | null): boolean {
  if (!a || !b) return a === b;
  return a.currency === b.currency && Math.abs(a.amount - b.amount) < 0.005;
}
