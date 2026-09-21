import {
  mostAdvancedStayStatus,
  type StayStage,
  type StayStatus,
} from '../rooms';

export type ReconciliationEvidence = {
  id: string;
  reservationId: string;
  externalId: string | null;
  guestNames: string[];
  roomId: string | null;
  arrivalDate: Date | null;
  departureDate: Date | null;
  businessDate: Date;
  status: StayStatus;
  stage: StayStage;
  /** Segmento de destino creado por el flujo explícito de cambio de habitación. */
  roomMove: boolean;
};

export type IncomingEvidence = Omit<ReconciliationEvidence, 'id' | 'stage' | 'roomMove'>;

export type ReconciliationIssue =
  | 'SECUENCIA_TEMPORAL_INVALIDA'
  | 'IDENTIFICADORES_INCOMPATIBLES'
  | 'HUESPED_INCOMPATIBLE'
  | 'FECHAS_INCOMPATIBLES'
  | 'HABITACION_INCOMPATIBLE'
  | 'OCUPACION_INCOMPATIBLE';

export type ReconciliationDecision =
  | { kind: 'CREATE' }
  | {
      kind: 'MATCH';
      stay: ReconciliationEvidence;
      duplicateIds: string[];
    }
  | { kind: 'CONFLICT'; issue: ReconciliationIssue; detail: string };

function day(value: Date | null): number | null {
  return value?.getTime() ?? null;
}

function sameIdentity(a: ReconciliationEvidence, b: IncomingEvidence): boolean {
  if (a.reservationId === b.reservationId) return true;
  if (a.externalId && a.externalId === b.externalId) return true;
  if (a.externalId && a.externalId === b.reservationId) return true;
  return Boolean(b.externalId && b.externalId === a.reservationId);
}

/**
 * Clave estable de una ocurrencia operacional.
 *
 * El estado no participa: CHECK_IN, IN_HOUSE y CHECK_OUT son evidencia de la
 * evolución de una misma estancia. La llegada separa una salida y posterior
 * reentrada con el mismo código. Si falta, la salida y por último el día
 * operativo son respaldos deliberadamente conservadores.
 */
export function operationalOccurrenceKey(input: {
  reservationId: string;
  roomId: string | null;
  arrivalDate: Date | null;
  departureDate: Date | null;
  businessDate: Date;
}): string {
  const anchor = input.arrivalDate ?? input.departureDate ?? input.businessDate;
  return `${input.reservationId}|${input.roomId ?? ''}|${anchor.toISOString().slice(0, 10)}`;
}

function sameOccurrence(a: ReconciliationEvidence, b: IncomingEvidence): boolean {
  if (a.roomId !== b.roomId || !sameIdentity(a, b)) return false;

  const aArrival = day(a.arrivalDate);
  const bArrival = day(b.arrivalDate);
  if (aArrival !== null && bArrival !== null) {
    if (aArrival === bArrival) return true;
    // El PMS suele conservar la llegada original del hotel después de un room
    // move, mientras el Libro abre el segmento de destino el día del traslado.
    // Sólo se acepta como la misma ocurrencia si ese cambio ya fue registrado
    // explícitamente y los intervalos todavía se solapan.
    if (a.roomMove && a.stage !== 'FINALIZADO') {
      const aDeparture = day(a.departureDate);
      const bDeparture = day(b.departureDate);
      return (
        (aDeparture === null || bArrival < aDeparture) &&
        (bDeparture === null || aArrival < bDeparture)
      );
    }
    return false;
  }

  const aDeparture = day(a.departureDate);
  const bDeparture = day(b.departureDate);
  if (aDeparture !== null && bDeparture !== null) return aDeparture === bDeparture;

  // Sin fechas, una identidad todavía activa sigue siendo la misma realidad
  // al día siguiente: es el caso de los informes resumidos que sólo traen ID,
  // habitación y estado. Una finalizada sí exige el mismo día para no absorber
  // una reutilización posterior del código.
  return a.stage !== 'FINALIZADO' || day(a.businessDate) === day(b.businessDate);
}

