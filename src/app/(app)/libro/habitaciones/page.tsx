import Link from 'next/link';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ClipboardList,
  CircleDollarSign,
  DoorOpen,
  ParkingSquare,
  ShieldCheck,
  TicketCheck,
  Wrench,
} from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getRoomMonitor, type RoomMonitorItem, type RoomMonitorLevel } from '@/server/services/room-monitor';
import { ViewTabs } from '@/components/layout/view-tabs';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Novedades por habitación' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS = [
  { label: 'Novedades', href: '/libro?clase=entry' },
  { label: 'Incidencias', href: '/libro?clase=entry&tipo=INCIDENCIA' },
  { label: 'Mis tareas', href: '/libro?clase=task' },
  { label: 'Por habitación', href: '/libro/habitaciones' },
];

const ROOM_STYLE: Record<RoomMonitorLevel, string> = {
  clean: 'border-slate-200 bg-white text-petrol-950 hover:border-slate-400 hover:bg-slate-50',
  active: 'border-cyan-300 bg-cyan-50/60 text-petrol-950 hover:border-cyan-500',
  attention: 'border-amber-300 bg-amber-50/70 text-amber-950 hover:border-amber-500',
  critical: 'border-red-300 bg-red-50/70 text-red-950 hover:border-red-500',
};

const KIND_LABEL: Record<RoomMonitorItem['kind'], string> = {
  entry: 'Novedad',
  task: 'Tarea',
  followup: 'Seguimiento',
  alarm: 'Alerta',
  guarantee: 'Garantía',
  fine: 'Multa / daño',
  gym: 'Gimnasio',
  parking: 'Estacionamiento',
};

