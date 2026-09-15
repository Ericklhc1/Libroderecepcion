import { BarChart3 } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { defaultRange, getMetrics } from '@/server/services/metrics';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Indicadores' };
export const dynamic = 'force-dynamic';

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
];

/** Barra proporcional simple: sin librerías de gráficos para la primera versión. */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <li className="px-4 py-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-petrol-900">{label}</span>
        <span className="tabular text-slate-500">{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-petrol-600"
          style={{ width: `${width}%` }}
          role="presentation"
        />
      </div>
    </li>
  );
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('metrics.view');
  const params = await searchParams;
  const days = Number(typeof params.dias === 'string' ? params.dias : '30') || 30;
  const metrics = await getMetrics(defaultRange(days));

  const maxIncidents = Math.max(1, ...metrics.incidents.byDepartment.map((d) => d.count));
  const maxVolume = Math.max(1, ...metrics.volumeByShift.map((v) => v.count));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <BarChart3 className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Indicadores
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Del {formatDate(metrics.range.from)} al {formatDate(metrics.range.to)}. Cumplimiento,
            carga heredada y tiempos de resolución.
          </p>
        </div>
        <nav className="flex gap-2" aria-label="Rango de fechas">
          {RANGES.map((range) => (
            <a
              key={range.days}
              href={`/indicadores?dias=${range.days}`}
              aria-current={days === range.days ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
                days === range.days
                  ? 'bg-petrol-700 text-white ring-petrol-700'
                  : 'bg-white text-petrol-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {range.label}
            </a>
          ))}
        </nav>
      </header>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">
          Tareas
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Completadas en plazo"
            value={metrics.tasks.onTimeRate !== null ? `${metrics.tasks.onTimeRate}%` : '—'}
            hint={`${metrics.tasks.completedOnTime} de ${metrics.tasks.completed} completadas`}
            tone={
              metrics.tasks.onTimeRate !== null && metrics.tasks.onTimeRate >= 80
                ? 'good'
                : 'neutral'
            }
          />
          <StatTile
            label="Completadas fuera de plazo"
            value={metrics.tasks.completedLate}
            tone={metrics.tasks.completedLate > 0 ? 'alert' : 'good'}
          />
          <StatTile
            label="Vencidas ahora"
            value={metrics.tasks.overdue}
            tone={metrics.tasks.overdue > 0 ? 'alert' : 'good'}
          />
          <StatTile label="Abiertas ahora" value={metrics.tasks.open} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">
          Incidencias y alertas
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Incidencias abiertas"
            value={metrics.incidents.open}
            tone={metrics.incidents.open > 0 ? 'alert' : 'good'}
          />
          <StatTile label="Cerradas en el período" value={metrics.incidents.closedInRange} />
          <StatTile
            label="Tiempo medio de resolución"
            value={
              metrics.incidents.avgResolutionHours !== null
                ? `${metrics.incidents.avgResolutionHours.toFixed(1)} h`
                : '—'
            }
            hint="Desde el hecho hasta el cierre"
          />
          <StatTile
            label="Alertas activas"
            value={metrics.alerts.live}
            tone={metrics.alerts.live > 0 ? 'alert' : 'good'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">
          Turnos y entregas
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Cumplimiento de entregas"
            value={
              metrics.handovers.complianceRate !== null
                ? `${metrics.handovers.complianceRate}%`
                : '—'
            }
            hint={`${metrics.handovers.received} recibidas de ${metrics.handovers.sent} enviadas`}
            tone={
              metrics.handovers.complianceRate !== null && metrics.handovers.complianceRate >= 90
                ? 'good'
                : 'neutral'
            }
          />
          <StatTile
            label="Entregas enviadas"
            value={metrics.handovers.sent}
            hint="En el período"
          />
          <StatTile
            label="Turnos cerrados"
            value={
              metrics.shifts.closureRate !== null ? `${metrics.shifts.closureRate}%` : '—'
            }
            hint={`${metrics.shifts.closed} de ${metrics.shifts.total} turnos`}
          />
          <StatTile
            label="Pendientes heredados"
            value={metrics.inheritedPendings}
            hint="Abiertos de turnos anteriores"
            tone={metrics.inheritedPendings > 5 ? 'alert' : 'neutral'}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Incidencias por área" />
          {metrics.incidents.byDepartment.length === 0 ? (
            <EmptyState message="Sin incidencias en el período." />
          ) : (
            <ul className="divide-y divide-slate-100 py-1">
              {metrics.incidents.byDepartment.map((row) => (
                <Bar
                  key={row.department}
                  label={row.department}
                  value={row.count}
                  max={maxIncidents}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Volumen de registros por turno" />
          {metrics.volumeByShift.length === 0 ? (
            <EmptyState message="Sin registros en el período." />
          ) : (
            <ul className="divide-y divide-slate-100 py-1">
              {metrics.volumeByShift.map((row) => (
                <Bar key={row.label} label={row.label} value={row.count} max={maxVolume} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="pb-2 text-xs text-slate-400">
        Los indicadores se calculan en vivo sobre los datos operativos. Esta versión no pretende ser
        una herramienta de inteligencia de negocio: sólo mide cumplimiento y carga.
      </p>
    </div>
  );
}
