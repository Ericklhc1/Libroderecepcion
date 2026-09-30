import Link from 'next/link';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  BedDouble,
  Database,
  KeyRound,
  Minus,
  ShieldAlert,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import {
  getManagementCockpit,
  type ManagementDecisionSeverity,
  type ManagementTrend,
} from '@/server/services/management';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Gerencia' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DECISION_STYLE: Record<
  ManagementDecisionSeverity,
  { label: string; className: string; dot: string }
> = {
  critica: {
    label: 'Decisión prioritaria',
    className: 'border-red-200 bg-red-50/60',
    dot: 'bg-red-600',
  },
  atencion: {
    label: 'Requiere atención',
    className: 'border-amber-200 bg-amber-50/55',
    dot: 'bg-amber-500',
  },
  seguimiento: {
    label: 'Seguimiento ejecutivo',
    className: 'border-slate-200 bg-white',
    dot: 'bg-gold-500',
  },
};

function pct(value: number | null) {
  return value === null ? '—' : `${Math.round(value)}%`;
}


function trendValue(item: ManagementTrend, value: number | null) {
  if (value === null) return '—';
  if (item.unit === '%') return `${Math.round(value)}%`;
  if (item.unit === 'h') return `${value.toFixed(1)} h`;
  return Math.round(value).toLocaleString('es-CL');
}

function trendDelta(item: ManagementTrend) {
  if (item.current === null || item.previous === null) {
    return { label: 'Sin base comparable', tone: 'neutral' as const, icon: Minus };
  }
  const delta = item.current - item.previous;
  if (Math.abs(delta) < 0.05) {
    return { label: 'Sin cambio material', tone: 'neutral' as const, icon: Minus };
  }
  const improved = item.better === 'higher' ? delta > 0 : delta < 0;
  const sign = delta > 0 ? '+' : '';
  const suffix = item.unit === '%' ? ' pp' : item.unit === 'h' ? ' h' : '';
  return {
    label: `${sign}${item.unit === 'h' ? delta.toFixed(1) : Math.round(delta)}${suffix}`,
    tone: improved ? ('good' as const) : ('bad' as const),
    icon: delta > 0 ? ArrowUpRight : ArrowDownRight,
  };
}

function Metric({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-l-2 border-slate-200 px-3 py-2 first:border-l-0">
      <p className="text-[0.67rem] font-semibold uppercase tracking-[0.07em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular ${emphasis ? 'text-red-700' : 'text-petrol-950'}`}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SourceState({
  title,
  status,
  detail,
}: {
  title: string;
  status: 'connected' | 'not_connected';
  detail: string;
}) {
  const connected = status === 'connected';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-petrol-950">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{detail}</p>
      </div>
      <span
        className={`shrink-0 rounded-sm px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] ${
          connected
            ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
            : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
        }`}
      >
        {connected ? 'Conectada' : 'No conectada'}
      </span>
    </div>
  );
}

