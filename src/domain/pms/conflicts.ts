/**
 * Detección de conflictos para revisión humana.
 *
 * El sistema nunca resuelve solo una contradicción de los informes: la muestra.
 * Este archivo trabaja sobre una fotografía del estado —habitaciones, estadías
 * y llaves— y por eso sirve tanto para revisar una importación antes de
 * aplicarla como para vigilar el estado vigente. No guarda nada: los conflictos
 * se recalculan, así que no pueden quedar advertencias viejas colgando.
 */
import type { Tone } from '../labels';
import {
  buildRoomSnapshot,
  expectedKeys,
  type KeyFacts,
  type StayFacts,
} from '../rooms';

export type ConflictKind =
  | 'DOS_IN_HOUSE'
  | 'ENTRADA_CON_SALIDA_PENDIENTE'
  | 'ENTRADA_YA_REALIZADA'
  | 'IN_HOUSE_SIN_LLAVE'
  | 'CHECK_IN_CON_LLAVE'
  | 'SALIDA_CONFIRMADA_CON_LLAVE'
  | 'MULTIPLES_PRINCIPALES'
  | 'INFORMES_CONTRADICTORIOS'
  | 'HABITACION_SIN_NUMERO'
  | 'RESERVA_DUPLICADA'
  | 'HABITACION_DESCONOCIDA';

export const CONFLICT_LABELS: Record<ConflictKind, string> = {
  DOS_IN_HOUSE: 'Dos huéspedes distintos in house',
  ENTRADA_CON_SALIDA_PENDIENTE: 'Entrada sobre habitación con salida pendiente',
  ENTRADA_YA_REALIZADA: 'Entrada que el informe in house ya da por realizada',
  IN_HOUSE_SIN_LLAVE: 'Habitación in house sin llave',
  CHECK_IN_CON_LLAVE: 'Entrada con llave asignada antes del check-in',
  SALIDA_CONFIRMADA_CON_LLAVE: 'Salida confirmada con llave todavía asignada',
  MULTIPLES_PRINCIPALES: 'Más de una llave principal',
  INFORMES_CONTRADICTORIOS: 'La misma reserva con datos distintos en dos informes',
  HABITACION_SIN_NUMERO: 'Fila sin número de habitación',
  RESERVA_DUPLICADA: 'Reserva repetida en el mismo informe',
  HABITACION_DESCONOCIDA: 'Habitación que no existe en el inventario',
};

/** Gravedad con la que se muestra cada conflicto en la revisión. */
export const CONFLICT_TONE: Record<ConflictKind, Tone> = {
  DOS_IN_HOUSE: 'critico',
  ENTRADA_CON_SALIDA_PENDIENTE: 'pendiente',
  ENTRADA_YA_REALIZADA: 'pendiente',
  IN_HOUSE_SIN_LLAVE: 'atencion',
  CHECK_IN_CON_LLAVE: 'critico',
  SALIDA_CONFIRMADA_CON_LLAVE: 'critico',
  MULTIPLES_PRINCIPALES: 'atencion',
  INFORMES_CONTRADICTORIOS: 'atencion',
  HABITACION_SIN_NUMERO: 'critico',
  RESERVA_DUPLICADA: 'atencion',
  HABITACION_DESCONOCIDA: 'atencion',
};

export type Conflict = {
  kind: ConflictKind;
  roomNumber: string | null;
  detail: string;
};

/** Fotografía sobre la que se buscan conflictos. */
export type RoomFacts = {
  number: string;
  stays: StayFacts[];
  keys: KeyFacts[];
};

export type ConflictInput = {
  rooms: RoomFacts[];
  /** Filas que no pudieron asignarse a una habitación. */
  orphanStays: Array<{
    reservationId: string;
    guestNames: string[];
    roomNumber: string | null;
    sourceReport: string;
    reason: string;
  }>;
};

function guestLabel(stay: StayFacts): string {
  return stay.guestNames[0] ?? 'sin nombre';
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return a === b;
  return a.getTime() === b.getTime();
}

