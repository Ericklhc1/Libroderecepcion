import Link from 'next/link';
import {
  AlarmClock,
  Banknote,
  ClipboardCheck,
  DoorOpen,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getRoomOperationsBoard, type RoomMonitorItem } from '@/server/services/room-operations';
import { hasPermission } from '@/server/auth/current-user';
import { formatDateTime } from '@/lib/format';
import { HOTEL_ROOM_RANGES } from '@/domain/hotel-rooms';
import { ViewTabs } from '@/components/layout/view-tabs';

export const metadata = { title: 'Novedades · Habitaciones' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS = [
  { label: 'Novedades', href: '/libro?clase=entry' },
  { label: 'Incidencias', href: '/libro?clase=entry&tipo=INCIDENCIA' },
  { label: 'Habitaciones', href: '/libro/habitaciones' },
  { label: 'Mis tareas', href: '/libro?clase=task' },
];

const KIND_LABEL: Record<RoomMonitorItem['kind'], string> = {
  NOVEDAD: 'Novedad',
  INCIDENCIA: 'Incidencia',
  TAREA: 'Tarea',
  ALERTA: 'Alerta',
  GARANTIA: 'Garantía',
  GIMNASIO: 'Gimnasio',
  ESTACIONAMIENTO: 'Estacionamiento',
};

const KIND_ICON = {
  NOVEDAD: ClipboardCheck,
  INCIDENCIA: ShieldAlert,
  TAREA: ListChecks,
  ALERTA: AlarmClock,
  GARANTIA: Banknote,
  GIMNASIO: Ticket,
  ESTACIONAMIENTO: Ticket,
} satisfies Record<RoomMonitorItem['kind'], typeof ClipboardCheck>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function roomHref(input: {
  room: string;
  floor: string;
  state: string;
}) {
  const search = new URLSearchParams();
  search.set('habitacion', input.room);
  if (input.floor && input.floor !== 'todos') search.set('piso', input.floor);
  if (input.state && input.state !== 'todos') search.set('estado', input.state);
  return `/libro/habitaciones?${search.toString()}`;
}

function filterHref(input: {
  floor?: string;
  state?: string;
  selected?: string;
}) {
  const search = new URLSearchParams();
  if (input.floor && input.floor !== 'todos') search.set('piso', input.floor);
  if (input.state && input.state !== 'todos') search.set('estado', input.state);
  if (input.selected) search.set('habitacion', input.selected);
  const suffix = search.toString();
  return suffix ? `/libro/habitaciones?${suffix}` : '/libro/habitaciones';
}

export default async function RoomOperationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const floor = one(params.piso) || 'todos';
  const state = one(params.estado) || 'todos';
  const selectedRoom = one(params.habitacion) || null;
  const includeCashContext = hasPermission(user, 'cash.view');

  const board = await getRoomOperationsBoard({
    includeCashContext,
    selectedRoomNumber: selectedRoom,
  });

  const visibleRooms = board.rooms.filter((room) => {
    if (floor !== 'todos' && String(room.floor) !== floor) return false;
    if (state === 'actividad' && room.openCount === 0) return false;
    if (state === 'criticas' && room.criticalCount === 0) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="border-b border-slate-300 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-gold-600">
              Novedades / Habitación
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-petrol-950">
              Monitor operativo por habitación
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Las 89 habitaciones como contexto de la operación. Aquí convergen novedades,
              incidencias, tareas, alertas y —si tu rol puede ver Caja— garantías y servicios.
              No representa ocupación ni reemplaza al PMS.
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-300 bg-white shadow-card">
            <div className="px-4 py-2 text-center">
              <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">Habitaciones</p>
              <p className="mt-0.5 text-xl font-semibold tabular text-petrol-950">{board.summary.totalRooms}</p>
            </div>
            <div className="px-4 py-2 text-center">
              <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">Con pendientes</p>
              <p className="mt-0.5 text-xl font-semibold tabular text-gold-700">{board.summary.withOpenContext}</p>
            </div>
            <div className="px-4 py-2 text-center">
              <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">Críticas</p>
              <p className="mt-0.5 text-xl font-semibold tabular text-red-700">{board.summary.withCriticalContext}</p>
            </div>
          </div>
        </div>
      </header>

      <ViewTabs label="Vista operativa" activeHref="/libro/habitaciones" tabs={TABS} />

      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Filtros del monitor">
        <div className="flex flex-wrap gap-1.5">
          {['todos', '4', '5', '6'].map((value) => (
            <Link
              key={value}
              href={filterHref({ floor: value, state, selected: selectedRoom ?? undefined })}
              aria-current={floor === value ? 'page' : undefined}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium ring-1 ${
                floor === value
                  ? 'bg-petrol-950 text-white ring-petrol-950'
                  : 'bg-white text-petrol-800 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {value === 'todos' ? 'Todos los pisos' : `Piso ${value}`}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: 'todos', label: 'Todas' },
            { value: 'actividad', label: 'Con pendientes' },
            { value: 'criticas', label: 'Críticas' },
          ].map((filter) => (
            <Link
              key={filter.value}
              href={filterHref({ floor, state: filter.value })}
              aria-current={state === filter.value ? 'page' : undefined}
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ring-1 ${
                state === filter.value
                  ? 'bg-gold-50 text-gold-800 ring-gold-300'
                  : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-5">
          {HOTEL_ROOM_RANGES.filter((range) => floor === 'todos' || String(range.floor) === floor).map((range) => {
            const rooms = visibleRooms.filter((room) => room.floor === range.floor);
            if (rooms.length === 0) return null;
            return (
              <section key={range.floor} aria-labelledby={`floor-${range.floor}`}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 id={`floor-${range.floor}`} className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Piso {range.floor}
                  </h2>
                  <span className="text-xs text-slate-400">{rooms.length} habitación(es)</span>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 xl:grid-cols-8 2xl:grid-cols-10">
                  {rooms.map((room) => {
                    const active = board.selected?.number === room.number;
                    const critical = room.criticalCount > 0;
                    const hasOpen = room.openCount > 0;
                    return (
                      <Link
                        key={room.id}
                        href={roomHref({ room: room.number, floor, state })}
                        aria-current={active ? 'page' : undefined}
                        className={`group relative min-h-[6.4rem] rounded-md border p-2.5 transition-[border-color,background-color,box-shadow,transform] focus:outline-none focus:ring-2 focus:ring-gold-400 ${
                          active
                            ? 'border-gold-500 bg-gold-50 shadow-card'
                            : critical
                              ? 'border-red-300 bg-red-50/60 hover:border-red-400'
                              : hasOpen
                                ? 'border-cyan-300 bg-cyan-50/55 hover:border-cyan-400'
                                : 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-lg font-semibold tabular text-petrol-950">{room.number}</span>
                          {critical ? (
                            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-red-600" title="Requiere atención prioritaria" />
                          ) : hasOpen ? (
                            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-gold-500" title="Tiene contexto operativo abierto" />
                          ) : (
                            <span className="mt-1 h-2 w-2 rounded-full bg-slate-200" />
                          )}
                        </div>
                        <p className={`mt-1 text-[0.66rem] font-medium ${hasOpen ? 'text-petrol-700' : 'text-slate-400'}`}>
                          {hasOpen ? `${room.openCount} pendiente${room.openCount === 1 ? '' : 's'}` : 'Sin pendientes'}
                        </p>
                        {hasOpen ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {room.counts.entries > 0 ? <span className="rounded-sm bg-white px-1.5 py-0.5 text-[0.58rem] font-semibold text-petrol-700 ring-1 ring-slate-200">N {room.counts.entries}</span> : null}
                            {room.counts.tasks > 0 ? <span className="rounded-sm bg-white px-1.5 py-0.5 text-[0.58rem] font-semibold text-petrol-700 ring-1 ring-slate-200">T {room.counts.tasks}</span> : null}
                            {room.counts.alarms > 0 ? <span className="rounded-sm bg-white px-1.5 py-0.5 text-[0.58rem] font-semibold text-petrol-700 ring-1 ring-slate-200">A {room.counts.alarms}</span> : null}
                            {room.counts.guarantees > 0 ? <span className="rounded-sm bg-white px-1.5 py-0.5 text-[0.58rem] font-semibold text-petrol-700 ring-1 ring-slate-200">G {room.counts.guarantees}</span> : null}
                          </div>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <aside className="xl:sticky xl:top-28 xl:self-start">
          {board.selected ? (
            <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-card">
              <div className="border-b border-slate-200 bg-petrol-950 px-4 py-4 text-white">
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.09em] text-petrol-300">Contexto operativo</p>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <h2 className="text-3xl font-semibold tabular">Hab. {board.selected.number}</h2>
                  <span className={`rounded-sm px-2 py-1 text-xs font-semibold ${
                    board.selected.criticalCount > 0
                      ? 'bg-red-500/20 text-red-100 ring-1 ring-red-400/50'
                      : board.selected.openCount > 0
                        ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-400/40'
                        : 'bg-white/10 text-petrol-100 ring-1 ring-white/15'
                  }`}>
                    {board.selected.openCount > 0 ? `${board.selected.openCount} pendiente(s)` : 'Sin pendientes'}
                  </span>
                </div>
              </div>

              {board.selected.items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-petrol-900">Sin contexto asociado</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Cuando una novedad, tarea, alerta u otro registro seleccione esta habitación, aparecerá aquí.
                  </p>
                </div>
              ) : (
                <ul className="max-h-[64vh] divide-y divide-slate-100 overflow-y-auto">
                  {board.selected.items.map((item) => {
                    const Icon = KIND_ICON[item.kind];
                    return (
                      <li key={`${item.kind}:${item.id}`} className={item.critical ? 'bg-red-50/35' : ''}>
                        <Link href={item.href} className="block px-4 py-3 hover:bg-slate-50">
                          <div className="flex items-start gap-3">
                            <span className={`mt-0.5 rounded-sm p-1.5 ${
                              item.critical ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-petrol-700'
                            }`}>
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">
                                  {KIND_LABEL[item.kind]}
                                </span>
                                {item.critical ? <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-[0.58rem] font-semibold uppercase text-red-700">Prioridad</span> : null}
                              </div>
                              <p className="mt-0.5 text-sm font-semibold leading-5 text-petrol-950">{item.title}</p>
                              {item.subtitle ? <p className="mt-0.5 text-xs text-slate-500">{item.subtitle}</p> : null}
                              <p className="mt-1 text-[0.65rem] text-slate-400">{formatDateTime(item.timestamp)}</p>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t border-slate-200 bg-[#f8fafc] px-4 py-3 text-xs leading-5 text-slate-500">
                La habitación es sólo contexto. Abrir o resolver un objeto se hace en su módulo original.
              </div>
            </section>
          ) : (
            <section className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
              <DoorOpen className="mx-auto h-7 w-7 text-gold-500" aria-hidden="true" />
              <p className="mt-3 font-semibold text-petrol-950">Selecciona una habitación</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Toca cualquier tarjeta para ver su contexto operativo sin abandonar el mapa.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
