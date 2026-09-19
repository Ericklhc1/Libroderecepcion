import Link from 'next/link';
import { FileUp, KeyRound, LayoutGrid, List } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { listRoomsWithState } from '@/server/services/rooms';
import { getLiveConflicts } from '@/server/services/pms-import';
import { getKeyInventory } from '@/server/services/keys';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoomCard } from '@/components/rooms/room-card';
import { RoomListRow } from '@/components/rooms/room-list-row';
import { ResolveAllConflictsDialog } from '@/components/rooms/resolve-all-conflicts';
import { ROOM_STATE_LABELS, type RoomState } from '@/domain/rooms';
import { CONFLICT_LABELS, CONFLICT_TONE } from '@/domain/pms/conflicts';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Habitaciones' };
export const dynamic = 'force-dynamic';

/**
 * Tono de la ficha resumen. El semáforo completo vive en cada habitación; en
 * las cifras de arriba basta con distinguir lo que exige acción.
 */
const STATE_TILE_TONE: Record<RoomState, 'neutral' | 'alert' | 'good'> = {
  PENDIENTE_LIBERACION: 'alert',
  CHECK_OUT_PENDIENTE: 'alert',
  CHECK_IN_EN_COLA: 'alert',
  CHECK_IN_LISTO: 'neutral',
  OCUPADA: 'neutral',
  DISPONIBLE: 'good',
};

