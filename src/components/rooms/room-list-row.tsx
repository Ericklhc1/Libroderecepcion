import Link from 'next/link';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  ROOM_STATE_ACTIONS,
  ROOM_STATE_LABELS,
  ROOM_STATE_TONE,
  primaryGuest,
  type RoomSnapshot,
} from '@/domain/rooms';

export function RoomListRow({
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
  const mainStay = snapshot.current ?? snapshot.outgoing ?? snapshot.incoming;

  return (
    <Link
      href={`/habitaciones/${room.number}`}
      className="group grid gap-2 border-b border-slate-100 px-3 py-3 transition-colors last:border-b-0 hover:bg-slate-50 sm:grid-cols-[5rem_9rem_minmax(0,1fr)_minmax(0,1fr)_8rem] sm:items-center"
    >
      <div className="flex items-center justify-between gap-2 sm:block">
        <div>
          <p className="text-base font-semibold tabular text-petrol-900">{room.number}</p>
          <p className="text-[0.7rem] text-slate-500">Piso {room.floor ?? '—'}</p>
        </div>
        <div className="sm:hidden">
          <Badge tone={ROOM_STATE_TONE[snapshot.state]}>{ROOM_STATE_LABELS[snapshot.state]}</Badge>
        </div>
      </div>

      <div className="hidden sm:block">
        <Badge tone={ROOM_STATE_TONE[snapshot.state]}>{ROOM_STATE_LABELS[snapshot.state]}</Badge>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-petrol-900">
          {mainStay ? primaryGuest(mainStay) : 'Sin huésped informado'}
        </p>
        <p className="truncate text-xs text-slate-500">
          {mainStay?.reservationId ? `ID ${mainStay.reservationId}` : ROOM_STATE_ACTIONS[snapshot.state]}
        </p>
      </div>

      <div className="min-w-0 text-xs text-slate-600">
        {snapshot.outgoing ? (
          <p className="truncate"><span className="font-medium">Sale:</span> {primaryGuest(snapshot.outgoing)}</p>
        ) : null}
        {snapshot.incoming ? (
          <p className="truncate"><span className="font-medium">Entra:</span> {primaryGuest(snapshot.incoming)}</p>
        ) : null}
        {!snapshot.outgoing && !snapshot.incoming ? (
          <p className="truncate">{ROOM_STATE_ACTIONS[snapshot.state]}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 sm:justify-end">
        <span className="inline-flex items-center gap-1" title="Llaves fuera">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="tabular font-medium">{snapshot.keysOut.length}</span>
        </span>
        {room.openIncidents > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-orange-700" title="Incidencias abiertas">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular">{room.openIncidents}</span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
