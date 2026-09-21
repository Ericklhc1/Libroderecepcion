import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { getFormOptions } from '@/server/services/options';
import { getMyOpenRun, listRuns, listTemplates } from '@/server/services/checklists';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import {
  DeleteTemplateDialog,
  FinishRunDialog,
  MarkItemForm,
  StartAuditDialog,
  TemplateDialog,
} from '../tablero/checklists';
import {
  CorrectiveMeasureDialog,
  ValidateCorrectiveMeasureDialog,
} from '@/components/supervision/center-actions';
import type { RawSearchParams } from '@/lib/search-params';
import { ROLE_KEYS } from '@/lib/permissions';

export const metadata = { title: 'Auditorías sorpresa' };
export const dynamic = 'force-dynamic';

const CATEGORY_LABEL = {
  CAJA_MOVIMIENTOS: 'Caja y movimientos',
  GARANTIAS: 'Garantías',
  LLAVES: 'Llaves',
  RESERVAS: 'Reservas',
  HABITACIONES: 'Habitaciones',
  CALIDAD_REGISTROS: 'Calidad de registros',
  ENTREGA_CIERRE_TURNO: 'Entrega y cierre de turno',
  CUMPLIMIENTO_PROCEDIMIENTOS: 'Cumplimiento de procedimientos',
  OTRO: 'Otro control',
} as const;

const RESULT_LABEL = {
  PENDIENTE: 'Sin revisar',
  OK: 'Cumple (histórico)',
  CUMPLE: 'Cumple',
  OBSERVACION: 'Observación',
  FALLA: 'Incumplimiento (histórico)',
  INCUMPLIMIENTO: 'Incumplimiento',
  NO_APLICA: 'No aplica',
} as const;

const RESULT_TONE = {
  PENDIENTE: 'neutro',
  OK: 'resuelto',
  CUMPLE: 'resuelto',
  OBSERVACION: 'atencion',
  FALLA: 'critico',
  INCUMPLIMIENTO: 'critico',
  NO_APLICA: 'neutro',
} as const;