export function detectConflicts(input: ConflictInput): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const orphan of input.orphanStays) {
    conflicts.push({
      kind: orphan.roomNumber ? 'HABITACION_DESCONOCIDA' : 'HABITACION_SIN_NUMERO',
      roomNumber: orphan.roomNumber,
      detail:
        `Reserva ${orphan.reservationId} (${orphan.guestNames[0] ?? 'sin nombre'}) del ` +
        `${orphan.sourceReport}: ${orphan.reason}`,
    });
  }

  for (const room of input.rooms) {
    const active = room.stays.filter((stay) => stay.stage !== 'FINALIZADO');
    const snapshot = buildRoomSnapshot(room.stays, room.keys);

    // 1. Dos reservas distintas declaradas dentro de la misma habitación.
    const inHouse = active.filter((stay) => stay.status === 'IN_HOUSE');
    const distinctInHouse = new Set(inHouse.map((stay) => stay.reservationId));
    if (distinctInHouse.size > 1) {
      conflicts.push({
        kind: 'DOS_IN_HOUSE',
        roomNumber: room.number,
        detail: `Reservas ${[...distinctInHouse].join(' y ')} figuran in house a la vez.`,
      });
    }

    // 2. Entrada sobre una habitación que todavía no se ha liberado.
    if (snapshot.incoming && snapshot.incomingState === 'EN_COLA') {
      const blocker = snapshot.outgoing ?? snapshot.current;
      conflicts.push({
        kind: 'ENTRADA_CON_SALIDA_PENDIENTE',
        roomNumber: room.number,
        detail:
          `Entra ${guestLabel(snapshot.incoming)} (reserva ${snapshot.incoming.reservationId}) ` +
          `y la habitación sigue con ${blocker ? guestLabel(blocker) : 'ocupación'} ` +
          `(reserva ${blocker?.reservationId ?? '—'}). La entrada queda en cola.`,
      });
    }

    // 3. Entrada que el in house ya da por dentro: misma reserva en los dos
    //    informes. No es una cola, es un check-in ya realizado por el PMS.
    for (const entering of active.filter((stay) => stay.status === 'CHECK_IN')) {
      const alreadyInside = inHouse.find(
        (stay) => stay.reservationId === entering.reservationId,
      );
      if (alreadyInside) {
        conflicts.push({
          kind: 'ENTRADA_YA_REALIZADA',
          roomNumber: room.number,
          detail:
            `La reserva ${entering.reservationId} (${guestLabel(entering)}) aparece como ` +
            'entrada y también como in house. Confirmar el check-in deja una sola estadía.',
        });
      }
    }

    // 4. Llaves contra estado operativo.
    for (const stay of active) {
      const expected = expectedKeys(stay.status, stay.stage);
      const own = room.keys.filter(
        (key) => key.stayId === stay.id && key.status !== 'DISPONIBLE',
      );
      if (own.length < expected.min) {
        if (stay.status === 'IN_HOUSE') {
          conflicts.push({
            kind: 'IN_HOUSE_SIN_LLAVE',
            roomNumber: room.number,
            detail: `${guestLabel(stay)} está in house sin ninguna llave asignada.`,
          });
        }
      }
      if (own.length > expected.max) {
        conflicts.push({
          kind: 'CHECK_IN_CON_LLAVE',
          roomNumber: room.number,
          detail:
            `${guestLabel(stay)} todavía está en check-in y ya tiene ` +
            `${own.length} llave(s): ${own.map((key) => key.code).join(', ')}.`,
        });
      }
    }

    /*
      5. Una salida confirmada puede conservar una llave PENDIENTE_DEVOLUCION:
      eso no es una contradicción, es precisamente cómo se representa que el
      huésped ya salió pero el objeto físico todavía no volvió. Sólo hay
      conflicto si la llave quedó como ASIGNADA/COPIA_ADICIONAL, es decir, si
      el C/O no la pasó al estado operativo correcto.
    */
    const settledCheckouts = room.stays.filter(
      (stay) => stay.status === 'CHECK_OUT' && stay.stage === 'FINALIZADO',
    );
    for (const stay of settledCheckouts) {
      const stillAssigned = room.keys.filter(
        (key) =>
          key.stayId === stay.id &&
          ['ASIGNADA', 'COPIA_ADICIONAL'].includes(key.status),
      );
      if (stillAssigned.length) {
        conflicts.push({
          kind: 'SALIDA_CONFIRMADA_CON_LLAVE',
          roomNumber: room.number,
          detail:
            `La salida de ${guestLabel(stay)} está confirmada y ` +
            `${stillAssigned.map((key) => key.code).join(', ')} sigue(n) marcada(s) como entregada(s) ` +
            'en lugar de pendiente(s) de devolución.',
        });
      }
    }

    // 6. Más de una llave principal para la misma habitación.
    const principals = room.keys.filter(
      (key) => key.type === 'PRINCIPAL' && key.status !== 'FUERA_DE_SERVICIO',
    );
    if (principals.length > 1) {
      conflicts.push({
        kind: 'MULTIPLES_PRINCIPALES',
        roomNumber: room.number,
        detail: `Hay ${principals.length} llaves principales: ${principals
          .map((key) => key.code)
          .join(', ')}.`,
      });
    }

    // 7. La misma reserva con datos distintos en dos informes.
    const byReservation = new Map<string, StayFacts[]>();
    for (const stay of room.stays) {
      const list = byReservation.get(stay.reservationId);
      if (list) list.push(stay);
      else byReservation.set(stay.reservationId, [stay]);
    }
    for (const [reservationId, group] of byReservation) {
      const first = group[0];
      if (!first || group.length < 2) continue;
      const mismatch = group.find(
        (stay) =>
          !sameDay(stay.arrivalDate, first.arrivalDate) ||
          !sameDay(stay.departureDate, first.departureDate),
      );
      if (mismatch) {
        conflicts.push({
          kind: 'INFORMES_CONTRADICTORIOS',
          roomNumber: room.number,
          detail:
            `La reserva ${reservationId} trae fechas distintas según el informe: ` +
            group
              .map(
                (stay) =>
                  `${stay.status} ${formatDay(stay.arrivalDate)}→${formatDay(stay.departureDate)}`,
              )
              .join(' | '),
        });
      }

      // 8. La misma reserva repetida con el mismo estado.
      const perStatus = new Map<string, number>();
      for (const stay of group) {
        perStatus.set(stay.status, (perStatus.get(stay.status) ?? 0) + 1);
      }
      for (const [status, count] of perStatus) {
        if (count > 1) {
          conflicts.push({
            kind: 'RESERVA_DUPLICADA',
            roomNumber: room.number,
            detail: `La reserva ${reservationId} aparece ${count} veces como ${status}.`,
          });
        }
      }
    }
  }

  return conflicts;
}

function formatDay(date: Date | null): string {
  if (!date) return '—';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}