export default async function ManagementPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission('management.dashboard.view');
  const params = await searchParams;
  const requestedDays = Number(typeof params.dias === 'string' ? params.dias : 30);
  const cockpit = await getManagementCockpit(requestedDays);
  const periodLabel = `${cockpit.period.days} días`;

  const cashSummary =
    cockpit.controls.cashDifferenceByCurrency.length > 0
      ? cockpit.controls.cashDifferenceByCurrency
          .map((row) => `${row.currency} ${row.amount.toLocaleString('es-CL')}`)
          .join(' · ')
      : 'Sin diferencias monetarias en arqueos del período';

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="border-b border-slate-300 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-gold-600">
              <Target className="h-4 w-4" aria-hidden="true" />
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.09em]">
                Dirección y toma de decisión
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-petrol-950">
              Cockpit de Gerencia
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Qué cambió, dónde está el riesgo y qué requiere una decisión. Los hechos provienen
              de la operación registrada en AROH; las métricas sin fuente conectada no se estiman.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            {[7, 30, 90].map((days) => (
              <Link
                key={days}
                href={`/gerencia?dias=${days}`}
                aria-current={cockpit.period.days === days ? 'page' : undefined}
                className={`rounded-sm px-3 py-2 text-sm font-medium ring-1 ${
                  cockpit.period.days === days
                    ? 'bg-petrol-950 text-white ring-petrol-950'
                    : 'bg-white text-petrol-800 ring-slate-300 hover:bg-slate-50'
                }`}
              >
                {days} días
              </Link>
            ))}
            <Link
              href="/indicadores"
              className="rounded-sm bg-white px-3 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Indicadores operativos
            </Link>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Fotografía generada {formatDateTime(cockpit.generatedAt)} · comparación contra los {periodLabel} inmediatamente anteriores
        </p>
      </header>

      <section aria-labelledby="management-decisions">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 id="management-decisions" className="text-sm font-semibold text-petrol-950">
              Decisiones requeridas
            </h2>
            <p className="text-xs text-slate-500">
              Excepciones que justifican intervención gerencial. No son notificaciones ni tareas nuevas.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-400">
            {cockpit.decisions.length} señal(es)
          </span>
        </div>

        {cockpit.decisions.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-5">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 text-emerald-700" aria-hidden="true" />
              <div>
                <p className="font-semibold text-emerald-950">Sin excepciones gerenciales abiertas</p>
                <p className="mt-1 text-sm text-emerald-800">
                  La fotografía actual no detecta señales que requieran escalamiento gerencial inmediato.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {cockpit.decisions.map((decision) => {
              const style = DECISION_STYLE[decision.severity];
              return (
                <article
                  key={decision.id}
                  className={`rounded-lg border px-4 py-4 shadow-card ${style.className}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.07em] text-slate-500">
                        {style.label}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-petrol-950">{decision.title}</h3>
                      <p className="mt-2 text-sm font-medium text-slate-800">{decision.fact}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{decision.why}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3">
                        <p className="text-xs font-medium text-petrol-800">
                          Decisión: {decision.action}
                        </p>
                        <Link
                          href={decision.href}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-gold-700 hover:underline"
                        >
                          Ver evidencia
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="management-scorecard" className="rounded-lg border border-slate-300 bg-white shadow-card">
        <div className="border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
          <h2 id="management-scorecard" className="text-[0.78rem] font-semibold uppercase tracking-[0.055em] text-petrol-900">
            Scorecard ejecutivo · {periodLabel}
          </h2>
        </div>

        <div className="divide-y divide-slate-200">
          <div className="grid gap-0 px-2 py-2 lg:grid-cols-[12rem_1fr]">
            <div className="flex items-center gap-2 px-3 py-3">
              <Activity className="h-4 w-4 text-gold-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-petrol-950">Ejecución</p>
                <p className="text-xs text-slate-500">Cumplimiento y continuidad</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-0 md:grid-cols-4">
              <Metric label="Tareas en plazo" value={pct(cockpit.execution.taskOnTimeRate)} />
              <Metric label="Tareas vencidas" value={cockpit.execution.overdueTasks} emphasis={cockpit.execution.overdueTasks > 0} />
              <Metric label="Entregas recibidas" value={pct(cockpit.execution.handoverComplianceRate)} />
              <Metric label="Turnos cerrados" value={pct(cockpit.execution.shiftClosureRate)} />
            </div>
          </div>

          <div className="grid gap-0 px-2 py-2 lg:grid-cols-[12rem_1fr]">
            <div className="flex items-center gap-2 px-3 py-3">
              <BedDouble className="h-4 w-4 text-gold-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-petrol-950">Preparación</p>
                <p className="text-xs text-slate-500">Próximas llegadas</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-0 md:grid-cols-4">
              <Metric label="Llegadas 24 h" value={cockpit.readiness.arrivals24} />
              <Metric label="24 h con fricción" value={cockpit.readiness.arrivals24AtRisk} emphasis={cockpit.readiness.arrivals24AtRisk > 0} />
              <Metric label="Garantía pendiente" value={cockpit.readiness.guaranteeRisk} />
              <Metric label="Con saldo pendiente" value={cockpit.readiness.withBalance} />
            </div>
          </div>

          <div className="grid gap-0 px-2 py-2 lg:grid-cols-[12rem_1fr]">
            <div className="flex items-center gap-2 px-3 py-3">
              <ShieldAlert className="h-4 w-4 text-gold-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-petrol-950">Riesgo y control</p>
                <p className="text-xs text-slate-500">Excepciones verificables</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-0 md:grid-cols-4">
              <Metric label="Incidencias abiertas" value={cockpit.execution.openIncidents} />
              <Metric label="Críticas abiertas" value={cockpit.execution.criticalOpenIncidents} emphasis={cockpit.execution.criticalOpenIncidents > 0} />
              <Metric label="Correctivas vencidas" value={cockpit.controls.correctiveOverdue} emphasis={cockpit.controls.correctiveOverdue > 0} />
              <Metric label="Arqueos con diferencia" value={cockpit.controls.cashDifferences} emphasis={cockpit.controls.cashDifferences > 0} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-lg border border-slate-300 bg-white shadow-card">
          <div className="border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
            <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.055em] text-petrol-900">
              Tendencia · actual vs. período anterior
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {cockpit.trends.map((item) => {
              const change = trendDelta(item);
              const Icon = change.icon;
              return (
                <div key={item.key} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_9rem_9rem_8rem]">
                  <p className="text-sm font-medium text-petrol-950">{item.label}</p>
                  <div>
                    <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">Actual</p>
                    <p className="mt-0.5 font-semibold tabular text-petrol-950">{trendValue(item, item.current)}</p>
                  </div>
                  <div>
                    <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">Anterior</p>
                    <p className="mt-0.5 tabular text-slate-600">{trendValue(item, item.previous)}</p>
                  </div>
                  <div
                    className={`inline-flex w-fit items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold ${
                      change.tone === 'good'
                        ? 'bg-emerald-50 text-emerald-800'
                        : change.tone === 'bad'
                          ? 'bg-red-50 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {change.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-300 bg-white shadow-card">
            <div className="border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
              <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.055em] text-petrol-900">
                Exposición de control
              </h2>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <Banknote className="mt-0.5 h-4 w-4 text-gold-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-petrol-950">Caja</p>
                  <p className="text-xs leading-5 text-slate-500">
                    {cockpit.controls.cashDifferences} arqueo(s) con diferencia · {cashSummary}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-4 w-4 text-gold-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-petrol-950">Llaves</p>
                  <p className="text-xs leading-5 text-slate-500">
                    {cockpit.controls.keysMissing} faltante(s) · {cockpit.controls.keysOutOfService} fuera de servicio
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 text-gold-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-petrol-950">Auditoría y correctivas</p>
                  <p className="text-xs leading-5 text-slate-500">
                    {cockpit.controls.auditsOpen} auditoría(s) abierta(s) · {cockpit.controls.correctiveOpen} medida(s) activa(s) · {cockpit.controls.correctiveOverdue} vencida(s)
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-300 bg-white shadow-card">
            <div className="border-b border-slate-200 bg-[#f8fafc] px-4 py-3">
              <h2 className="flex items-center gap-2 text-[0.78rem] font-semibold uppercase tracking-[0.055em] text-petrol-900">
                <Database className="h-4 w-4 text-gold-600" aria-hidden="true" />
                Calidad de la capa estratégica
              </h2>
            </div>
            <div className="px-4">
              <SourceState title="Operación AROH" status={cockpit.sources.operational} detail="Tareas, incidencias, turnos, continuidad y auditoría." />
              <SourceState title="Reservas" status={cockpit.sources.reservations} detail="Próximas 24/72 h, saldos, garantías y acciones pendientes." />
              <SourceState title="Caja y llaves" status={cockpit.sources.cash} detail="Arqueos, diferencias, custodia e inventario físico." />
              <SourceState title="PMS comercial" status={cockpit.sources.commercialPms} detail="Ocupación, ADR, RevPAR, pickup y pace: fuente aún no conectada." />
              <SourceState title="Finanzas" status={cockpit.sources.finance} detail="GOP, GOPPAR y Flow Through/Flex: requieren fuente financiera." />
              <SourceState title="RR. HH. / labor" status={cockpit.sources.labor} detail="Horas, costo laboral, productividad POR/PAR y sobretiempo." />
              <SourceState title="Voz del huésped" status={cockpit.sources.guestVoice} detail="Reputación, satisfacción y recuperación de servicio." />
              <SourceState title="Benchmark competitivo" status={cockpit.sources.benchmark} detail="Comp set e índices de mercado: requiere proveedor externo." />
            </div>
          </div>
        </div>
      </section>

      <footer className="rounded-lg border border-slate-200 bg-[#f8fafc] px-4 py-3 text-xs leading-5 text-slate-500">
        <strong className="text-petrol-800">Principio de diseño:</strong> una decisión gerencial puede transformarse después en una
        Tarea; una atención en un momento concreto, en una Alerta; y la Notificación sigue siendo sólo el aviso.
        El cockpit no crea objetos automáticamente ni altera sus estados.
      </footer>
    </div>
  );
}
