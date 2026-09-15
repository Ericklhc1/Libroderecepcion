/**
 * Estado operativo de una habitación.
 *
 * La habitación es la entidad central: sobre ella se apoyan las tres capas que
 * le interesan a recepción —quién sale, quién está dentro, quién entra— y de
 * ellas se deduce, sin guardar nada duplicado, el estado que se muestra en el
 * tablero. Todo aquí es cálculo puro: la base guarda hechos (estadías, llaves)
 * y este archivo los interpreta, de modo que el tablero nunca puede quedar
 * desfasado respecto de los datos.
 */
import type { Tone } from './labels';

export type StayStatus = 'CHECK_IN' | 'IN_HOUSE' | 'CHECK_OUT';
export type StayStage = 'PENDIENTE' | 'CONFIRMADO' | 'FINALIZADO';

/** Lo mínimo que hace falta saber de una estadía para deducir el estado. */
export type StayFacts = {
  id: string;
  reservationId: string;
  guestNames: string[];
  status: StayStatus;
  stage: StayStage;
  arrivalDate: Date | null;
  departureDate: Date | null;
  channel: string | null;
};

export type KeyStatusValue =
  | 'DISPONIBLE'
  | 'ASIGNADA'
  | 'COPIA_ADICIONAL'
  | 'PENDIENTE_DEVOLUCION'
  | 'EXTRAVIADA'
  | 'FUERA_DE_SERVICIO';

export type KeyTypeValue = 'PRINCIPAL' | 'COPIA' | 'MAESTRA';

export type KeyFacts = {
  id: string;
  code: string;
  type: KeyTypeValue;
  status: KeyStatusValue;
  stayId: string | null;
};

/** Estado visual de la habitación. Cada valor tiene un único significado. */
export type RoomState =
  | 'OCUPADA'
  | 'CHECK_OUT_PENDIENTE'
  | 'PENDIENTE_LIBERACION'
  | 'CHECK_IN_EN_COLA'
  | 'CHECK_IN_LISTO'
  | 'DISPONIBLE';

export const ROOM_STATE_LABELS: Record<RoomState, string> = {
  OCUPADA: 'Ocupada',
  CHECK_OUT_PENDIENTE: 'Check-out pendiente',
  PENDIENTE_LIBERACION: 'Pendiente de liberación',
  CHECK_IN_EN_COLA: 'Check-in en cola',
  CHECK_IN_LISTO: 'Check-in listo',
  DISPONIBLE: 'Disponible',
};

/**
 * Qué hay que hacer en cada estado, dicho en una línea. El tablero lo muestra
 * junto al estado para que no haga falta interpretar un color.
 */
export const ROOM_STATE_ACTIONS: Record<RoomState, string> = {
  OCUPADA: 'Sin acción pendiente',
  CHECK_OUT_PENDIENTE: 'Confirmar la salida y recibir la llave',
  PENDIENTE_LIBERACION: 'Confirmar la salida anterior antes de entregar la habitación',
  CHECK_IN_EN_COLA: 'La habitación sigue ocupada: la entrada espera',
  CHECK_IN_LISTO: 'Confirmar el check-in y entregar la llave',
  DISPONIBLE: 'Disponible para asignar',
};

/** Estado de la reserva entrante respecto de la habitación. */
export type IncomingState = 'EN_COLA' | 'LISTO';

export type RoomSnapshot = {
  /** Reserva/huésped con estado CHECK_OUT todavía sin confirmar. */
  outgoing: StayFacts | null;
  /** Reserva/huésped dentro de la habitación. */
  current: StayFacts | null;
  /** Reserva/huésped entrante en espera. */
  incoming: StayFacts | null;
  incomingState: IncomingState | null;
  /**
   * La salida y la entrada son la misma reserva: el PMS lista al huésped en
   * los dos informes porque entra y sale el mismo día (uso diurno). No es una
   * cola: nada bloquea su entrada.
   */
  sameReservationTurnaround: boolean;
  state: RoomState;
  /** Llave principal de la habitación, si existe. */
  mainKey: KeyFacts | null;
  /** Copias adicionales entregadas a la habitación. */
  extraKeys: KeyFacts[];
  /** Llaves que siguen fuera del inventario: asignadas o por devolver. */
  keysOut: KeyFacts[];
};

