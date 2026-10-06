import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Gauge, NotebookPen, ShieldCheck } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import {getCoordinationBoard} from '@/server/services/coordination';
import { getSupervisionData, type SupervisionBlock } from '@/server/services/supervision';
import {
  getSupervisionCenterSummary,
  getSupervisionOpeningReadiness,
} from '@/server/services/supervision-center';
import { getTeamPerformance } from '@/server/services/performance';
import { getFormOptions } from '@/server/services/options';
import { listAnnouncements } from '@/server/services/announcements';
import { listOperationalUsers } from '@/server/services/users';
import { Card, CardHeader, CardScroll, DisclosureCard, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Badge, Chip } from '@/components/ui/badge';
import { TONE_STYLES } from '@/components/ui/tone';
import { Dialog } from '@/components/ui/dialog';
import { CloseFollowUpDialog } from '@/components/operational/entry-actions';
import { TaskForm } from '@/components/forms/task-form';
import { SupervisionAuditDashboard } from '@/components/supervision/audit-dashboard';
import { SupervisionOpeningPanel } from '@/components/supervision/opening-panel';
import { createTaskAction } from '@/server/actions/tasks';
import {
  DeleteSupervisionNoteDialog,
  FinishSupervisionShiftForm,
  FollowSupervisionSourceForm,
  NewSupervisionNoteDialog,
  StartSupervisionShiftDialog,
  StopFollowingSupervisionForm,
  ValidateCorrectiveMeasureDialog,
} from '@/components/supervision/center-actions';
import { CloseAnnouncementDialog, NewAnnouncementDialog } from './announcements';
import { formatDateTime } from '@/lib/format';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
} from '@/domain/labels';
import type { RawSearchParams } from '@/lib/search-params';
import { ROLE_KEYS } from '@/lib/permissions';
import {
  addHotelCalendarDays,
  hotelDateKey,
  hotelWallDateTime,
} from '@/domain/time';
import { auditOperationalPendingCount } from '@/domain/supervision-audit-review';

