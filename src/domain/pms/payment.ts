/**
 * Forma de pago que declara el informe del PMS.
 *
 * El informe imprime un texto libre, y del texto depende una decisión del
 * mesón: si el pago es «Al Hotel» hay que cobrar en recepción, y si es
 * «Prepago Comisión» no hay que cobrar nada aunque el importe no sea cero.
 * Confundirlas es cobrar dos veces a un huésped o dejar de cobrar.
 *
 * Por eso se normaliza a un valor conocido PERO se conserva siempre el texto
 * original. El PMS puede introducir formas nuevas mañana —o escribir la misma
 * con otra tilde— y en ese caso el sistema tiene que seguir guardando el dato
 * tal como vino en vez de perderlo o meterlo a la fuerza en una categoría que
 * no le corresponde.
 */

/** Las formas que el sistema sabe interpretar. `OTRO` no es un error. */
export type PaymentType = 'AL_HOTEL' | 'PREPAGO_COMISION' | 'CREDITO_EMPRESA' | 'OTRO';

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  AL_HOTEL: 'Al hotel',
  PREPAGO_COMISION: 'Prepago comisión',
  CREDITO_EMPRESA: 'Crédito empresa',
  OTRO: 'Otra forma',
};

/**
 * Qué significa cada forma para quien está en el mesón. Es la razón de
 * distinguirlas: la etiqueta sola no dice si hay que cobrar.
 */
export const PAYMENT_TYPE_MEANING: Record<PaymentType, string> = {
  AL_HOTEL: 'Se cobra en recepción',
  PREPAGO_COMISION: 'Ya pagado al canal: no se cobra en recepción',
  CREDITO_EMPRESA: 'Se factura a la empresa: no se cobra al huésped',
  OTRO: 'Forma no reconocida: confirmar antes de cobrar',
};

function fold(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Equivalencias seguras. Se comparan sobre el texto sin tildes ni mayúsculas,
 * porque el informe escribe «Prepago Comision» sin tilde y una plantilla nueva
 * podría escribirla con ella.
 */
const EQUIVALENCES: Array<{ match: RegExp; type: PaymentType }> = [
  { match: /^al hotel$|^pago al hotel$|^en hotel$/, type: 'AL_HOTEL' },
  { match: /prepago|prepaid|comision/, type: 'PREPAGO_COMISION' },
  { match: /credito|empresa|facturar/, type: 'CREDITO_EMPRESA' },
];

export type ParsedPayment = {
  type: PaymentType;
  /** El texto tal como lo imprimió el PMS. Nunca se descarta. */
  raw: string | null;
};

export function parsePaymentType(raw: string | null | undefined): ParsedPayment {
  const original = raw?.trim() || null;
  if (!original) return { type: 'OTRO', raw: null };

  const folded = fold(original);
  for (const { match, type } of EQUIVALENCES) {
    if (match.test(folded)) return { type, raw: original };
  }
  /*
    Sin equivalencia se marca OTRO y se guarda el texto. No se inventa una
    categoría: el preview lo muestra como forma no reconocida y alguien decide.
  */
  return { type: 'OTRO', raw: original };
}

/** ¿Esta forma implica cobrar en recepción? */
export function collectsAtDesk(type: PaymentType): boolean {
  return type === 'AL_HOTEL';
}