function statusRank(status: StayStatus): number {
  if (status === 'CHECK_OUT') return 2;
  if (status === 'IN_HOUSE') return 1;
  return 0;
}

function guestTokens(names: string[]): Set<string> {
  return new Set(
    names.flatMap((name) =>
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((token) => token.length >= 2),
    ),
  );
}

function clearlyDifferentGuests(a: string[], b: string[]): boolean {
  const left = guestTokens(a);
  const right = guestTokens(b);
  if (!left.size || !right.size) return false;
  return ![...left].some((token) => right.has(token));
}

function canonical(candidates: ReconciliationEvidence[]): ReconciliationEvidence {
  const active = candidates.filter((candidate) => candidate.stage !== 'FINALIZADO');
  return [...(active.length ? active : candidates)].sort((a, b) => {
    const status = statusRank(b.status) - statusRank(a.status);
    if (status) return status;
    return b.businessDate.getTime() - a.businessDate.getTime();
  })[0]!;
}

function clearlyNewOccurrence(
  candidates: ReconciliationEvidence[],
  incoming: IncomingEvidence,
): boolean {
  if (!incoming.arrivalDate || incoming.status === 'CHECK_OUT') return false;
  return candidates.every(
    (candidate) =>
      candidate.departureDate !== null &&
      candidate.departureDate.getTime() <= incoming.arrivalDate!.getTime(),
  );
}

export function decideStayReconciliation(
  existing: ReconciliationEvidence[],
  incoming: IncomingEvidence,
  options: { reservationAppearsInSeveralRooms?: boolean } = {},
): ReconciliationDecision {
  if (
    incoming.arrivalDate &&
    incoming.departureDate &&
    incoming.departureDate.getTime() < incoming.arrivalDate.getTime()
  ) {
    return {
      kind: 'CONFLICT',
      issue: 'SECUENCIA_TEMPORAL_INVALIDA',
      detail: 'La fecha de salida es anterior a la fecha de llegada.',
    };
  }

  const identity = existing.filter((stay) => sameIdentity(stay, incoming));
  const sameRoom = identity.filter((stay) => stay.roomId === incoming.roomId);
  const matches = sameRoom.filter((stay) => sameOccurrence(stay, incoming));

  if (matches.length) {
    const stay = canonical(matches);
    if (
      stay.externalId &&
      incoming.externalId &&
      stay.externalId !== incoming.externalId
    ) {
      return {
        kind: 'CONFLICT',
        issue: 'IDENTIFICADORES_INCOMPATIBLES',
        detail:
          `La reserva ${incoming.reservationId} tiene localizadores incompatibles ` +
          `(${stay.externalId} y ${incoming.externalId}).`,
      };
    }
    if (clearlyDifferentGuests(stay.guestNames, incoming.guestNames)) {
      return {
        kind: 'CONFLICT',
        issue: 'HUESPED_INCOMPATIBLE',
        detail:
          `La reserva ${incoming.reservationId} está asociada a huéspedes claramente ` +
          'diferentes en evidencias de la misma estancia.',
      };
    }

    const statusDelta = statusRank(incoming.status) - statusRank(stay.status);
    const dateDelta = incoming.businessDate.getTime() - stay.businessDate.getTime();
    const extension =
      stay.status === 'CHECK_OUT' &&
      incoming.status === 'IN_HOUSE' &&
      dateDelta > 0 &&
      incoming.departureDate !== null &&
      (stay.departureDate === null ||
        incoming.departureDate.getTime() > stay.departureDate.getTime());
    if ((statusDelta > 0 && dateDelta < 0) || (statusDelta < 0 && dateDelta > 0 && !extension)) {
      return {
        kind: 'CONFLICT',
        issue: 'SECUENCIA_TEMPORAL_INVALIDA',
        detail:
          `La secuencia ${stay.status} (${stay.businessDate.toISOString().slice(0, 10)}) → ` +
          `${incoming.status} (${incoming.businessDate.toISOString().slice(0, 10)}) no es coherente.`,
      };
    }
    return {
      kind: 'MATCH',
      stay,
      duplicateIds: matches.filter((candidate) => candidate.id !== stay.id).map((candidate) => candidate.id),
    };
  }

  const activeSameRoom = sameRoom.filter((stay) => stay.stage !== 'FINALIZADO');
  if (activeSameRoom.length && !clearlyNewOccurrence(activeSameRoom, incoming)) {
    return {
      kind: 'CONFLICT',
      issue: 'FECHAS_INCOMPATIBLES',
      detail:
        `La reserva ${incoming.reservationId} ya tiene una estancia activa en la habitación ` +
        'con fechas incompatibles con la nueva evidencia.',
    };
  }

  const activeOtherRoom = identity.filter(
    (stay) => stay.roomId !== incoming.roomId && stay.stage !== 'FINALIZADO',
  );
  const sameLocatorElsewhere = activeOtherRoom.some(
    (stay) => stay.externalId && incoming.externalId && stay.externalId === incoming.externalId,
  );
  if (sameLocatorElsewhere && !options.reservationAppearsInSeveralRooms) {
    return {
      kind: 'CONFLICT',
      issue: 'HABITACION_INCOMPATIBLE',
      detail:
        `El localizador ${incoming.externalId} ya está activo en otra habitación ` +
        'y no existe un cambio de habitación conciliado.',
    };
  }

  const incompatibleOccupancy = existing.find(
    (stay) =>
      stay.roomId === incoming.roomId &&
      stay.stage !== 'FINALIZADO' &&
      !sameIdentity(stay, incoming) &&
      stay.status === incoming.status &&
      (incoming.status === 'IN_HOUSE' || incoming.status === 'CHECK_IN'),
  );
  if (incompatibleOccupancy) {
    return {
      kind: 'CONFLICT',
      issue: 'OCUPACION_INCOMPATIBLE',
      detail:
        `La habitación ya tiene ${incompatibleOccupancy.status} vigente para la reserva ` +
        `${incompatibleOccupancy.reservationId}.`,
    };
  }

  return { kind: 'CREATE' };
}

