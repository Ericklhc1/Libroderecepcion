import type { Tone } from './labels';

/**
 * Garantías.
 *
 * La garantía es un objeto que se toma sobre una **reserva**, no sobre una
 * habitación: por eso sobrevive a un cambio de habitación y a los turnos.
 *
 * Este archivo es puro: no sabe de base de datos ni de React. Contiene las
 * etiquetas, las transiciones válidas y —lo importante— la derivación del
 * resumen que la reserva ya guardaba antes de que existiera esta entidad.
 */

export type GuaranteeStateValue =
  | 'PENDIENTE'
  | 'VIGENTE'
  | 'DEVUELTA'
  | 'APLICADA_PARCIALMENTE'
  | 'MULTA'
  | 'CERRADA';

export type GuaranteeKindValue =
  | 'TARJETA'
  | 'EFECTIVO'
  | 'TRANSFERENCIA'
  | 'VOUCHER'
  | 'CARTA_EMPRESA'
  | 'OTRO';

/** Resumen que vive en la reserva desde antes. Se conserva tal cual. */
export type ReservationGuaranteeSummary =
  | 'NO_REQUIERE'
  | 'PENDIENTE'
  | 'VALIDADA'
  | 'RECHAZADA';

export const GUARANTEE_STATE_LABELS: Record<GuaranteeStateValue, string> = {
  PENDIENTE: 'Pendiente de tomar',
  VIGENTE: 'Vigente',
  DEVUELTA: 'Devuelta',
  APLICADA_PARCIALMENTE: 'Aplicada parcialmente',
  MULTA: 'Multa cobrada',
  CERRADA: 'Cerrada',
};

export const GUARANTEE_STATE_TONE: Record<GuaranteeStateValue, Tone> = {
  PENDIENTE: 'pendiente',
  VIGENTE: 'curso',
  DEVUELTA: 'resuelto',
  APLICADA_PARCIALMENTE: 'atencion',
  MULTA: 'critico',
  CERRADA: 'neutro',
};

/** Qué hay que hacer en cada estado, en una línea. */
export const GUARANTEE_STATE_ACTIONS: Record<GuaranteeStateValue, string> = {
  PENDIENTE: 'Tomar la garantía o registrar por qué no se pudo',
  VIGENTE: 'Sin acción: se resuelve en la salida',
  DEVUELTA: 'Sin acción pendiente',
  APLICADA_PARCIALMENTE: 'Devolver el saldo o cerrarla',
  MULTA: 'Cobrada como multa: cerrarla cuando corresponda',
  CERRADA: 'Sin acción pendiente',
};

export const GUARANTEE_KIND_LABELS: Record<GuaranteeKindValue, string> = {
  TARJETA: 'Tarjeta',
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  VOUCHER: 'Voucher',
  CARTA_EMPRESA: 'Carta de empresa',
  OTRO: 'Otro',
};

/** Estados en los que la garantía sigue viva y exige resolverse en la salida. */
export const OPEN_GUARANTEE_STATES: GuaranteeStateValue[] = [
  'PENDIENTE',
  'VIGENTE',
  'APLICADA_PARCIALMENTE',
];

/** Estados en los que ya no hay nada que hacer. */
export const SETTLED_GUARANTEE_STATES: GuaranteeStateValue[] = [
  'DEVUELTA',
  'MULTA',
  'CERRADA',
];

/**
 * Transiciones permitidas.
 *
 * Deliberadamente estrechas: una garantía devuelta no puede volver a estar
 * vigente, y una cerrada no se reabre. Corregir un error es tarea de quien
 * administra, no un paso del flujo.
 */
const TRANSITIONS: Record<GuaranteeStateValue, GuaranteeStateValue[]> = {
  PENDIENTE: ['VIGENTE', 'CERRADA'],
  VIGENTE: ['DEVUELTA', 'APLICADA_PARCIALMENTE', 'MULTA', 'CERRADA'],
  APLICADA_PARCIALMENTE: ['DEVUELTA', 'MULTA', 'CERRADA'],
  MULTA: ['CERRADA'],
  DEVUELTA: ['CERRADA'],
  CERRADA: [],
};

export function canTransition(
  from: GuaranteeStateValue,
  to: GuaranteeStateValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: GuaranteeStateValue): GuaranteeStateValue[] {
  return TRANSITIONS[from];
}

/**
 * Deriva el resumen que guarda la reserva a partir de sus garantías.
 *
 * Existe para no romper lo que ya funcionaba: el motor de alertas y la entrega
 * de turno leen `ReservationReference.guaranteeStatus`, y ese campo se conserva.
 *
 * Dos reglas que importan:
 *
 * 1. **Sin ninguna garantía registrada devuelve `null`**, es decir: no tocar.
 *    El campo existía antes que esta entidad y alguien pudo ponerlo a mano en
 *    una reserva que todavía no tiene garantía. Derivar `NO_REQUIERE` ahí
 *    borraría una decisión humana.
 * 2. **Nunca devuelve `RECHAZADA`.** Una tarjeta rechazada es algo que informa
 *    una persona, no un estado que se pueda deducir de las garantías tomadas.
 *    Ese valor sigue siendo manual y sigue disparando `TARJETA_INVALIDA`.
 */
export function deriveReservationGuaranteeSummary(
  states: GuaranteeStateValue[],
): ReservationGuaranteeSummary | null {
  if (states.length === 0) return null;
  if (states.includes('PENDIENTE')) return 'PENDIENTE';
  if (states.some((state) => state !== 'PENDIENTE')) return 'VALIDADA';
  return null;
}

/**
 * Cuánto queda por resolver de una garantía.
 *
 * El monto aplicado y la multa salen del monto tomado; lo que queda es lo que
 * habría que devolver. Nunca negativo: si se aplicó más de lo tomado, el
 * excedente es un cobro aparte y no un saldo a favor del hotel.
 */
export function outstandingAmount(guarantee: {
  amount: number;
  appliedAmount: number | null;
  penaltyAmount: number | null;
}): number {
  const usado = (guarantee.appliedAmount ?? 0) + (guarantee.penaltyAmount ?? 0);
  return Math.max(0, guarantee.amount - usado);
}