export default async function SurpriseAuditsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  if (!hasPermission(user, 'supervision.audit.reserved')) redirect('/sin-permisos');
  const isSupervisor = user.roleKey === ROLE_KEYS.SUPERVISOR && !user.isSystemAdmin;
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLocaleLowerCase('es-CL') : '';
  const category = typeof params.categoria === 'string' ? params.categoria : '';
  const status = typeof params.estado === 'string' ? params.estado : '';

  const [templates, runs, myRun, findings, measures, options] = await Promise.all([
    listTemplates(true),
    listRuns(user, 30),
    getMyOpenRun(user.id),
    prisma.auditFinding.findMany({
      where: { deletedAt: null, confirmed: true },
      include: { audit: { select: { templateName: true, finishedAt: true } }, correctiveMeasures: true },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
    prisma.correctiveMeasure.findMany({
      where: { deletedAt: null },
      include: { assignee: { select: { name: true } }, task: { select: { id: true, seq: true } } },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
    getFormOptions(),
  ]);

  const matches = (...values: Array<string | number | null | undefined>) =>
    !q || values.filter(Boolean).join(' ').toLocaleLowerCase('es-CL').includes(q);
  const visibleTemplates = templates.filter(
    (template) =>
      (!category || template.category === category) &&
      matches(template.name, template.description, CATEGORY_LABEL[template.category]),
  );
  const visibleRuns = runs.filter(
    (run) =>
      (!status || run.status === status) &&
      matches(run.templateName, run.runBy.name, run.notes, run.resultSummary),
  );
  const visibleFindings = findings.filter((finding) =>
    matches(finding.title, finding.description, finding.audit.templateName, finding.severity),
  );
  const openMeasures = measures.filter((measure) => !['VALIDADA', 'CANCELADA'].includes(measure.status));
  const pending = myRun?.items.filter((item) => item.result === 'PENDIENTE').length ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Link href="/supervision" className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al Centro de Supervisión
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900"><ClipboardCheck className="h-5 w-5 text-petrol-600" aria-hidden="true" />Auditorías sorpresa</h1>
          <p className="mt-0.5 text-sm text-slate-600">Las auditorías permanecen reservadas durante su preparación y no notifican previamente al equipo.</p>
        </div>
        {isSupervisor ? <TemplateDialog /> : null}
      </header>

      <ListFilterBar searchValue={q} searchPlaceholder="Buscar control, hallazgo, persona o evidencia…" clearHref="/supervision/auditorias">
        <label className="min-w-[13rem]"><span className="mb-1 block text-xs font-medium text-slate-500">Tipo de control</span><select name="categoria" defaultValue={category} className="input-base w-full"><option value="">Todos</option>{Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="min-w-[11rem]"><span className="mb-1 block text-xs font-medium text-slate-500">Estado</span><select name="estado" defaultValue={status} className="input-base w-full"><option value="">Todos</option><option value="PREPARACION">Preparación</option><option value="EN_CURSO">En curso</option><option value="CERRADA">Cerrada</option></select></label>
      </ListFilterBar>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Plantillas" value={templates.length} tone="neutral" />
        <StatTile label="Auditorías abiertas" value={runs.filter((run) => run.status !== 'CERRADA').length} tone={runs.some((run) => run.status !== 'CERRADA') ? 'alert' : 'good'} />
        <StatTile label="Hallazgos confirmados" value={findings.length} tone={findings.length ? 'alert' : 'good'} />
        <StatTile label="Medidas pendientes" value={openMeasures.length} tone={openMeasures.length ? 'alert' : 'good'} />
      </div>

      {myRun ? (
        <Card>
          <CardHeader title={`Auditoría en curso: ${myRun.templateName}`} count={myRun.items.length} action={isSupervisor && pending === 0 ? <FinishRunDialog runId={myRun.id} /> : null} />
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{pending > 0 ? `Quedan ${pending} punto(s) sin revisar.` : 'Todos los puntos fueron revisados. Define la comunicación y cierra.'}</p>
          <CardScroll><ul className="divide-y divide-slate-100">{myRun.items.map((item) => <li key={item.id} className="px-4 py-3"><Badge tone={RESULT_TONE[item.result]}>{RESULT_LABEL[item.result]}</Badge>{isSupervisor ? <div className="mt-2"><MarkItemForm itemId={item.id} result={item.result} observation={item.observation} evidence={item.evidence} critical={item.critical} text={item.text} /></div> : <p className="mt-2 text-sm text-petrol-900">{item.text}</p>}</li>)}</ul></CardScroll>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex h-[30rem] flex-col overflow-hidden">
          <CardHeader title="Plantillas configurables" count={visibleTemplates.length} />
          {visibleTemplates.length === 0 ? <EmptyState message="No hay plantillas con esos filtros." /> : <CardScroll className="flex-1" maxHeight="max-h-none"><ul className="divide-y divide-slate-100">{visibleTemplates.map((template) => <li key={template.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div><div className="flex flex-wrap gap-2"><p className="font-medium text-petrol-900">{template.name}</p><Chip>{CATEGORY_LABEL[template.category]}</Chip><Chip>{template.items.length} punto(s)</Chip></div><p className="mt-1 text-sm text-slate-600">{template.description ?? 'Sin descripción.'}</p></div>{isSupervisor ? <div className="flex flex-wrap gap-1">{template.active && !myRun ? <StartAuditDialog templateId={template.id} templateName={template.name} users={options.users} shifts={options.activeShifts} departments={options.departments} /> : null}<TemplateDialog template={{ id: template.id, name: template.name, description: template.description, cadence: template.cadence, category: template.category, active: template.active, items: template.items }} /><DeleteTemplateDialog templateId={template.id} /></div> : null}</li>)}</ul></CardScroll>}
        </Card>
        <Card className="flex h-[30rem] flex-col overflow-hidden">
          <CardHeader title="Historial de auditorías" count={visibleRuns.length} />
          {visibleRuns.length === 0 ? <EmptyState message="No hay auditorías con esos filtros." /> : <CardScroll className="flex-1" maxHeight="max-h-none"><ul className="divide-y divide-slate-100">{visibleRuns.map((run) => { const failures = run.items.filter((item) => item.result === 'FALLA' || item.result === 'INCUMPLIMIENTO'); return <li key={run.id} className="px-4 py-3"><div className="flex flex-wrap gap-2"><p className="font-medium text-petrol-900">{run.templateName}</p><Badge tone={run.status === 'CERRADA' ? 'resuelto' : run.status === 'PREPARACION' ? 'pendiente' : 'curso'}>{run.status === 'CERRADA' ? 'Cerrada' : run.status === 'PREPARACION' ? 'Preparación reservada' : 'En curso'}</Badge>{failures.length ? <Badge tone="critico">{failures.length} incumplimiento(s)</Badge> : null}</div><p className="mt-1 text-xs text-slate-500">{run.runBy.name} · {formatDateTime(run.startedAt)}{run.finishedAt ? ` → ${formatDateTime(run.finishedAt)}` : ''} · {run.disclosure.toLocaleLowerCase('es-CL')}</p></li>; })}</ul></CardScroll>}
        </Card>
      </div>

      <Card>
        <CardHeader title="Hallazgos confirmados" count={visibleFindings.length} />
        {visibleFindings.length === 0 ? <EmptyState message="No hay hallazgos confirmados." /> : <CardScroll><ul className="divide-y divide-slate-100">{visibleFindings.map((finding) => <li key={finding.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge tone={finding.severity === 'CRITICA' || finding.severity === 'ALTA' ? 'critico' : 'atencion'}>{finding.severity.toLocaleLowerCase('es-CL')}</Badge><Chip>{finding.audit.templateName}</Chip></div><p className="mt-1 font-medium text-petrol-900">{finding.title}</p><p className="text-sm text-slate-600">{finding.description}</p></div>{finding.correctiveMeasures.length === 0 && isSupervisor ? <CorrectiveMeasureDialog findingId={finding.id} findingTitle={finding.title} users={options.users} /> : finding.correctiveMeasures.length > 0 ? <Chip>Medida creada</Chip> : null}</li>)}</ul></CardScroll>}
      </Card>

      <Card>
        <CardHeader title="Medidas correctivas" count={measures.length} />
        {measures.length === 0 ? <EmptyState message="No hay medidas correctivas." /> : <CardScroll><ul className="divide-y divide-slate-100">{measures.map((measure) => <li key={measure.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div><div className="flex flex-wrap gap-2"><Badge tone={measure.status === 'VALIDADA' ? 'resuelto' : measure.status === 'BLOQUEADA' ? 'critico' : 'atencion'}>{measure.status.toLocaleLowerCase('es-CL')}</Badge>{measure.task ? <Link href={`/tareas/${measure.task.id}`}><Chip>T#{measure.task.seq}</Chip></Link> : null}</div><p className="mt-1 font-medium text-petrol-900">{measure.title}</p><p className="text-xs text-slate-500">{measure.assignee.name}{measure.dueAt ? ` · vence ${formatDateTime(measure.dueAt)}` : ''}</p></div>{isSupervisor && measure.status === 'REALIZADA' ? <ValidateCorrectiveMeasureDialog measureId={measure.id} /> : null}</li>)}</ul></CardScroll>}
      </Card>
    </div>
  );
}