export function reconcileStayState(
  existing: ReconciliationEvidence,
  incoming: IncomingEvidence,
): {
  status: StayStatus;
  stage: StayStage;
  acceptIncomingDetails: boolean;
  preserveArrivalDate?: boolean;
} {
  if (existing.stage === 'FINALIZADO') {
    return { status: existing.status, stage: existing.stage, acceptIncomingDetails: false };
  }
  if (incoming.businessDate.getTime() < existing.businessDate.getTime()) {
    return { status: existing.status, stage: existing.stage, acceptIncomingDetails: false };
  }

  const extension =
    existing.status === 'CHECK_OUT' &&
    incoming.status === 'IN_HOUSE' &&
    incoming.businessDate.getTime() > existing.businessDate.getTime() &&
    incoming.departureDate !== null &&
    (existing.departureDate === null ||
      incoming.departureDate.getTime() > existing.departureDate.getTime());

  const status = extension
    ? incoming.status
    : mostAdvancedStayStatus(existing.status, incoming.status);

  if (status === existing.status) {
    const weakerEvidence = statusRank(incoming.status) < statusRank(existing.status);
    const result: {
      status: StayStatus;
      stage: StayStage;
      acceptIncomingDetails: boolean;
      preserveArrivalDate?: boolean;
    } = {
      status,
      stage: existing.stage,
      acceptIncomingDetails: !weakerEvidence,
    };
    if (
      result.acceptIncomingDetails &&
      existing.roomMove &&
      day(existing.arrivalDate) !== day(incoming.arrivalDate)
    ) {
      result.preserveArrivalDate = true;
    }
    return result;
  }

  const result: {
    status: StayStatus;
    stage: StayStage;
    acceptIncomingDetails: boolean;
    preserveArrivalDate?: boolean;
  } = {
    status,
    stage:
      status === 'IN_HOUSE'
        ? 'CONFIRMADO'
        : 'PENDIENTE',
    acceptIncomingDetails: true,
  };
  if (existing.roomMove && day(existing.arrivalDate) !== day(incoming.arrivalDate)) {
    result.preserveArrivalDate = true;
  }
  return result;
}