const ACTIVE_STAGES: StayStage[] = ['PENDIENTE', 'CONFIRMADO'];

function isActive(stay: StayFacts): boolean {
  return ACTIVE_STAGES.includes(stay.stage);
}

/**
 * Elige la estadía más relevante cuando hay varias del mismo tipo: la que
 * todavía está pendiente manda, porque es la que exige una acción.
 */
function pick(stays: StayFacts[], status: StayStatus): StayFacts | null {
  const candidates = stays.filter((stay) => stay.status === status && isActive(stay));
  if (!candidates.length) return null;
  const pending = candidates.find((stay) => stay.stage === 'PENDIENTE');
  return pending ?? candidates[0] ?? null;
}

export function buildRoomSnapshot(stays: StayFacts[], keys: KeyFacts[]): RoomSnapshot {
  const outgoing = pick(stays, 'CHECK_OUT');
  const current = pick(stays, 'IN_HOUSE');
  const incoming = pick(stays, 'CHECK_IN');

  const sameReservationTurnaround = Boolean(
    incoming && outgoing && incoming.reservationId === outgoing.reservationId,
  );

  /*
    Regla de cola: la reserva entrante no puede ocupar la habitación mientras
    siga habiendo alguien dentro o una salida sin confirmar. La comparación es
    por identificador de reserva y no por nombre: el mismo huésped puede salir
    con una reserva y volver a entrar con otra, y son dos hechos distintos.
  */
  const blockedBy =
    incoming && !sameReservationTurnaround
      ? [outgoing, current].find(
          (stay) => stay && stay.reservationId !== incoming.reservationId,
        ) ?? null
      : null;

  const incomingState: IncomingState | null = incoming
    ? blockedBy
      ? 'EN_COLA'
      : 'LISTO'
    : null;

  const mainKey =
    keys.find((key) => key.type === 'PRINCIPAL' && key.status !== 'FUERA_DE_SERVICIO') ??
    keys.find((key) => key.type === 'PRINCIPAL') ??
    null;
  const extraKeys = keys.filter((key) => key.type !== 'PRINCIPAL');
  const keysOut = keys.filter((key) =>
    ['ASIGNADA', 'COPIA_ADICIONAL', 'PENDIENTE_DEVOLUCION'].includes(key.status),
  );

  return {
    outgoing,
    current,
    incoming,
    incomingState,
    sameReservationTurnaround,
    state: deriveRoomState({
      outgoing,
      current,
      incoming,
      incomingState,
      sameReservationTurnaround,
    }),
    mainKey,
    extraKeys,
    keysOut,
  };
}

/**
 * Estado de la habitación a partir de sus tres capas.
 *
 * El orden importa: primero lo que bloquea la operación (una salida sin
 * confirmar con alguien esperando) y al final lo que no exige nada.
 */
export function deriveRoomState(input: {
  outgoing: StayFacts | null;
  current: StayFacts | null;
  incoming: StayFacts | null;
  incomingState: IncomingState | null;
  sameReservationTurnaround?: boolean;
}): RoomState {
  const { outgoing, current, incoming, incomingState } = input;
  if (outgoing && incoming && incomingState === 'EN_COLA') return 'PENDIENTE_LIBERACION';
  /*
    Uso diurno: la misma reserva figura entrando y saliendo hoy. El huésped
    todavía no ha llegado, así que lo primero que hay que hacer es el check-in,
    no la salida.
  */
  if (input.sameReservationTurnaround && incoming) return 'CHECK_IN_LISTO';
  if (outgoing) return 'CHECK_OUT_PENDIENTE';
  if (current && incoming && incomingState === 'EN_COLA') return 'CHECK_IN_EN_COLA';
  if (current) return 'OCUPADA';
  if (incoming) return 'CHECK_IN_LISTO';
  return 'DISPONIBLE';
}