export const metadata = { title: 'Centro de Supervisión' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function ReviewBlock({
  block,
  canFollow,
  followedSourceKeys,
}: {
  block: SupervisionBlock;
  canFollow: boolean;
  followedSourceKeys: Set<string>;
}) {
  const tone = TONE_STYLES[block.tone];
  return (
    <Card className="flex h-[26rem] flex-col overflow-hidden">
      <CardHeader title={block.title} count={block.rows.length} />
      <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{block.hint}</p>
      {block.rows.length === 0 ? (
        <EmptyState message="Nada que revisar en este punto." />
      ) : (
        <CardScroll className="flex-1" maxHeight="max-h-none">
          <ul className="divide-y divide-slate-100">
            {block.rows.map((row) => (
              <li key={row.id} className="flex items-start gap-2 px-4 py-3 hover:bg-slate-50">
                <Link href={row.href} className="flex min-w-0 flex-1 gap-3">
                  <span className={`mt-0.5 text-xs font-semibold ${tone.text}`} aria-hidden="true">
                    {tone.symbol}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-medium tabular text-slate-500">{row.ref}</span>
                      <span className="text-sm font-medium text-petrol-900">{row.title}</span>
                    </span>
                    {row.detail ? <span className="mt-0.5 block text-xs text-slate-600">{row.detail}</span> : null}
                    {row.meta ? <span className="mt-0.5 block text-xs text-slate-500">{row.meta}</span> : null}
                  </span>
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-1.5 no-print">
                  <Link
                    href={row.href}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1.5 text-xs font-semibold text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    Gestionar
                  </Link>
                  {canFollow && row.sourceEntity && row.sourceId && row.sourceEntity !== 'FollowUp' ? (
                    followedSourceKeys.has(`${row.sourceEntity}:${row.sourceId}`) ? (
                      <Chip>Siguiendo</Chip>
                    ) : (
                      <FollowSupervisionSourceForm sourceEntity={row.sourceEntity} sourceId={row.sourceId} />
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardScroll>
      )}
    </Card>
  );
}

function parsePeriod(params: RawSearchParams) {
  const now = new Date();
  const todayKey = hotelDateKey(now);
  const defaultFrom = hotelWallDateTime(todayKey, 0);
  const parseKey = (value: unknown, endOfDay = false) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const start = hotelWallDateTime(value, 0);
    return endOfDay
      ? new Date(addHotelCalendarDays(start, 1).getTime() - 1)
      : start;
  };
  return {
    from: parseKey(params.desde) ?? defaultFrom,
    to: parseKey(params.hasta, true) ?? now,
  };
}

export default async function SupervisionCenterPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  if (!hasPermission(user, 'supervision.center.view')) redirect('/sin-permisos');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLocaleLowerCase('es-CL') : '';
  const priority = typeof params.prioridad === 'string' ? params.prioridad : '';
  const period = parsePeriod(params);
  const requestedSection = typeof params.seccion === 'string' ? params.seccion : '';
  const sectionHref = (section: string) => {
    const query = new URLSearchParams();
    if (typeof params.q === 'string' && params.q.trim()) query.set('q', params.q.trim());
    if (priority) query.set('prioridad', priority);
    query.set('desde', hotelDateKey(period.from));
    query.set('hasta', hotelDateKey(period.to));
    query.set('seccion', section);
    return `/supervision?${query.toString()}#${section}`;
  };
  const isSupervisor = (user.roleKey === ROLE_KEYS.SUPERVISOR || user.roleKey === ROLE_KEYS.SYSTEM_ADMIN);
  const canPerformance = hasPermission(user, 'supervision.performance.view');
  const canAssignTasks = hasPermission(user, 'task.create') && hasPermission(user, 'task.assign');
  const canFollow = hasPermission(user, 'supervision.followup.manage');
  const canAnnounce = hasPermission(user, 'announcement.manage');
  const [center, review, options, announcements, operationalUsers, performance, blockedBoard, reviewBoard, unassignedBoard, continuityBoard] = await Promise.all([
    getSupervisionCenterSummary(user),
    getSupervisionData(user),
    getFormOptions(user),
    canAnnounce ? listAnnouncements() : Promise.resolve([]),
    canAnnounce ? listOperationalUsers() : Promise.resolve([]),
    canPerformance ? getTeamPerformance(user, period) : Promise.resolve([]),
    getCoordinationBoard(user,{view:'blocked',q}),
    getCoordinationBoard(user,{state:'revision',q}),
    getCoordinationBoard(user,{view:'unassigned',q}),
    getCoordinationBoard(user,{view:'carryover',q}),
  ]);

  const openingReadiness =
    isSupervisor && center.currentShift?.status === 'PREPARACION'
      ? await getSupervisionOpeningReadiness(user)
      : null;

  const matches = (...values: Array<string | number | null | undefined>) =>
    !q || values.filter(Boolean).join(' ').toLocaleLowerCase('es-CL').includes(q);
  const inPeriod = (value: Date) => value >= period.from && value <= period.to;
  // La continuidad activa no se oculta por antigüedad: si sigue abierta, sigue siendo trabajo.
  const tasks = center.myTasks.filter(
    (task) =>
      (!priority || task.priority === priority) &&
      matches(task.humanId, task.title, task.assignee?.name, task.status, task.priority),
  );
  const followUps = center.myFollowUps.filter(
    (item) =>
      (!priority || item.priority === priority) &&
      matches(item.action, item.owner.name, item.status, item.priority),
  );
  const notes = center.notes.filter((note) =>
    inPeriod(note.createdAt) && matches(note.title, note.body, note.author.name),
  );
  const audits = center.audits.filter((audit) =>
    inPeriod(audit.startedAt) &&
    matches(audit.templateName, audit.runBy.name, audit.status, audit.scope),
  );
  const measures = center.measures.filter((measure) =>
    matches(measure.title, measure.action, measure.assignee.name, measure.status),
  );
  const exception=typeof params.excepcion==='string'?params.excepcion:'';
  const overdue=review.blocks.filter(b=>['tareas','seguimientos'].includes(b.key)).reduce((sum,b)=>sum+b.rows.length,0);
  const blocks = review.blocks
    .filter(b=>exception==='criticos'?b.tone==='critico':exception==='vencidos'?['tareas','seguimientos'].includes(b.key):true)
    .map((block) => ({
      ...block,
      rows: block.rows.filter((row) => matches(row.ref, row.title, row.detail, row.meta)),
    }))
    .filter((block) => block.rows.length > 0);
  const critical = review.blocks
    .filter((block) => block.tone === 'critico')
    .reduce((sum, block) => sum + block.rows.length, 0);
  const pendingClosures = review.blocks.find((block) => block.key === 'cierres')?.rows.length ?? 0;
  const continuityOpen = center.counts.myTasks + center.counts.myFollowUps;
  const auditPendingCount = center.auditImports.reduce((sum, auditImport) => {
    const checks = Array.isArray(auditImport.checks)
      ? (auditImport.checks as Array<{ key: string; done: boolean | null }>)
      : [];
    const findings = Array.isArray(auditImport.findings)
      ? (auditImport.findings as Array<{ key: string }>)
      : [];
    return (
      sum +
      auditOperationalPendingCount({
        metrics: auditImport.metrics,
        checks,
        findings,
        reviewState: auditImport.reviewState,
      })
    );
  }, 0);
  const followedSourceKeys = new Set(
    center.myFollowUps
      .filter((item) => item.sourceEntity && item.sourceId)
      .map((item) => `${item.sourceEntity}:${item.sourceId}`),
  );
  const announcementPending = announcements.reduce(
    (sum, announcement) => sum + Math.max(0, announcement.expected - announcement.confirmed),
    0,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <ShieldCheck className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Centro de Supervisión
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Qué requiere tu atención, qué delegaste y qué decidiste mantener en seguimiento.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Secciones del Centro de Supervisión">
          <Link href="/supervision/tablero" className="rounded-lg bg-white px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50">Asignación</Link>
          <Link href="/supervision/auditorias" className="rounded-lg bg-white px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50">Auditorías</Link>
          {hasPermission(user, 'supervision.audit.create') && <Link href="/supervision/documentos" className="rounded-lg bg-white px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50">Documentos · borrador local</Link>}
          <Link href="/supervision/informes" className="rounded-lg bg-white px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50">Informes</Link>
          <Link href="/supervision/rendimiento" className="rounded-lg bg-white px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50">Rendimiento</Link>
          <Link href="/supervision/salud" className="rounded-lg bg-white px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50">Salud operativa</Link>
        </nav>
      </header>
      <Link href="/coordinacion" className="inline-block text-sm font-medium underline">Ver responsables, recepción y continuidad entre áreas →</Link>

      <section id="senales" aria-label="Excepciones que requieren intervención" className="space-y-3 scroll-mt-28">
        <h2 className="font-semibold text-petrol-900">Intervenir donde hace falta</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Link href="/supervision?seccion=senales&excepcion=criticos#detalle-senales"><StatTile label="🔴 Críticos" value={critical} tone={critical?'alert':'good'}/></Link>
          <Link href="/supervision?seccion=senales&excepcion=vencidos#detalle-senales"><StatTile label="🟠 Vencidos" value={overdue} tone={overdue?'alert':'good'}/></Link>
          <Link href={`/coordinacion?vista=blocked&q=${encodeURIComponent(q)}`}><StatTile label="🟡 Impedimentos" value={blockedBoard.total} tone={blockedBoard.total?'alert':'good'}/></Link>
          <Link href={`/coordinacion?vista=unassigned&q=${encodeURIComponent(q)}`}><StatTile label="🔵 Sin responsable" value={unassignedBoard.total}/></Link>
          <Link href={`/coordinacion?estado=revision&q=${encodeURIComponent(q)}`}><StatTile label="🟣 Por validar" value={reviewBoard.total}/></Link>
          <Link href={`/coordinacion?vista=carryover&q=${encodeURIComponent(q)}`}><StatTile label="🟤 Continuidad anterior" value={continuityBoard.total}/></Link>
        </div>
        <p className="text-xs text-slate-500">Cada indicador abre sus registros reales. Una señal puede coincidir con otra; críticos y vencidos muestran la muestra disponible del centro, sin sumar personas ni crear otra tarea.</p>
      </section>

      <nav className="flex flex-wrap gap-2 no-print" aria-label="Atajos del Centro de Supervisión">
        <a href="#continuidad" className="rounded-full bg-petrol-50 px-3 py-1.5 text-xs font-medium text-petrol-700 ring-1 ring-petrol-100 hover:bg-petrol-100">Desde mi último turno</a>
        <Link href={sectionHref('pendientes')} className="rounded-full bg-petrol-50 px-3 py-1.5 text-xs font-medium text-petrol-700 ring-1 ring-petrol-100 hover:bg-petrol-100">Asignado a mí</Link>
        <Link href={sectionHref('seguimientos')} className="rounded-full bg-petrol-50 px-3 py-1.5 text-xs font-medium text-petrol-700 ring-1 ring-petrol-100 hover:bg-petrol-100">En seguimiento</Link>
        <Link href={sectionHref('senales')} className="rounded-full bg-gold-50 px-3 py-1.5 text-xs font-medium text-petrol-800 ring-1 ring-gold-200 hover:bg-gold-100">Requiere atención</Link>
        <a href="#auditoria-diaria" className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">Auditoría diaria</a>
      </nav>

      <ListFilterBar searchValue={q} searchPlaceholder="Buscar pendiente, señal, nota o persona…" clearHref="/supervision">
        <label className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Prioridad</span>
          <select className="input-base w-full" name="prioridad" defaultValue={priority}>
            <option value="">Todas</option><option value="BAJA">Baja</option><option value="MEDIA">Media</option>
            <option value="ALTA">Alta</option><option value="CRITICA">Crítica</option>
          </select>
        </label>
        <input type="hidden" name="desde" value={hotelDateKey(period.from)} />
        <input type="hidden" name="hasta" value={hotelDateKey(period.to)} />
      </ListFilterBar>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-petrol-900">Período de análisis histórico</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Sólo afecta notas, auditorías y rendimiento. Los pendientes abiertos y seguimientos vigentes no se ocultan por fecha.
          </p>
        </div>
        <form action="/supervision" method="get" className="flex flex-wrap items-end gap-2 no-print">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {priority ? <input type="hidden" name="prioridad" value={priority} /> : null}
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Desde</span>
            <input className="input-base" type="date" name="desde" defaultValue={hotelDateKey(period.from)} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-500">Hasta</span>
            <input className="input-base" type="date" name="hasta" defaultValue={hotelDateKey(period.to)} />
          </label>
          <button type="submit" className="btn-secondary h-10 px-3 text-sm">Aplicar período</button>
        </form>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mi turno de Supervisión</p>
            {center.currentShift ? (
              center.currentShift.status === 'PREPARACION' ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="pendiente">Apertura en curso</Badge>
                    <span className="text-sm text-slate-600">
                      {user.name} · preparación iniciada {formatDateTime(center.currentShift.startedAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    El turno aún no está activo. Completa la recepción operacional que aparece debajo.
                  </p>
                </>
              ) : (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="curso">Gestionando</Badge>
                    <span className="text-sm text-slate-600">{user.name} · iniciado {formatDateTime(center.currentShift.startedAt)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {center.currentShift.priorities.length > 0
                      ? center.currentShift.priorities.map((priority) => <Chip key={priority}>{priority}</Chip>)
                      : <span className="text-sm text-slate-500">Sin pendientes operativos asumidos al abrir.</span>}
                  </div>
                </>
              )
            ) : (
              <p className="mt-1 text-sm text-slate-600">No tienes un turno de Supervisión abierto.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 no-print">
            {isSupervisor && !center.currentShift ? <StartSupervisionShiftDialog /> : null}
            {isSupervisor && center.currentShift && center.currentShift.status !== 'PREPARACION' ? (
              <FinishSupervisionShiftForm
                shiftId={center.currentShift.id}
                criticalCount={critical + pendingClosures}
                continuityCount={continuityOpen}
                auditPendingCount={auditPendingCount}
              />
            ) : null}
          </div>
        </div>
      </Card>

      {openingReadiness ? <SupervisionOpeningPanel readiness={openingReadiness} /> : null}

      <DisclosureCard
        id="continuidad"
        title={center.sinceLastShift ? 'Desde tu último turno' : 'Continuidad de Supervisión'}
        description={center.sinceLastShift ? `Cambios desde ${formatDateTime(center.sinceLastShift)}.` : 'Cambios y continuidad que sobreviven entre turnos.'}
        defaultOpen
      >
      <Card>
        <CardHeader
          title={center.sinceLastShift ? 'Desde tu último turno' : 'Continuidad de Supervisión'}
          action={center.sinceLastShift ? <span className="text-xs text-slate-500">Desde {formatDateTime(center.sinceLastShift)}</span> : null}
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
          <StatTile label="Novedades nuevas" value={center.changesSinceLastShift.entries} tone={center.changesSinceLastShift.entries ? 'neutral' : 'good'} />
          <StatTile label="Cambios en mis tareas" value={center.changesSinceLastShift.myTaskUpdates} tone="neutral" />
          <StatTile label="Cambios en seguimientos" value={center.changesSinceLastShift.myFollowUpUpdates} tone="neutral" />
          <StatTile label="Arqueos registrados" value={center.changesSinceLastShift.cashAudits} tone="neutral" />
          <StatTile label="Entregas de Recepción" value={center.changesSinceLastShift.handovers} tone="neutral" />
          <StatTile label="Inventarios de llaves" value={center.changesSinceLastShift.keyInventories} tone="neutral" />
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Tus tareas y seguimientos no se reinician con el turno: esta franja sólo resume qué cambió mientras no estabas ejerciendo Supervisión.
        </p>
      </Card>
      </DisclosureCard>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile label="Alertas críticas" value={critical} tone={critical ? 'alert' : 'good'} />
        <StatTile label="Mis pendientes" value={continuityOpen} tone={continuityOpen ? 'neutral' : 'good'} />
        <StatTile label="Cierres por validar" value={pendingClosures} tone={pendingClosures ? 'alert' : 'good'} />
        <StatTile label="Señales del Libro" value={review.total} tone={review.total ? 'alert' : 'good'} />
        <StatTile label="Auditorías abiertas" value={center.counts.auditsOpen} tone={center.counts.auditsOpen ? 'alert' : 'good'} />
        <StatTile label="Confirmaciones pendientes" value={announcementPending} tone={announcementPending ? 'alert' : 'good'} />
      </div>

      <Card>
        <CardHeader title="Accesos rápidos" />
        <div className="flex flex-wrap gap-2 px-4 py-3 no-print">
          {canAssignTasks ? <Dialog title="Asignar tarea" trigger="Asignar tarea" triggerVariant="gold" width="lg">
            <TaskForm action={createTaskAction} options={options} defaultAssigneeId={user.id} />
          </Dialog> : null}
          {isSupervisor ? <NewSupervisionNoteDialog /> : null}
          {isSupervisor ? <Link href="/supervision/auditorias" className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">Iniciar auditoría sorpresa</Link> : null}
        </div>
      </Card>

      <SupervisionAuditDashboard
        rows={center.auditImports}
        defaultBusinessDate={center.businessDateKey}
        canUpload={
          isSupervisor &&
          Boolean(center.currentShift) &&
          center.currentShift?.status !== 'ENTREGADO' &&
          hasPermission(user, 'supervision.audit.create')
        }
        canManage={
          isSupervisor &&
          center.currentShift?.status === 'ACTIVO' &&
          hasPermission(user, 'supervision.audit.create')
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DisclosureCard id="pendientes" title="Asignado a mí" count={tasks.length} defaultOpen={requestedSection === 'pendientes'}>
        <Card className="flex h-[30rem] flex-col overflow-hidden">

          {tasks.length === 0 ? <EmptyState message="No tienes tareas asignadas con estos filtros." /> : (
            <CardScroll className="flex-1" maxHeight="max-h-none">
              <ul className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <li key={task.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
                      <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
                    </div>
                    <Link href={`/tareas/${task.id}`} className="mt-1 block font-medium text-petrol-900 hover:underline">#{task.humanId} · {task.title}</Link>
                    <p className="text-xs text-slate-500">{task.assignee?.name ?? 'Sin responsable'}{task.dueAt ? ` · vence ${formatDateTime(task.dueAt)}` : ''}</p>
                  </li>
                ))}
              </ul>
            </CardScroll>
          )}
        </Card>
        </DisclosureCard>

        <DisclosureCard id="seguimientos" title="En seguimiento" count={followUps.length} defaultOpen={requestedSection === 'seguimientos'}>
        <Card className="flex h-[30rem] flex-col overflow-hidden">

          {followUps.length === 0 ? <EmptyState message="No estás siguiendo asuntos con estos filtros." /> : (
            <CardScroll className="flex-1" maxHeight="max-h-none">
              <ul className="divide-y divide-slate-100">
                {followUps.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex flex-wrap gap-2"><Badge tone={item.status === 'VENCIDO' ? 'critico' : 'pendiente'}>{item.status === 'VENCIDO' ? 'Vencido' : 'Pendiente'}</Badge><Chip>{item.visibility.toLocaleLowerCase('es-CL')}</Chip></div>
                    <p className="mt-1 font-medium text-petrol-900">{item.action}</p>
                    <p className="text-xs text-slate-500">{item.owner.name}{item.scheduledAt ? ` · revisión ${formatDateTime(item.scheduledAt)}` : ''}</p>
                    <div className="mt-2 no-print">
                      {item.sourceEntity && item.sourceId && item.origin?.startsWith('SUPERVISION_') ? (
                        <StopFollowingSupervisionForm followUpId={item.id} />
                      ) : (
                        <CloseFollowUpDialog followUpId={item.id} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardScroll>
          )}
        </Card>
        </DisclosureCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex h-[26rem] flex-col overflow-hidden">
          <CardHeader title="Notas recientes" count={notes.length} action={isSupervisor ? <NewSupervisionNoteDialog /> : null} />
          {notes.length === 0 ? <EmptyState message="Sin notas visibles." /> : (
            <CardScroll className="flex-1" maxHeight="max-h-none"><ul className="divide-y divide-slate-100">{notes.map((note) => <li key={note.id} className="px-4 py-3"><div className="flex items-start justify-between gap-2"><Chip>{note.visibility === 'PRIVADO' ? 'Privada' : note.visibility === 'SUPERVISION' ? 'Supervisión' : 'Operativa'}</Chip>{isSupervisor && note.author.id === user.id ? <DeleteSupervisionNoteDialog noteId={note.id} /> : null}</div><p className="mt-1 font-medium text-petrol-900">{note.title}</p><p className="line-clamp-3 text-sm text-slate-600">{note.body}</p><p className="mt-1 text-xs text-slate-500">{note.author.name} · {formatDateTime(note.createdAt)}</p></li>)}</ul></CardScroll>
          )}
        </Card>
        <Card className="flex h-[26rem] flex-col overflow-hidden">
          <CardHeader
            title="Auditorías abiertas"
            count={center.counts.auditsOpen}
            action={<Link href="/supervision/auditorias" className="text-xs font-medium text-petrol-600 hover:underline">Abrir módulo</Link>}
          />
          {audits.length === 0 ? <EmptyState message="No hay auditorías abiertas." /> : <CardScroll className="flex-1" maxHeight="max-h-none"><ul className="divide-y divide-slate-100">{audits.map((audit) => <li key={audit.id} className="flex items-start justify-between gap-3 px-4 py-3"><div className="min-w-0"><Badge tone={audit.status === 'PREPARACION' ? 'pendiente' : 'curso'}>{audit.status === 'PREPARACION' ? 'Preparación reservada' : 'En curso'}</Badge><p className="mt-1 font-medium text-petrol-900">#{audit.humanId} · {audit.templateName}</p><p className="text-xs text-slate-500">{audit.runBy.name} · {audit._count.findings} hallazgo(s)</p></div><Link href={`/supervision/auditorias?q=${audit.humanId}`} className="shrink-0 text-xs font-semibold text-petrol-700 hover:underline">Gestionar</Link></li>)}</ul></CardScroll>}
        </Card>
        <Card className="flex h-[26rem] flex-col overflow-hidden">
          <CardHeader
            title="Medidas correctivas"
            count={center.counts.measuresOpen}
            action={center.counts.measuresOpen > measures.length ? <span className="text-xs text-slate-500">Muestra visible: {measures.length}</span> : null}
          />
          {measures.length === 0 ? <EmptyState message="No hay medidas correctivas pendientes." /> : <CardScroll className="flex-1" maxHeight="max-h-none"><ul className="divide-y divide-slate-100">{measures.map((measure) => <li key={measure.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div className="min-w-0"><Badge tone={measure.status === 'BLOQUEADA' ? 'critico' : measure.status === 'REALIZADA' ? 'curso' : 'atencion'}>{measure.status.toLocaleLowerCase('es-CL')}</Badge><p className="mt-1 font-medium text-petrol-900">{measure.title}</p><p className="text-xs text-slate-500">{measure.assignee.name}{measure.dueAt ? ` · vence ${formatDateTime(measure.dueAt)}` : ''}</p></div><div className="flex shrink-0 flex-wrap gap-2 no-print">{measure.taskId ? <Link href={`/tareas/${measure.taskId}`} className="text-xs font-semibold text-petrol-700 hover:underline">Gestionar tarea</Link> : null}{isSupervisor && measure.status === 'REALIZADA' ? <ValidateCorrectiveMeasureDialog measureId={measure.id} /> : null}</div></li>)}</ul></CardScroll>}
        </Card>
      </div>

      {canAnnounce ? (
        <Card>
          <CardHeader title="Comunicados obligatorios" count={announcements.filter((announcement) => announcement.active).length} action={<NewAnnouncementDialog users={operationalUsers.map((item) => ({ value: item.id, label: `${item.name} · ${item.role.name}` }))} />} />
          {announcements.length === 0 ? <EmptyState message="Sin comunicados obligatorios." /> : <CardScroll><ul className="divide-y divide-slate-100">{announcements.map((announcement) => <li key={announcement.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div><div className="flex flex-wrap gap-2"><p className="font-medium text-petrol-900">{announcement.title}</p><Badge tone={announcement.confirmed >= announcement.expected ? 'resuelto' : 'pendiente'}>{announcement.confirmed} de {announcement.expected} confirmado(s)</Badge></div><p className="mt-1 text-sm text-slate-600">{announcement.body}</p></div>{announcement.active ? <CloseAnnouncementDialog announcementId={announcement.id} /> : null}</li>)}</ul></CardScroll>}
        </Card>
      ) : null}

      {performance.length > 0 ? (
        <Card>
          <CardHeader title="Resumen objetivo del rendimiento operativo" count={performance.length} action={<Link href="/supervision/rendimiento" className="text-xs font-medium text-petrol-600 hover:underline">Ver fuentes y contexto</Link>} />
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {performance.map((row) => {
              const completion = row.indicators.find((indicator) => indicator.key === 'task-completion');
              const procedures = row.indicators.find((indicator) => indicator.key === 'procedures');
              return <div key={row.user.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-petrol-600" aria-hidden="true" /><p className="font-medium text-petrol-900">{row.user.name}</p></div><p className="mt-1 text-xs text-slate-500">{row.context.shiftsWorked} turno(s) · {row.context.assignedTasks} tarea(s) · {row.context.auditedPoints} punto(s) auditado(s)</p><div className="mt-2 flex flex-wrap gap-2"><Chip>Tareas: {completion?.value === null || completion?.value === undefined ? 'sin base' : `${completion.value}%`}</Chip><Chip>Procedimientos: {procedures?.value === null || procedures?.value === undefined ? 'sin base' : `${procedures.value}%`}</Chip></div></div>;
            })}
          </div>
        </Card>
      ) : null}

      {blocks.length > 0 ? (
        <DisclosureCard
          id="detalle-senales"
          title="Requiere atención · señales del Libro"
          description="Señales verificables para seguimiento, sin duplicar la operación."
          count={blocks.length}
          defaultOpen={requestedSection === 'senales'||!!exception}
        >
          <div className="grid gap-4 p-4 lg:grid-cols-2">{blocks.map((block) => <ReviewBlock
            key={block.key}
            block={block}
            canFollow={canFollow}
            followedSourceKeys={followedSourceKeys}
          />)}</div>
        </DisclosureCard>
      ) : null}

      <p className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <NotebookPen className="h-4 w-4" aria-hidden="true" />
        Supervisión no duplica la operación: «Seguir» sólo mantiene un asunto en tu radar. Cuando la fuente se resuelve, ese seguimiento técnico se cierra con ella.
      </p>
    </div>
  );
}
