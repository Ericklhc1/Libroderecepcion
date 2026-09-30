import Link from 'next/link';
import {
  BedDouble,
  BellRing,
  ClipboardCheck,
  KeyRound,
  ReceiptText,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getRoomOperationsMonitor, type RoomOperationKind } from '@/server/services/room-operations';
import { Card, EmptyState } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Novedades / habitación' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KIND_META: Record<
  RoomOperationKind,
  { label: string; icon: typeof BedDouble; tone: 'neutral' | 'curso' | 'atencion' | 'critico' }
> = {
  NOVEDAD: { label: 'Novedad', icon: ClipboardCheck, tone: 'curso' },
  INCIDENCIA: { label: 'Incidencia', icon: ShieldAlert, tone: 'critico' },
  TAREA: { label: 'Tarea', icon: Wrench, tone: 'curso' },
  SEGUIMIENTO: { label: 'Seguimiento', icon: BellRing, tone: 'atencion' },
  GARANTIA: { label: 'Garantía', icon: ReceiptText, tone: 'atencion' },
  MULTA: { label: 'Multa', icon: ReceiptText, tone: 'atencion' },
  LLAVE: { label: 'Llave', icon: KeyRound, tone: 'atencion' },
  PRELLEGADA: { label: 'Prellegada', icon: BedDouble, tone: 'neutral' },
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function RoomOperationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const rows = await getRoomOperationsMonitor();
  const selectedNumber = one(params.habitacion);
  const selected = rows.find((row) => row.roomNumber === selectedNumber) ?? null;

  const activeRooms = rows.filter((row) => row.matters.length > 0);
  const criticalRooms = rows.filter((row) => row.matters.some((matter) => matter.critical));
  const totalMatters = rows.reduce((sum, row) => sum + row.matters.length, 0);
  const floors = [4, 5, 6];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-gold-700">
            Continuidad activa por habitación
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-petrol-950">
            Novedades / habitación
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Sólo muestra asuntos que todavía requieren continuidad. Cuando una novedad se cierra,
            una tarea se completa, un seguimiento se cumple, una garantía se devuelve/cierra o una
            multa se cobra/condona, deja de aparecer aquí sin perder su historial.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.permissions.includes('reservation.center.view') ? (
            <Link
              href="/central-reservas"
              className="rounded-sm bg-white px-3 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Abrir Prellegadas
            </Link>
          ) : null}
          <Link
            href="/buscar"
            className="rounded-sm bg-petrol-950 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-900"
          >
            Buscar en AROH
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-slate-500">
              Habitaciones con actividad
            </p>
            <p className="mt-1 text-2xl font-semibold text-petrol-950">{activeRooms.length}</p>
            <p className="text-xs text-slate-500">de {rows.length} habitaciones activas</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-slate-500">
              Asuntos activos
            </p>
            <p className="mt-1 text-2xl font-semibold text-petrol-950">{totalMatters}</p>
            <p className="text-xs text-slate-500">sin duplicar alertas ni notificaciones</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-slate-500">
              Habitaciones críticas
            </p>
            <p className="mt-1 text-2xl font-semibold text-red-700">{criticalRooms.length}</p>
            <p className="text-xs text-slate-500">con al menos una excepción crítica</p>
          </div>
        </Card>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_28rem]">
        <section className="space-y-5">
          {floors.map((floor) => {
            const floorRows = rows.filter(
              (row) => row.floor === floor || row.roomNumber.startsWith(String(floor)),
            );
            return (
              <div key={floor}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-petrol-950">Piso {floor}</h2>
                  <span className="text-xs text-slate-400">
                    {floorRows.filter((row) => row.matters.length > 0).length} con actividad
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
                  {floorRows.map((room) => {
                    const count = room.matters.length;
                    const critical = room.matters.some((matter) => matter.critical);
                    const active = selected?.roomNumber === room.roomNumber;
                    return (
                      <Link
                        key={room.roomId}
                        href={`/habitaciones?habitacion=${room.roomNumber}`}
                        aria-current={active ? 'page' : undefined}
                        className={`relative min-h-20 rounded-md border px-3 py-3 transition-colors ${
                          active
                            ? 'border-gold-500 bg-petrol-950 text-white'
                            : critical
                              ? 'border-red-300 bg-red-50 hover:bg-red-100'
                              : count > 0
                                ? 'border-gold-300 bg-cyan-50/50 hover:bg-cyan-50'
                                : 'border-slate-200 bg-white text-petrol-900 hover:border-slate-300'
                        }`}
                      >
                        <span className="text-base font-semibold tabular">{room.roomNumber}</span>
                        <span
                          className={`mt-2 block text-[0.65rem] font-semibold uppercase tracking-wide ${
                            active ? 'text-petrol-200' : count > 0 ? 'text-petrol-700' : 'text-slate-400'
                          }`}
                        >
                          {count === 0 ? 'Sin pendientes' : `${count} activo${count === 1 ? '' : 's'}`}
                        </span>
                        {critical ? (
                          <span
                            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-600"
                            aria-label="Tiene asunto crítico"
                          />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="xl:sticky xl:top-28 xl:self-start">
          <Card>
            <div className="border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
              <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.055em] text-petrol-900">
                {selected ? `Habitación ${selected.roomNumber}` : 'Detalle de habitación'}
              </h2>
            </div>

            {!selected ? (
              <EmptyState
                message="Selecciona una habitación."
                hint="El panel sólo muestra continuidad activa; el histórico sigue en Búsqueda global."
              />
            ) : selected.matters.length === 0 ? (
              <EmptyState
                message={`Habitación ${selected.roomNumber} sin asuntos activos.`}
                hint="Si hubo actividad anterior, encuéntrala desde Búsqueda global."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {selected.matters.map((matter) => {
                  const meta = KIND_META[matter.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={matter.id}>
                      <Link href={matter.href} className="block px-4 py-3 hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-gold-700" aria-hidden="true" />
                          <Badge tone={matter.critical ? 'critico' : meta.tone}>{meta.label}</Badge>
                          {matter.humanId ? (
                            <span className="text-xs tabular text-slate-400">#{matter.humanId}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm font-semibold text-petrol-950">{matter.title}</p>
                        {matter.detail ? (
                          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600">
                            {matter.detail}
                          </p>
                        ) : null}
                        <div className="mt-2 flex items-center justify-between gap-2 text-[0.68rem] text-slate-400">
                          <span>{matter.status.toLocaleLowerCase('es-CL').replaceAll('_', ' ')}</span>
                          <span>{formatDateTime(matter.createdAt)}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