function KindIcon({ kind }: { kind: RoomMonitorItem['kind'] }) {
  const cls = 'h-4 w-4';
  if (kind === 'entry') return <ClipboardList className={cls} aria-hidden="true" />;
  if (kind === 'task') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (kind === 'followup') return <Wrench className={cls} aria-hidden="true" />;
  if (kind === 'alarm') return <BellRing className={cls} aria-hidden="true" />;
  if (kind === 'guarantee') return <ShieldCheck className={cls} aria-hidden="true" />;
  if (kind === 'fine') return <CircleDollarSign className={cls} aria-hidden="true" />;
  if (kind === 'parking') return <ParkingSquare className={cls} aria-hidden="true" />;
  return <TicketCheck className={cls} aria-hidden="true" />;
}

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RoomOperationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser();
  const params = await searchParams;
  const selectedNumber = one(params.habitacion) ?? null;
  const requestedFloor = Number(one(params.piso));
  const floor = [4, 5, 6].includes(requestedFloor) ? requestedFloor : null;
  const monitor = await getRoomMonitor(selectedNumber);

  const rooms = floor ? monitor.rooms.filter((room) => room.floor === floor) : monitor.rooms;
  const selected = monitor.selected;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-300 pb-4">
        <div>
          <div className="flex items-center gap-2 text-gold-600">
            <DoorOpen className="h-4 w-4" aria-hidden="true" />
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.09em]">
              Novedades / Habitación
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-petrol-950">
            Monitor operativo por habitación
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            La habitación funciona como contexto de reportería. Aquí ves asuntos AROH vinculados:
            novedades, tareas, seguimientos, alertas, garantías, multas y folios. No muestra ocupación,
            check-in/out ni estado PMS.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">Habitaciones</p>
            <p className="text-lg font-semibold text-petrol-950">{monitor.totals.rooms}</p>
          </div>
          <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-cyan-700">Con actividad</p>
            <p className="text-lg font-semibold text-cyan-950">{monitor.totals.active}</p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-amber-700">Atención</p>
            <p className="text-lg font-semibold text-amber-950">{monitor.totals.attention}</p>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-red-700">Críticas</p>
            <p className="text-lg font-semibold text-red-950">{monitor.totals.critical}</p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs label="Vista operativa" activeHref="/libro/habitaciones" tabs={TABS} />
        <nav aria-label="Filtro por piso" className="flex items-center gap-1">
          <Link
            href="/libro/habitaciones"
            aria-current={!floor ? 'page' : undefined}
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ring-1 ${
              !floor ? 'bg-petrol-950 text-white ring-petrol-950' : 'bg-white text-petrol-700 ring-slate-300'
            }`}
          >
            Todos
          </Link>
          {[4, 5, 6].map((value) => (
            <Link
              key={value}
              href={`/libro/habitaciones?piso=${value}`}
              aria-current={floor === value ? 'page' : undefined}
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ring-1 ${
                floor === value ? 'bg-petrol-950 text-white ring-petrol-950' : 'bg-white text-petrol-700 ring-slate-300'
              }`}
            >
              Piso {value}
            </Link>
          ))}
        </nav>
      </div>

      <section className="rounded-lg border border-slate-300 bg-white p-3 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <p className="text-sm font-semibold text-petrol-950">
            {floor ? `Piso ${floor}` : 'Todas las habitaciones'}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[0.68rem] text-slate-500">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-slate-300 bg-white" />Sin pendientes</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-cyan-400" />Actividad</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Atención</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />Crítico</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 md:grid-cols-10 xl:grid-cols-15">
          {rooms.map((room) => {
            const query = new URLSearchParams();
            if (floor) query.set('piso', String(floor));
            query.set('habitacion', room.number);
            const isSelected = selected?.room.id === room.id;
            return (
              <Link
                key={room.id}
                href={`/libro/habitaciones?${query.toString()}`}
                aria-current={isSelected ? 'true' : undefined}
                title={
                  room.activeCount > 0
                    ? `Hab. ${room.number}: ${room.activeCount} asunto(s) abierto(s)`
                    : `Hab. ${room.number}: sin pendientes`
                }
                className={`group min-h-20 rounded-md border p-2.5 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-card ${
                  ROOM_STYLE[room.level]
                } ${isSelected ? 'ring-2 ring-gold-500 ring-offset-1' : ''}`}
              >
                <p className="text-xl font-semibold tabular">{room.number}</p>
                <div className="mt-2 flex min-h-5 items-center gap-1.5 text-[0.66rem] font-medium">
                  {room.activeCount === 0 ? (
                    <span className="text-slate-400">Sin pendientes</span>
                  ) : (
                    <>
                      <span>{room.activeCount} abierto{room.activeCount === 1 ? '' : 's'}</span>
                      {room.attentionCount > 0 ? <span>· {room.attentionCount} ⚠</span> : null}
                    </>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {selected ? (
        <section className="rounded-lg border border-slate-300 bg-white shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-[#f8fafc] px-4 py-4">
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Monitor seleccionado
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-petrol-950">
                Habitación {selected.room.number}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {selected.summary.activeCount === 0
                  ? 'Sin asuntos abiertos asociados.'
                  : `${selected.summary.activeCount} asunto(s) abierto(s) · ${selected.summary.attentionCount} requieren atención · ${selected.summary.criticalCount} crítico(s)`}
              </p>
            </div>
            <Link
              href="/libro/habitaciones"
              className="rounded-sm bg-white px-3 py-2 text-xs font-semibold text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Cerrar monitor
            </Link>
          </div>

          {selected.items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
              <p className="mt-2 font-semibold text-petrol-950">Sin actividad operativa registrada</p>
              <p className="mt-1 text-sm text-slate-500">
                Cuando un formulario se vincule a esta habitación, aparecerá aquí automáticamente.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {selected.items.map((item) => {
                const content = (
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={`mt-0.5 rounded-md p-2 ${
                        item.critical
                          ? 'bg-red-50 text-red-700'
                          : item.attention
                            ? 'bg-amber-50 text-amber-700'
                            : item.open
                              ? 'bg-cyan-50 text-cyan-700'
                              : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <KindIcon kind={item.kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-slate-400">
                          {KIND_LABEL[item.kind]}
                        </span>
                        {item.ref ? <span className="text-xs font-semibold tabular text-slate-500">{item.ref}</span> : null}
                        {item.critical ? <Badge tone="critico">Crítico</Badge> : item.attention ? <Badge tone="atencion">Atención</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-petrol-950">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {item.status.replaceAll('_', ' ')} · {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                    {item.href ? <span className="mt-1 text-xs font-semibold text-gold-700">Abrir →</span> : null}
                  </div>
                );
                return (
                  <li key={`${item.kind}:${item.id}`}>
                    {item.href ? (
                      <Link href={item.href} className="block hover:bg-slate-50">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-[#f8fafc] px-4 py-8 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-gold-600" aria-hidden="true" />
          <p className="mt-2 font-semibold text-petrol-950">Selecciona una habitación</p>
          <p className="mt-1 text-sm text-slate-500">
            Toca cualquier número para abrir su monitor operativo. No hay doble clic, menús ocultos ni pasos intermedios.
          </p>
        </section>
      )}
    </div>
  );
}
