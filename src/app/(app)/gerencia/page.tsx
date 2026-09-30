import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CircleAlert,
  Gauge,
  Landmark,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import {
  getManagementDashboard,
  managementPeriodDays,
} from '@/server/services/management-dashboard';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCalendarDate } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Centro de Decisión Gerencial' };
export const dynamic = 'force-dynamic';

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
] as const;

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

function decimal(value: number | null, suffix = ''): string {
  return value === null
    ? '—'
    : `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}${suffix}`;
}

function clp(value: number | null): string {
  return value === null ? '—' : `$ ${Math.round(value).toLocaleString('es-CL')}`;
}

function duration(value: number | null): string {
  if (value === null) return '—';
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  return `${(seconds / 60).toFixed(1)} min`;
}

function delta(
  value: number | null,
  unit: 'pp' | 'h' | 'ms',
  positiveIsGood = true,
) {
  if (value === null || Math.abs(value) < 0.01) {
    return <span className="text-xs text-slate-400">sin variación comparable</span>;
  }
  const good = positiveIsGood ? value > 0 : value < 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  const formatted =
    unit === 'pp'
      ? `${Math.abs(value).toFixed(1)} pp`
      : unit === 'h'
        ? `${Math.abs(value).toFixed(1)} h`
        : duration(Math.abs(value));
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${
      good ? 'text-emerald-700' : 'text-amber-700'
    }`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {value > 0 ? '+' : '−'}{formatted} vs período anterior
    </span>
  );
}

function Pulse({
  eyebrow,
  title,
  value,
  detail,
  comparison,
}: {
  eyebrow: string;
  title: string;
  value: string;
  detail: string;
  comparison?: React.ReactNode;
}) {
  return (
    <Card className="border-l-[3px] border-l-gold-500 p-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-slate-500">
        {eyebrow}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold tabular text-petrol-950">{value}</p>
          <p className="mt-1 text-sm font-medium text-petrol-900">{title}</p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
      {comparison ? <div className="mt-2">{comparison}</div> : null}
    </Card>
  );
}

function priorityTone(priority: string): 'critico' | 'pendiente' | 'neutro' {
  return priority === 'CRITICA' ? 'critico' : priority === 'ALTA' ? 'pendiente' : 'neutro';
}

export default async function ManagementPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('management.dashboard.view');
  const params = await searchParams;
  const requested = Number(typeof params.dias === 'string' ? params.dias : '30');
  const days = managementPeriodDays(requested);
  const dashboard = await getManagementDashboard(days);

  const maxDepartment = Math.max(
    1,
    ...dashboard.incidentsByDepartment.map((item) => item.count),
  );

  const pms = dashboard.pms.current;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <section className="overflow-hidden rounded-lg border border-petrol-800 bg-petrol-950 text-white shadow-card">
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-gold-400">
              Dirección · estrategia · toma de decisión
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Centro de Decisión Gerencial
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-petrol-200">
              Qué requiere decisión, dónde se concentra el riesgo y si la operación está
              mejorando o deteriorándose. Cada señal conserva evidencia y vínculo a su fuente.
            </p>
          </div>
          <nav className="flex gap-2" aria-label="Período gerencial">
            {RANGES.map((range) => (
              <Link
                key={range.days}
                href={`/gerencia?dias=${range.days}`}
                aria-current={days === range.days ? 'page' : undefined}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === range.days
                    ? 'border-gold-500 bg-gold-500 text-petrol-950'
                    : 'border-petrol-700 text-petrol-200 hover:border-petrol-500 hover:text-white'
                }`}
              >
                {range.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="border-t border-petrol-800 px-5 py-2.5 text-xs text-petrol-400">
          Período actual: {formatCalendarDate(dashboard.range.from)} – {formatCalendarDate(dashboard.range.to)}
          {' · '}comparado con un período anterior de igual duración.
        </div>
      </section>

      <section aria-labelledby="pulso-gerencial">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="pulso-gerencial" className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            Pulso ejecutivo
          </h2>
          <span className="text-xs text-slate-400">Sin score global · indicadores explicables</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Pulse
            eyebrow="Continuidad"
            title="Entregas recibidas"
            value={percent(dashboard.pulses.continuity.handoverComplianceRate)}
            detail={`${dashboard.pulses.continuity.pendingHandovers} entrega(s) sin recibir · ${dashboard.pulses.continuity.pendingClosures} cierre(s) pendiente(s)`}
            comparison={delta(dashboard.pulses.continuity.handoverDeltaPp, 'pp', true)}
          />
          <Pulse
            eyebrow="Ejecución"
            title="Tareas completadas en plazo"
            value={percent(dashboard.pulses.execution.taskOnTimeRate)}
            detail={`${dashboard.pulses.execution.overdueNow} vencida(s) ahora · ${dashboard.pulses.execution.completedLate} terminada(s) tarde en el período`}
            comparison={delta(dashboard.pulses.execution.taskOnTimeDeltaPp, 'pp', true)}
          />
          <Pulse
            eyebrow="Riesgo"
            title="Resolución media de incidencias"
            value={decimal(dashboard.pulses.risk.avgIncidentResolutionHours, ' h')}
            detail={`${dashboard.pulses.risk.criticalIncidents} crítica(s) abierta(s) · ${dashboard.pulses.risk.overdueFollowUps} seguimiento(s) vencido(s)`}
            comparison={delta(dashboard.pulses.risk.resolutionDeltaHours, 'h', false)}
          />
          <Pulse
            eyebrow="Control"
            title="Excepciones operativas vivas"
            value={String(
              dashboard.pulses.control.cashDifferences +
              dashboard.pulses.control.guaranteeIssues +
              dashboard.pulses.control.keyShortageFloors,
            )}
            detail={`Caja ${dashboard.pulses.control.cashDifferences} · garantías ${dashboard.pulses.control.guaranteeIssues} · pisos con faltantes ${dashboard.pulses.control.keyShortageFloors}`}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader
            title="Decisiones que requieren intervención"
            count={dashboard.decisions.length}
            action={<span className="text-xs text-slate-500">Máximo 5 · evidencia real</span>}
          />
          {dashboard.decisions.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">
              No hay excepciones priorizadas que requieran decisión gerencial ahora.
            </div>
          ) : (
            <ol className="divide-y divide-slate-200">
              {dashboard.decisions.map((decision, index) => (
                <li key={decision.key} className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-petrol-950 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={priorityTone(decision.priority)}>{decision.priority}</Badge>
                        <span className="text-sm font-semibold text-petrol-950">
                          {decision.title}
                        </span>
                        <span className="text-xs tabular text-slate-400">
                          {decision.count} caso(s)
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{decision.why}</p>
                      {decision.evidence.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {decision.evidence.map((row) => (
                            <li key={`${row.href}-${row.ref}`} className="text-xs text-slate-500">
                              <span className="font-semibold text-petrol-700">{row.ref}</span>
                              {' · '}{row.title}
                              {row.meta ? ` · ${row.meta}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <Link
                        href={decision.href}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-petrol-700 hover:text-petrol-950"
                      >
                        Abrir evidencia
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader title="Fragilidad operacional" action={<Gauge className="h-4 w-4 text-gold-600" />} />
          <div className="grid grid-cols-2 gap-px bg-slate-200">
            {[
              ['Sin responsable', dashboard.fragility.unassigned],
              ['Tareas vencidas', dashboard.fragility.overdueTasks],
              ['Seguimientos vencidos', dashboard.fragility.overdueFollowUps],
              ['Entregas sin recibir', dashboard.fragility.unreceivedHandovers],
              ['Cierres pendientes', dashboard.fragility.pendingShiftClosures],
              ['Llegadas 24 h en riesgo', dashboard.fragility.reservationsNext24AtRisk],
              ['Diferencias de Caja', dashboard.fragility.cashDifferences],
              ['Problemas de garantías', dashboard.fragility.guaranteeIssues],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-white px-3 py-3">
                <p className="text-2xl font-semibold tabular text-petrol-950">{value}</p>
                <p className="mt-0.5 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-slate-200 bg-[#f8fafc] px-3 py-2 text-xs leading-5 text-slate-500">
            No es un puntaje. Son puntos de fricción que pueden anticipar pérdida de continuidad,
            retrabajo o exposición antes de que el problema llegue al huésped.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Tendencia · período actual vs anterior" />
          <div className="divide-y divide-slate-200">
            {[
              ['Tareas en plazo', dashboard.trends.taskOnTime],
              ['Entregas recibidas', dashboard.trends.handoverCompliance],
              ['Turnos cerrados', dashboard.trends.shiftClosure],
              ['Resolución de incidencias', dashboard.trends.incidentResolution],
            ].map(([label, raw]) => {
              const item = raw as {
                current: number | null;
                previous: number | null;
                unit: string;
                better: 'higher' | 'lower';
              };
              const d =
                item.current === null || item.previous === null
                  ? null
                  : item.current - item.previous;
              const improved =
                d === null ? null : item.better === 'higher' ? d > 0 : d < 0;
              return (
                <div key={String(label)} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-petrol-900">{label}</p>
                    <p className="text-xs text-slate-400">Período anterior: {decimal(item.previous, item.unit)}</p>
                  </div>
                  <p className="text-lg font-semibold tabular text-petrol-950">
                    {decimal(item.current, item.unit)}
                  </p>
                  <div className="w-20 text-right text-xs">
                    {d === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className={improved ? 'text-emerald-700' : d === 0 ? 'text-slate-400' : 'text-amber-700'}>
                        {d > 0 ? '+' : ''}{d.toFixed(1)} {item.unit}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Fricción del proceso" action={<ShieldCheck className="h-4 w-4 text-gold-600" />} />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {[
              ['Cierre de turno · P90', duration(dashboard.friction.shiftCloseP90Ms)],
              ['Recepción de entrega · P90', duration(dashboard.friction.handoverReceiveP90Ms)],
              ['Arqueo de Caja · P90', duration(dashboard.friction.cashCountP90Ms)],
              ['Cierres iniciados no completados', String(dashboard.friction.closeIncomplete)],
              ['Arqueos con diferencia', String(dashboard.friction.cashCountsWithDifferences)],
              ['Fallos de flujo observados', String(dashboard.friction.operationalFailures)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-slate-200 bg-[#f8fafc] px-3 py-3">
                <p className="text-lg font-semibold tabular text-petrol-950">{value}</p>
                <p className="mt-0.5 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader title="Incidencias por área" action={<BarChart3 className="h-4 w-4 text-gold-600" />} />
          {dashboard.incidentsByDepartment.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">Sin incidencias en el período.</div>
          ) : (
            <ul className="divide-y divide-slate-200 py-1">
              {dashboard.incidentsByDepartment.map((row) => (
                <li key={row.department} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-petrol-900">{row.department}</span>
                    <span className="tabular text-slate-500">{row.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-slate-100">
                    <div
                      className="h-1.5 bg-gold-500"
                      style={{ width: `${Math.max(5, Math.round((row.count / maxDepartment) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Perspectiva PMS / comercial"
            action={<Landmark className="h-4 w-4 text-gold-600" />}
          />
          {pms ? (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-petrol-950">
                    Fuente: informes PMS · {formatCalendarDate(pms.businessDate)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {pms.reportKinds.join(' · ')}
                    {pms.warnings ? ` · ${pms.warnings} advertencia(s) de lectura` : ''}
                  </p>
                </div>
                <Badge tone="neutro">Fuente identificada</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['Ocupación', decimal(pms.occupancyPct, '%')],
                  ['ADR', clp(pms.adrClp)],
                  ['RevPAR', clp(pms.revparClp)],
                  ['Revenue', clp(pms.revenueClp)],
                  ['Venta neta canales', clp(pms.salesNetClp)],
                  ['Comisiones', clp(pms.commissionsClp)],
                  ['Producción habitación', clp(pms.productionClp)],
                  ['Cobros CLP', clp(pms.paymentsClp)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-white px-3 py-3">
                    <p className="text-lg font-semibold tabular text-petrol-950">{value}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </div>

              <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ADR, RevPAR, ocupación y Revenue se muestran sólo cuando vienen en el informe
                importado. AROH no estima GOP/GOPPAR ni completa valores faltantes.
              </p>
            </div>
          ) : (
            <div className="px-4 py-6">
              <p className="text-sm font-medium text-petrol-900">Sin fuente PMS confiable cargada.</p>
              <p className="mt-1 text-sm text-slate-500">
                La capa económica permanecerá vacía hasta que exista evidencia importada. No se
                fabrican valores para completar el tablero.
              </p>
            </div>
          )}
        </Card>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-xs text-slate-400">
        <span>
          AROH operativo = datos vivos · PMS = último informe importado con fecha y fuente.
        </span>
        <Link href="/indicadores" className="font-medium text-petrol-600 hover:underline">
          Abrir indicadores operativos detallados
        </Link>
      </footer>
    </div>
  );
}