// ------------------------- Reglas de llaves por estado ---------------------

/**
 * Llaves que corresponden a una estadía según su estado operativo.
 *
 * CHECK_IN no tiene llave: la reserva entrante no recibe nada hasta que
 * alguien confirme el check-in. IN_HOUSE exige al menos la principal.
 * CHECK_OUT conserva la llave hasta que la salida se confirme.
 */
export function expectedKeys(status: StayStatus, stage: StayStage): { min: number; max: number } {
  if (status === 'CHECK_IN') return { min: 0, max: 0 };
  if (status === 'IN_HOUSE') return { min: 1, max: Infinity };
  // CHECK_OUT
  return stage === 'FINALIZADO' ? { min: 0, max: 0 } : { min: 1, max: Infinity };
}

export const KEY_STATUS_LABELS: Record<KeyStatusValue, string> = {
  DISPONIBLE: 'Disponible',
  ASIGNADA: 'Asignada a habitación',
  COPIA_ADICIONAL: 'Copia adicional',
  PENDIENTE_DEVOLUCION: 'Pendiente de devolución',
  EXTRAVIADA: 'Extraviada',
  FUERA_DE_SERVICIO: 'Fuera de servicio',
};

export const KEY_TYPE_LABELS: Record<KeyTypeValue, string> = {
  PRINCIPAL: 'Principal',
  COPIA: 'Copia',
  MAESTRA: 'Maestra',
};

/** Estados en los que la llave está fuera del stock disponible. */
export const KEY_OUT_OF_STOCK: KeyStatusValue[] = [
  'ASIGNADA',
  'COPIA_ADICIONAL',
  'PENDIENTE_DEVOLUCION',
  'EXTRAVIADA',
  'FUERA_DE_SERVICIO',
];

export const STAY_STATUS_LABELS: Record<StayStatus, string> = {
  CHECK_IN: 'Check-in',
  IN_HOUSE: 'In house',
  CHECK_OUT: 'Check-out',
};

export const STAY_STAGE_LABELS: Record<StayStage, string> = {
  PENDIENTE: 'Pendiente de confirmar',
  CONFIRMADO: 'Confirmado',
  FINALIZADO: 'Finalizado',
};

/** Nombre del huésped titular, o una marca clara de que el informe no lo trae. */
export function primaryGuest(stay: StayFacts | null): string {
  if (!stay) return '—';
  return stay.guestNames[0] ?? 'Sin nombre en el informe';
}

// --------------------------- Tonos del semáforo ---------------------------

export const ROOM_STATE_TONE: Record<RoomState, Tone> = {
  OCUPADA: 'curso',
  CHECK_OUT_PENDIENTE: 'atencion',
  PENDIENTE_LIBERACION: 'critico',
  CHECK_IN_EN_COLA: 'atencion',
  CHECK_IN_LISTO: 'pendiente',
  DISPONIBLE: 'resuelto',
};

export const STAY_STATUS_TONE: Record<StayStatus, Tone> = {
  CHECK_IN: 'pendiente',
  IN_HOUSE: 'curso',
  CHECK_OUT: 'atencion',
};

export const INCOMING_STATE_LABELS: Record<IncomingState, string> = {
  EN_COLA: 'En cola',
  LISTO: 'Listo para check-in',
};

export const INCOMING_STATE_TONE: Record<IncomingState, Tone> = {
  EN_COLA: 'critico',
  LISTO: 'pendiente',
};

export const KEY_STATUS_TONE: Record<KeyStatusValue, Tone> = {
  DISPONIBLE: 'resuelto',
  ASIGNADA: 'curso',
  COPIA_ADICIONAL: 'curso',
  PENDIENTE_DEVOLUCION: 'atencion',
  EXTRAVIADA: 'critico',
  FUERA_DE_SERVICIO: 'neutro',
};
