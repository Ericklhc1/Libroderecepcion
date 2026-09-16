import Link from 'next/link';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  INCOMING_STATE_LABELS,
  INCOMING_STATE_TONE,
  ROOM_STATE_ACTIONS,
  ROOM_STATE_LABELS,
  ROOM_STATE_TONE,
  primaryGuest,
  type RoomSnapshot,
} from '@/domain/rooms';

/**
 * Ficha de habitación del tablero.
 *
 * El orden de lectura es el de la operación: número, estado, quién sale, quién
 * está dentro, quién entra, llaves e incidencias. Un recepcionista tiene que
 * entender la habitación sin abrirla.
 */
export function RoomCard({
  room,
}: {
  room: {
    number: string;
    floor: number | null;
    snapshot: RoomSnapshot;
    openIncidents: number;
  };
}) {
  const { snapshot } = room;
  const keysOut = snapshot.keysOut.length;

  return (
    <Link
      href={`/habitaciones/${room.number}`}
      className="card block p-3 transition-shadow hover:shadow-md focus-visible:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold tabular text-petrol-900">{room.number}</p>
          <p className="text-xs text-slate-500">Piso {room.floor ?? '—'}</p>
        </div>
        <Badge tone={ROOM_STATE_TONE[snapshot.state]}>
          {ROOM_STATE_LABELS[snapshot.state]}
        </Badge>
      </div>

      <p className="mt-2 text-xs text-slate-500">{ROOM_STATE_ACTIONS[snapshot.state]}</p>

      <dl className="mt-3 space-y-1.5 text-xs">
        {snapshot.outgoing ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 font-medium text-slate-500">Sale</dt>
            <dd className="min-w-0 flex-1 truncate text-petrol-900">
              {primaryGuest(snapshot.outgoing)}
              <span className="ml-1 tabular text-slate-400">
                · {snapshot.outgoing.reservationId}
              </span>
            </dd>
          </div>
        ) : null}
        {snapshot.current ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 font-medium text-slate-500">Dentro</dt>
            <dd className="min-w-0 flex-1 truncate text-petrol-900">
              {primaryGuest(snapshot.current)}
              <span className="ml-1 tabular text-slate-400">
                · {snapshot.current.reservationId}
              </span>
            </dd>
          </div>
        ) : null}
        {snapshot.incoming ? (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 font-medium text-slate-500">Entra</dt>
            <dd className="min-w-0 flex-1">
              <span className="block truncate text-petrol-900">
                {primaryGuest(snapshot.incoming)}
                <span className="ml-1 tabular text-slate-400">
                  · {snapshot.incoming.reservationId}
                </span>
              </span>
              {snapshot.incomingState ? (
                <Badge
                  tone={INCOMING_STATE_TONE[snapshot.incomingState]}
                  className="mt-1"
                >
                  {INCOMING_STATE_LABELS[snapshot.incomingState]}
                </Badge>
              ) : null}
            </dd>
          </div>
        ) : null}
        {!snapshot.outgoing && !snapshot.current && !snapshot.incoming ? (
          <p className="text-slate-400">Sin movimientos informados.</p>
        ) : null}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="tabular font-medium">{keysOut}</span> llave(s) fuera
          {snapshot.extraKeys.length ? (
            <span className="text-slate-400">
              · {snapshot.extraKeys.length} copia(s)
            </span>
          ) : null}
        </span>
        {room.openIncidents > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-orange-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular">{room.openIncidents}</span> incidencia(s)
          </span>
        ) : null}
        {snapshot.sameReservationTurnaround ? (
          <span className="text-slate-400">Entra y sale hoy</span>
        ) : null}
      </div>
    </Link>
  );
}
