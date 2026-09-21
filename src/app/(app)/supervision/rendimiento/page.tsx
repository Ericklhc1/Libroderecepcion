import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Gauge } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { getTeamPerformance } from '@/server/services/performance';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { ListFilterBar } from '@/components/ui/list-controls';
import { PerformanceObservationDialog } from '@/components/supervision/center-actions';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';
import { ROLE_KEYS } from '@/lib/permissions';

export const metadata = { title: 'Rendimiento operativo' };
export const dynamic = 'force-dynamic';

function periodFrom(params: RawSearchParams) {
  const now = new Date();
  const fallback = new Date(now.getTime() - 30 * 86_400_000);
  const from = typeof params.desde === 'string' ? new Date(`${params.desde}T00:00:00`) : fallback;
  const to = typeof params.hasta === 'string' ? new Date(`${params.hasta}T23:59:59.999`) : now;
  return {
    from: Number.isNaN(from.getTime()) ? fallback : from,
    to: Number.isNaN(to.getTime()) ? now : to,
  };
}

const KIND_LABEL = {
  OBSERVACION_SUPERVISOR: 'Observación del Supervisor',
  EXPLICACION_TRABAJADOR: 'Explicación del trabajador',
  CORRECCION_POSTERIOR: 'Corrección posterior',
} as const;

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  if (!hasPermission(user, 'supervision.performance.view')) redirect('/sin-permisos');
  const canComment =
    user.roleKey === ROLE_KEYS.SUPERVISOR &&
    !user.isSystemAdmin &&
    hasPermission(user, 'supervision.performance.comment');
  const params = await searchParams;
  const period = periodFrom(params);
  const selected = typeof params.usuario === 'string' ? params.usuario : '';
  const q = typeof params.q === 'string' ? params.q.trim().toLocaleLowerCase('es-CL') : '';
  const rows = await getTeamPerformance(user, period);
  const visible = rows.filter((row) =>
    (!selected || row.user.id === selected) &&
    (!q || [row.user.name, row.user.role.name, ...row.indicators.map((item) => item.label)].join(' ').toLocaleLowerCase('es-CL').includes(q)),
  );
  const start = period.from.toISOString().slice(0, 10);
  const end = period.to.toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Link href="/supervision" className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Volver al Centro de Supervisión</Link>
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900"><Gauge className="h-5 w-5 text-petrol-600" aria-hidden="true" />Rendimiento operativo</h1>
        <p className="mt-0.5 text-sm text-slate-600">Indicadores separados, sin nota global. Cada valor muestra fórmula, base de casos, contexto y registros de origen.</p>
      </header>

      <ListFilterBar searchValue={q} searchPlaceholder="Buscar persona o dimensión…" clearHref="/supervision/rendimiento">
        <label className="min-w-[14rem]"><span className="mb-1 block text-xs font-medium text-slate-500">Persona</span><select name="usuario" defaultValue={selected} className="input-base w-full"><option value="">Equipo completo</option>{rows.map((row) => <option key={row.user.id} value={row.user.id}>{row.user.name}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-medium text-slate-500">Desde</span><input className="input-base" type="date" name="desde" defaultValue={start} /></label>
        <label><span className="mb-1 block text-xs font-medium text-slate-500">Hasta</span><input className="input-base" type="date" name="hasta" defaultValue={end} /></label>
      </ListFilterBar>

      {visible.length === 0 ? <Card><EmptyState message="No hay personas o datos con esos filtros." /></Card> : visible.map((row) => (
        <Card key={row.user.id}>
          <CardHeader title={`${row.user.name} · ${row.user.role.name}`} action={canComment ? <PerformanceObservationDialog subjectId={row.user.id} subjectName={row.user.name} periodStart={start} periodEnd={end} /> : null} />
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap gap-2"><Chip>Periodo: {start} → {end}</Chip><Chip>{row.context.shiftsWorked} turno(s) trabajado(s)</Chip><Chip>{row.context.assignedTasks} tarea(s)</Chip><Chip>{row.context.auditedPoints} punto(s) auditado(s)</Chip><Chip>Ausencias: sin fuente integrada</Chip></div>
            {row.context.comparabilityNote ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{row.context.comparabilityNote}</p> : null}
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {row.indicators.map((indicator) => (
              <article key={indicator.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-medium text-petrol-900">{indicator.label}</h2><Badge tone={indicator.kind === 'REINCIDENCIA' || indicator.kind === 'HALLAZGO_CONFIRMADO' ? 'atencion' : 'curso'}>{indicator.kind === 'DATO_OPERATIVO' ? 'Dato operativo' : indicator.kind === 'HALLAZGO_CONFIRMADO' ? 'Hallazgo confirmado' : indicator.kind === 'REINCIDENCIA' ? 'Reincidencia' : 'Tendencia'}</Badge></div>
                <p className="mt-2 text-2xl font-semibold tabular text-petrol-900">{indicator.value === null ? 'Sin base' : `${indicator.value}%`}</p>
                <p className="mt-1 text-xs text-slate-600">{indicator.numerator} de {indicator.denominator} casos</p>
                <p className="mt-2 text-xs font-medium text-slate-500">Fórmula</p><p className="text-xs text-slate-700">{indicator.formula}</p>
                <p className="mt-2 text-xs font-medium text-slate-500">Fuente</p><p className="text-xs text-slate-700">{indicator.source}</p>
                {indicator.cases.length > 0 ? <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-petrol-600">Ver {indicator.cases.length} registro(s) de origen</summary><ul className="mt-1 max-h-36 space-y-1 overflow-y-auto border-l-2 border-slate-200 pl-2">{indicator.cases.map((item) => <li key={`${indicator.key}-${item.id}`}><Link href={item.href} className="text-xs text-petrol-700 hover:underline">{item.label}</Link></li>)}</ul></details> : null}
              </article>
            ))}
          </div>
          {row.observations.length > 0 ? <div className="border-t border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-petrol-900">Observaciones y explicaciones</h2><ul className="mt-2 space-y-2">{row.observations.map((item) => <li key={item.id} className="rounded-lg bg-slate-50 p-2"><div className="flex flex-wrap gap-2"><Chip>{KIND_LABEL[item.kind]}</Chip><span className="text-xs text-slate-500">{item.author.name} · {formatDateTime(item.createdAt)}</span></div><p className="mt-1 text-sm text-slate-700">{item.content}</p></li>)}</ul></div> : null}
        </Card>
      ))}

      <p className="text-xs text-slate-500">No se usan tiempo conectado, pulsaciones, volumen bruto de registros, clasificaciones públicas ni penalizaciones automáticas por una incidencia aislada.</p>
    </div>
  );
}
