import Link from 'next/link';
import { Activity, ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import {
  getOperationalHealth,
  operationalHealthRange,
  type OperationalHealthPeriod,
} from '@/server/services/operational-health';
import { Card, CardHeader, StatTile } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Salud operativa' };
export const dynamic = 'force-dynamic';

const PERIODS: Array<{ key: OperationalHealthPeriod; label: string }> = [
  { key: 'today', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
];

function parsePeriod(value: unknown): OperationalHealthPeriod {
  return value === 'today' || value === '7d' || value === '30d' ? value : 'today';
}

function formatDuration(value: number | null): string {
  if (value === null) return '—';
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  const minutes = value / 60_000;
  return minutes < 10 ? `${minutes.toFixed(1)} min` : `${Math.round(minutes)} min`;
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export default async function OperationalHealthPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('supervision.center.view');
  const params = await searchParams;
  const period = parsePeriod(params.periodo);
  const health = await getOperationalHealth(operationalHealthRange(period));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href="/supervision"
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-petrol-600 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Centro de Supervisión
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <Activity className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Salud operativa
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Datos observados del {formatDate(health.range.from)} al {formatDate(health.range.to)}.
            Sin objetivos ni ranking de personas.
          </p>
        </div>
        <nav className="flex gap-2" aria-label="Rango de salud operativa">
          {PERIODS.map((item) => (
            <a
              key={item.key}
              href={`/supervision/salud?periodo=${item.key}`}
              aria-current={period === item.key ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
                period === item.key
                  ? 'bg-petrol-700 text-white ring-petrol-700'
                  : 'bg-white text-petrol-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Turnos y cierre</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatTile label="Turnos iniciados" value={health.shifts.started} />
          <StatTile label="Turnos cerrados" value={health.shifts.closed} />
          <StatTile
            label="Cierres por contingencia"
            value={health.shifts.contingencies}
            tone={health.shifts.contingencies > 0 ? 'alert' : 'good'}
          />
          <StatTile
            label="Tiempo mediano de cierre"
            value={formatDuration(health.shifts.medianCloseMs)}
            hint={
              health.shifts.p90CloseMs === null
                ? 'Sin base suficiente todavía'
                : `P90 ${formatDuration(health.shifts.p90CloseMs)}`
            }
          />
          <StatTile
            label="Cierres aún sin completar"
            value={health.shifts.closeIncomplete}
            hint="Inicio registrado sin cierre correlacionado"
            tone={health.shifts.closeIncomplete > 0 ? 'neutral' : 'good'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Caja y relevo</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatTile
            label="Arqueos realizados"
            value={health.cash.counts}
            hint={
              health.cash.medianCountMs === null
                ? 'Sin duración observada todavía'
                : `Mediana ${formatDuration(health.cash.medianCountMs)}`
            }
          />
          <StatTile
            label="Arqueos con diferencias"
            value={health.cash.withDifferences}
            tone={health.cash.withDifferences > 0 ? 'alert' : 'good'}
          />
          <StatTile label="Cierres de Caja" value={health.cash.closed} />
          <StatTile label="Entregas enviadas" value={health.handovers.sent} />
          <StatTile label="Entregas recibidas" value={health.handovers.received} />
          <StatTile
            label="Tiempo mediano de recepción"
            value={formatDuration(health.handovers.medianReceiveMs)}
            hint={
              health.handovers.p90ReceiveMs === null
                ? 'Sin base suficiente todavía'
                : `P90 ${formatDuration(health.handovers.p90ReceiveMs)}`
            }
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Libro · Registros</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Registros creados" value={health.entries.created} />
          <StatTile
            label="Tomadas observadas"
            value={health.entries.takenObserved}
            hint={
              health.entries.medianTakeMs === null
                ? 'P1 aún sin duración suficiente'
                : `Mediana ${formatDuration(health.entries.medianTakeMs)}`
            }
          />
          <StatTile
            label="Resueltas observadas"
            value={health.entries.resolvedObserved}
            hint="Primera llegada a RESUELTO o CERRADO"
          />
          <StatTile
            label="Tiempo mediano hasta tomar"
            value={formatDuration(health.entries.medianTakeMs)}
            hint={
              health.entries.p90TakeMs === null
                ? 'Desde telemetría P1'
                : `P90 ${formatDuration(health.entries.p90TakeMs)}`
            }
          />
          <StatTile
            label="Tiempo mediano hasta resolver"
            value={formatDuration(health.entries.medianResolveMs)}
            hint={
              health.entries.p90ResolveMs === null
                ? 'Desde telemetría P1'
                : `P90 ${formatDuration(health.entries.p90ResolveMs)}`
            }
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Llaves · Inventario físico</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile label="Inventarios completados" value={health.keyInventory.completed} />
          <StatTile
            label="Inventarios con diferencias"
            value={health.keyInventory.withDifferences}
            tone={health.keyInventory.withDifferences > 0 ? 'alert' : 'good'}
          />
          <StatTile
            label="Tiempo mediano de inventario"
            value={formatDuration(health.keyInventory.medianDurationMs)}
            hint={
              health.keyInventory.p90DurationMs === null
                ? 'Desde la primera interacción'
                : `P90 ${formatDuration(health.keyInventory.p90DurationMs)}`
            }
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Tutorial guiado</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="Tutoriales iniciados"
            value={health.tutorial.started}
            hint={`${health.tutorial.stepsReached} paso(s) alcanzado(s)`}
          />
          <StatTile label="Completados" value={health.tutorial.completed} />
          <StatTile label="Cerrados esta sesión" value={health.tutorial.closedThisSession} />
          <StatTile label="Desactivados" value={health.tutorial.disabled} />
          <StatTile
            label="Fallos operativos P0"
            value={health.failures}
            hint="Fallos de los procesos críticos instrumentados en P0"
            tone={health.failures > 0 ? 'alert' : 'good'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Fronti · Estabilidad real</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Solicitudes" value={health.fronti.requested} />
          <StatTile
            label="Éxito observado"
            value={formatPercent(health.fronti.successRate)}
            hint={`${health.fronti.succeeded} éxito(s) · ${health.fronti.failed} fallo(s)`}
            tone={health.fronti.failed > 0 ? 'neutral' : 'good'}
          />
          <StatTile
            label="Latencia mediana"
            value={formatDuration(health.fronti.medianDurationMs)}
            hint={
              health.fronti.p90DurationMs === null
                ? 'Sin base suficiente todavía'
                : `P90 ${formatDuration(health.fronti.p90DurationMs)} · Prom. ${formatDuration(health.fronti.averageDurationMs)}`
            }
          />
          <StatTile
            label="Fallbacks observados"
            value={health.fronti.fallbackRuns}
            hint="Proveedor o modelo final distinto de la configuración primaria"
            tone={health.fronti.fallbackRuns > 0 ? 'neutral' : 'good'}
          />
          <StatTile label="Tools ejecutadas" value={health.fronti.toolCalls} />
          <StatTile
            label="Tools con fallo"
            value={health.fronti.toolFailures}
            tone={health.fronti.toolFailures > 0 ? 'alert' : 'good'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold text-slate-500">Interfaz · Fallos técnicos</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Acciones con error inesperado"
            value={health.actions.failed}
            hint="No incluye validaciones ni errores de dominio esperados"
            tone={health.actions.failed > 0 ? 'alert' : 'good'}
          />
          <StatTile
            label="Acciones ≥ 20 s"
            value={health.actions.timeouts}
            hint="Umbral técnico de observación, no objetivo de productividad"
            tone={health.actions.timeouts > 0 ? 'neutral' : 'good'}
          />
          <StatTile
            label="Mediana sobre umbral"
            value={formatDuration(health.actions.medianTimeoutMs)}
            hint={
              health.actions.p90TimeoutMs === null
                ? 'Sin casos suficientes todavía'
                : `P90 ${formatDuration(health.actions.p90TimeoutMs)}`
            }
          />
        </div>
      </section>

      <Card>
        <CardHeader title="Línea base" />
        <div className="space-y-2 px-4 py-4 text-sm text-slate-600">
          <p>
            Estos valores son observaciones, no objetivos. Durante los primeros 30 días sirven para
            conocer la distribución real antes de fijar umbrales de tiempo o productividad.
          </p>
          <p>
            {health.observedSince
              ? `Telemetría disponible desde ${formatDate(health.observedSince)}.`
              : 'Todavía no hay eventos operativos registrados en este entorno.'}
          </p>
          <p className="text-xs text-slate-500">
            P2 añade Fronti persistente y fallos técnicos transversales sobre la misma
            infraestructura. No se guardan prompts, respuestas, campos de formulario ni ranking por
            usuario.
          </p>
        </div>
      </Card>
    </div>
  );
}