const STATE_ORDER: RoomState[] = [
  'PENDIENTE_LIBERACION',
  'CHECK_OUT_PENDIENTE',
  'CHECK_IN_EN_COLA',
  'CHECK_IN_LISTO',
  'OCUPADA',
  'DISPONIBLE',
];

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePagePermission('room.view');
  const params = await searchParams;
  const estado = typeof params.estado === 'string' ? params.estado : undefined;
  const piso = typeof params.piso === 'string' ? params.piso : undefined;
  const vista = params.vista === 'cuadricula' ? 'cuadricula' : 'lista';

  const canResolveAllConflicts = hasPermission(user, 'conflict.resolve_all');

  const [rooms, conflicts, inventory] = await Promise.all([
    listRoomsWithState(),
    getLiveConflicts(),
    getKeyInventory(),
  ]);

  const counts = new Map<RoomState, number>();
  for (const room of rooms) {
    counts.set(room.snapshot.state, (counts.get(room.snapshot.state) ?? 0) + 1);
  }

  const floors = [...new Set(rooms.map((room) => room.floor).filter((f): f is number => f !== null))].sort();

  // La operación necesita poder recorrer 401, 402, 403… sin saltar entre
  // estados. Los filtros siguen disponibles arriba, pero el orden visible es
  // siempre numérico ascendente para reducir búsquedas visuales innecesarias.
  const visible = rooms
    .filter((room) => (estado ? room.snapshot.state === estado : true))
    .filter((room) => (piso ? String(room.floor) === piso : true))
    .sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));

  const pendingAction = rooms.filter((room) =>
    ['PENDIENTE_LIBERACION', 'CHECK_OUT_PENDIENTE', 'CHECK_IN_LISTO'].includes(
      room.snapshot.state,
    ),
  ).length;

  function roomsHref(next: {
    estado?: string | null;
    piso?: string | null;
    vista?: 'lista' | 'cuadricula';
  }) {
    const query = new URLSearchParams();
    const nextEstado = next.estado === undefined ? estado : next.estado;
    const nextPiso = next.piso === undefined ? piso : next.piso;
    const nextVista = next.vista ?? vista;
    if (nextEstado) query.set('estado', nextEstado);
    if (nextPiso) query.set('piso', nextPiso);
    if (nextVista === 'cuadricula') query.set('vista', 'cuadricula');
    const suffix = query.toString();
    return suffix ? `/habitaciones?${suffix}` : '/habitaciones';
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Habitaciones</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Estado operativo construido con los informes del PMS. El PMS sigue siendo la fuente:
            aquí se ve qué falta confirmar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <Link
            href="/llaves"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-petrol-800 hover:bg-slate-50"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Llaves
          </Link>
          {hasPermission(user, 'pms.import') ? (
            <Link
              href="/habitaciones/importar"
              className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-3 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Importar informes
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATE_ORDER.map((state) => (
          <Link
            key={state}
            href={roomsHref({ estado: estado === state ? null : state })}
          >
            <StatTile
              label={ROOM_STATE_LABELS[state]}
              value={counts.get(state) ?? 0}
              tone={STATE_TILE_TONE[state]}
            />
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-600">
          <span className="font-semibold tabular text-petrol-900">{pendingAction}</span> habitación(es)
          esperan una confirmación
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600">
          Llaves fuera:{' '}
          <span className="font-semibold tabular text-petrol-900">
            {inventory.stock.assigned + inventory.stock.extraCopies + inventory.stock.pendingReturn}
          </span>
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-600">
          Copias en stock:{' '}
          <span className="font-semibold tabular text-petrol-900">{inventory.stock.copiesAvailable}</span>
        </span>
      </div>

      {rooms.every(
        (room) =>
          !room.snapshot.outgoing && !room.snapshot.current && !room.snapshot.incoming,
      ) ? (
        <Card className="border-amber-300">
          <div className="space-y-3 px-4 py-4">
            <p className="text-sm font-semibold text-petrol-900">
              Todavía no hay informes del PMS cargados
            </p>
            <p className="text-sm text-slate-600">
              Por eso las {rooms.length} habitaciones aparecen disponibles: el sistema no
              inventa estadías. En cuanto cargues los tres informes —entradas, in house y
              salidas— cada habitación mostrará su huésped, su reserva, la salida pendiente,
              la entrada en cola y sus llaves.
            </p>
            {hasPermission(user, 'pms.import') ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/turno"
                  className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-petrol-950 transition-colors hover:bg-gold-400 active:bg-gold-600"
                >
                  Cargarlos desde el inicio de turno
                </Link>
                <Link
                  href="/habitaciones/importar"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-petrol-800 transition-colors hover:bg-slate-50"
                >
                  Cargarlos aquí
                </Link>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Tu rol no incluye el permiso «Importar informes del PMS». Se concede en{' '}
                <Link
                  href="/admin/roles"
                  className="font-medium text-petrol-600 hover:underline"
                >
                  Administración → Roles
                </Link>
                .
              </p>
            )}
          </div>
        </Card>
      ) : null}

      {conflicts.length ? (
        <Card>
          <CardHeader
            title="Conflictos para revisar"
            count={conflicts.length}
            action={
              canResolveAllConflicts ? (
                <ResolveAllConflictsDialog count={conflicts.length} />
              ) : undefined
            }
          />
          <ul className="divide-y divide-slate-100">
            {conflicts.slice(0, 8).map((conflict, index) => (
              <li key={`${conflict.kind}-${conflict.roomNumber}-${index}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={CONFLICT_TONE[conflict.kind]}>{CONFLICT_LABELS[conflict.kind]}</Badge>
                  {conflict.roomNumber ? (
                    <Link
                      href={`/habitaciones/${conflict.roomNumber}`}
                      className="text-sm font-medium tabular text-petrol-700 underline-offset-2 hover:underline"
                    >
                      Hab. {conflict.roomNumber}
                    </Link>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-600">{conflict.detail}</p>
              </li>
            ))}
          </ul>
          {conflicts.length > 8 ? (
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Y {conflicts.length - 8} más. Se recalculan solos cuando el estado se corrige.
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-500">Piso</span>
          <Link
            href={roomsHref({ piso: null })}
            className={
              piso
                ? 'rounded-md px-2 py-1 text-petrol-700 hover:bg-slate-100'
                : 'rounded-md bg-petrol-800 px-2 py-1 font-medium text-white'
            }
          >
            Todos
          </Link>
          {floors.map((floor) => (
            <Link
              key={floor}
              href={roomsHref({ piso: String(floor) })}
              className={
                piso === String(floor)
                  ? 'rounded-md bg-petrol-800 px-2 py-1 font-medium tabular text-white'
                  : 'rounded-md px-2 py-1 tabular text-petrol-700 hover:bg-slate-100'
              }
            >
              {floor}
            </Link>
          ))}
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm no-print" aria-label="Vista de habitaciones">
          <Link
            href={roomsHref({ vista: 'lista' })}
            className={
              vista === 'lista'
                ? 'inline-flex items-center gap-1.5 rounded-md bg-petrol-800 px-2.5 py-1.5 font-medium text-white'
                : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-petrol-700 hover:bg-slate-100'
            }
          >
            <List className="h-4 w-4" aria-hidden="true" />
            Lista
          </Link>
          <Link
            href={roomsHref({ vista: 'cuadricula' })}
            className={
              vista === 'cuadricula'
                ? 'inline-flex items-center gap-1.5 rounded-md bg-petrol-800 px-2.5 py-1.5 font-medium text-white'
                : 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-petrol-700 hover:bg-slate-100'
            }
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            Cuadrícula
          </Link>
        </div>
      </div>

      {visible.length ? (
        vista === 'lista' ? (
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[5rem_9rem_minmax(0,1fr)_minmax(0,1fr)_8rem] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
              <span>Hab.</span>
              <span>Estado</span>
              <span>Huésped / ID</span>
              <span>Movimiento</span>
              <span className="text-right">Llaves / Inc.</span>
            </div>
            {visible.map((room) => (
              <RoomListRow key={room.id} room={room} />
            ))}
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        )
      ) : (
        <Card>
          <EmptyState
            message="No hay habitaciones con ese filtro."
            hint={
              rooms.length
                ? 'Prueba con otro estado o piso.'
                : 'Importa los informes del PMS para construir el estado del día.'
            }
          />
        </Card>
      )}
    </div>
  );
}
