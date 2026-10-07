import { EntryVisibilityDialog } from '@/components/operational/entry-visibility';
import { canManageEntryVisibility } from '@/server/services/entry-visibility';
import {subjectDistributionEnabled} from '@/server/services/subject-distribution-gate';
import {SubjectAttentionDialog} from '@/components/operational/subject-attention-dialog';
import {isSubjectAttentionTask, returnedSubjectTask} from '@/domain/subject-attention';
import { followUpReadWhere, taskFollowUpReadWhere } from '@/server/services/followup-access';
import { getSubjectAttentionAreas } from '@/server/services/subject-attention';
import { randomUUID } from 'node:crypto';
import {SubjectDistributionDialog} from '@/components/operational/subject-distribution-dialog';
import {listAreaAttentions,attentionPeople} from '@/server/services/subject-distribution';
import Link from 'next/link';
import { SubjectActions, SubjectContext } from '@/components/operational/subject-surface';
import { nextWorkAction } from '@/domain/coordination';
import { notFound } from 'next/navigation';
import { EntryStatus, EntryType, FollowUpStatus, OperationalAlarmStatus } from '@prisma/client';
import { CalendarClock, Trash2 } from 'lucide-react';
import { ListReturnLink } from '@/components/operational/list-navigation';
import { detailHrefWithReturnContext, safeListReturnHref } from '@/lib/list-navigation';
import type { RawSearchParams } from '@/lib/search-params';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import { getSubjectEntry } from '@/server/services/entries';
import { getHistory } from '@/server/services/history';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Comments } from '@/components/operational/comments';
import { HistoryTimeline } from '@/components/operational/history-timeline';
import {
  AssignEntryDialog,
  CloseFollowUpDialog,
  DeleteEntryDialog,
  EditEntryDialog,
  EntryStatusForm,
  RestoreEntryForm,
} from '@/components/operational/entry-actions';
import {
  AlarmKindIcon,
  LinkedAlertPrompt,
  OperationalAlarmCreateForm,
  OperationalAlertEditDialog,
  OperationalAlertRecipientActions,
} from '@/components/operational/operational-alarm-form';
import { cancelOperationalAlarmAction } from '@/server/actions/operational-alarms';
import { listAlarmCandidates } from '@/server/services/operational-alarms';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  ENTRY_OPEN_STATUSES,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  ENTRY_TYPE_LABEL,
  FOLLOWUP_STATUS_LABEL,
  FOLLOWUP_STATUS_TONE,
  IMPACT_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  isOverdue,
} from '@/domain/labels';
import { HK_WORK_LABELS } from '@/domain/housekeeping-work';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { SHIFT_TYPE_LABEL } from '@/domain/shift';
import { formatCalendarDate, formatDateTime, relativeTime, toDateTimeInput } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EntryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const returnContext = (await searchParams).desdeLista;
  const returnHref = safeListReturnHref(returnContext, '/libro');

  const entry = await getSubjectEntry(user,id).catch(() => null);
  if (!entry) notFound();

  const [followUps, tasks, linkedAlerts, alertCandidates, history, options] = await Promise.all([
    prisma.followUp.findMany({
      where: {
        entryId: entry.id,
        deletedAt: null,
        AND:[followUpReadWhere(user)],
        OR: [
          { origin: null },
          { origin: { not: { startsWith: 'SUPERVISION_' } } },
        ],
      },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.task.findMany({
      where: { entryId: entry.id, deletedAt: null, AND:[taskFollowUpReadWhere(user)] },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.operationalAlarm.findMany({
      where: {
        sourceEntity: 'OperationalEntry',
        sourceId: entry.id,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        recipients: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    }),
    listAlarmCandidates(),
    getHistory({ entity: 'OperationalEntry', entityId: entry.id },user),
    getFormOptions(user),
  ]);

  const isIncident = entry.type === EntryType.INCIDENCIA;
  const canAttend = Boolean(entry.ownerId) && (user.permissions.includes('entry.edit') || entry.ownerId === user.id || entry.createdById === user.id);
  const canFinish = (user.permissions.includes('entry.edit') || entry.ownerId === user.id || entry.createdById === user.id) && (user.permissions.includes('entry.close') || (entry.type === EntryType.INCIDENCIA && user.permissions.includes('incident.close')));
  const activeHk = entry.housekeepingRequests.find(work=>!work.isDemo&&!['RESUELTO','CANCELADO'].includes(work.status))??null;
  const activeWork = tasks.find(t => !['VALIDADA','COMPLETADA','CANCELADA'].includes(t.status));
  const activeAttentionTask = tasks.find(t => !t.isDemo && !['VALIDADA','COMPLETADA','CANCELADA'].includes(t.status) && isSubjectAttentionTask(t.procedureOccurrenceKey)) ?? tasks.find(t => !t.isDemo && !['VALIDADA','COMPLETADA','CANCELADA'].includes(t.status) && t.entryId===entry.id && Boolean(t.departmentId));
  const returnedTask=returnedSubjectTask(tasks,entry.reopenedAt);
  const returnedHk=entry.housekeepingRequests.find(work=>!work.isDemo&&work.status==='RESUELTO'&&(!entry.reopenedAt||!!work.resolvedAt&&work.resolvedAt>=entry.reopenedAt))??null;
  const latestReturned=[
    returnedTask&&returnedTask.completedAt?{at:returnedTask.completedAt,result:returnedTask.evidenceProvided}:null,
    returnedHk&&returnedHk.resolvedAt?{at:returnedHk.resolvedAt,result:returnedHk.resolution}:null,
  ].filter((item):item is {at:Date;result:string|null}=>Boolean(item)).sort((a,b)=>b.at.getTime()-a.at.getTime())[0];
  const returnedWork=Boolean(latestReturned);
  const completedLinkedWork=tasks.some(t=>!t.isDemo&&['VALIDADA','COMPLETADA'].includes(t.status)&&(!entry.reopenedAt||!!t.completedAt&&t.completedAt>=entry.reopenedAt));
  const open = ENTRY_OPEN_STATUSES.includes(entry.status);
  const areaResult=latestReturned?.result??null;
  const receivedResult=open?(returnedWork?areaResult:entry.resolution):(entry.resolution??areaResult);
  const overdue = isOverdue(entry.dueAt, open);
  const pageOpenedAt = new Date();
  const myDueLinkedAlerts = linkedAlerts
    .filter(
      (alert) =>
        alert.status === OperationalAlarmStatus.ACTIVA &&
        alert.dueAt <= pageOpenedAt,
    )
    .flatMap((alert) => {
      const recipient = alert.recipients.find(
        (item) => item.userId === user.id && !item.acknowledgedAt,
      );
      return recipient
        ? [{
            id: alert.id,
            recipientId: recipient.id,
            title: alert.title,
            note: alert.note,
            dueAt: alert.dueAt.toISOString(),
          }]
        : [];
    });

  const distributionEnabled=subjectDistributionEnabled();
  const attentionAreas = await Promise.all((await getSubjectAttentionAreas(user)).map(async area=>({...area,people:distributionEnabled?await attentionPeople(area.value):[]})));
  const areaAttention=await listAreaAttentions(user,{entryId:entry.id});
  const awaitingAreaReview=areaAttention.rows.filter(r=>['POR_REVISAR','ACLARACION'].includes(r.status));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <ListReturnLink href={returnHref} scope={user.id} />

      {entry.deletedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-200 px-4 py-3 text-sm text-slate-700">
          <span className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Registro eliminado el {formatDateTime(entry.deletedAt)}
            {entry.deletionReason ? ` · Motivo: ${entry.deletionReason}` : ''}
          </span>
          {user.permissions.includes('entry.restore') ? (
            <RestoreEntryForm entryId={entry.id} />
          ) : null}
        </div>
      ) : null}

      <Card>
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tabular text-slate-400">#{entry.humanId}</span>
            <Chip>{ENTRY_TYPE_LABEL[entry.type]}</Chip>
            <Badge tone={ENTRY_STATUS_TONE[entry.status]}>
              {ENTRY_STATUS_LABEL[entry.status]}
            </Badge>
            <Badge tone={PRIORITY_TONE[entry.priority]} withSymbol={false}>
              Importancia {PRIORITY_LABEL[entry.priority]}
            </Badge>
            {entry.severity ? (
              <Badge tone={SEVERITY_TONE[entry.severity]}>
                Gravedad {SEVERITY_LABEL[entry.severity]}
              </Badge>
            ) : null}
            {overdue ? <Badge tone="critico">Vencido</Badge> : null}
            {entry.requiresFollowUp ? <Chip>Con seguimiento</Chip> : null}
          </div>

          <h1 className="mt-2 text-xl font-semibold text-petrol-900">{entry.title}</h1>

          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500">Registró</dt>
              <dd className="text-petrol-900">
                {entry.createdBy.name} · {formatDateTime(entry.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Responsable</dt>
              <dd className="text-petrol-900">{entry.owner?.name ?? 'Sin asignar'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Habitación</dt>
              <dd className="text-petrol-900">
                {entry.room ? (
                  <Link href={`/novedades/habitacion?habitacion=${entry.room.number}`} className="font-medium text-gold-700 hover:underline">
                    {entry.room.number}
                  </Link>
                ) : 'Sin habitación'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Área</dt>
              <dd className="text-petrol-900">{entry.department?.name ?? 'Sin área'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Fecha del hecho</dt>
              <dd className="text-petrol-900">{formatDateTime(entry.occurredAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Turno</dt>
              <dd className="text-petrol-900">
                {entry.shift
                  ? `${SHIFT_TYPE_LABEL[entry.shift.type]} · ${formatCalendarDate(entry.shift.date)}`
                  : 'Sin turno'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Vencimiento</dt>
              <dd className={overdue ? 'font-semibold text-red-700' : 'text-petrol-900'}>
                {entry.dueAt
                  ? `${formatDateTime(entry.dueAt)} (${relativeTime(entry.dueAt)})`
                  : 'Sin vencimiento'}
              </dd>
            </div>
          </dl>

          {entry.housekeepingRequests.map(work=><div id={`atencion-area-${work.humanId}`} key={work.humanId} className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-petrol-900"><strong>Housekeeping #{work.humanId} · {HK_WORK_LABELS[work.status]??work.status}</strong>{work.resolution&&<p className="mt-1 whitespace-pre-wrap">{work.resolution}</p>}{work.inspectedBy&&<p className="text-xs">Revisado por {work.inspectedBy.name}</p>}{canAccessHousekeeping(user)&&<Link className="block underline" href={`/housekeeping?area=${work.departmentId??''}&aviso=${work.humanId}`}>Ver atención especializada</Link>}</div>)}
          <section id="distribucion-areas" className="mt-4 space-y-2"><h2 className="text-sm font-semibold">Avance por área</h2>{areaAttention.rows.length?areaAttention.rows.map(row=><div key={row.id} className="rounded-lg border border-slate-200 p-3 text-sm"><Link className="font-medium underline" href={`/coordinacion/areas?atencion=${row.id}`}>{row.department.name}</Link> · {row.status==='POR_REVISAR'?'Por revisar por jefatura':row.status==='ACLARACION'?'Aclaración pendiente':row.status==='INFORMADA'?'Información publicada':'Trabajo asignado'} · {row.urgent?'Urgente':'Revisión normal'}<p>{row.task?`${TASK_STATUS_LABEL[row.task.status]} · ${row.task.assignee?.name??'Por asignar'}`:row.housekeeping?`${HK_WORK_LABELS[row.housekeeping.status]} · ${row.housekeeping.assignedTo?.name??'Por asignar'}`:row.knownAt?'Jefatura tomó conocimiento; decisión separada':'Sin conocimiento registrado'}</p>{row.decisionNote&&<p className="whitespace-pre-wrap">{row.decisionNote}</p>}{(row.task?.evidenceProvided||row.housekeeping?.resolution)&&<p className="whitespace-pre-wrap">Resultado: {row.task?.evidenceProvided||row.housekeeping?.resolution}</p>}</div>):<p className="text-xs text-slate-600">Sin distribución interna por áreas registrada. Los trabajos históricos conservan sus vínculos.</p>}<p className="text-xs text-slate-600">Ningún resultado parcial cierra automáticamente el asunto. Revisa todas las intervenciones y seguimientos pendientes.</p></section>
          {entry.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <Chip key={tag}>#{tag}</Chip>
              ))}
            </div>
          ) : null}
          <span id="resultado-asunto"/><SubjectContext folio={`Asunto #${entry.humanId}`} origin={entry.createdBy.name} nextAction={awaitingAreaReview.length ? `Revisar ${awaitingAreaReview.length} área(s) pendientes en Avance por área` : activeHk ? `Housekeeping #${activeHk.humanId}: ${HK_WORK_LABELS[activeHk.status] ?? activeHk.status}` : activeWork ? `Continuar atención en el trabajo #${activeWork.humanId}` : (returnedWork||completedLinkedWork) && open ? 'Revisar resultados y seguimientos antes de resolver o cerrar el asunto' : nextWorkAction(entry.status,entry.ownerId,entry.workAcknowledgedAt,entry.workNextAction)} result={receivedResult} resultLabel={open&&!returnedWork||activeWork||activeHk?"Último intento histórico":open?"Resultado recibido":"Resultado"}/>

        </div>

        {!entry.deletedAt ? (
          <SubjectActions primary={
            awaitingAreaReview.length ? <Link className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white" href={`/coordinacion/areas?atencion=${awaitingAreaReview[0]!.id}`}>Ver revisión del área</Link> : activeHk ? <Link className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white" href={canAccessHousekeeping(user) ? `/housekeeping?area=${activeHk.departmentId??''}&aviso=${activeHk.humanId}` : `#atencion-area-${activeHk.humanId}`}>Ver atención del área</Link>
            : activeAttentionTask ? <Link className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white" href={detailHrefWithReturnContext(`/tareas/${activeAttentionTask.id}`, returnContext)}>Continuar atención</Link>
            : !ENTRY_OPEN_STATUSES.includes(entry.status) ? <a href={receivedResult ? "#resultado-asunto" : "#historial-asunto"} className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white">{receivedResult ? "Ver resultado" : "Ver historial"}</a>
            : returnedWork ? (canFinish ? <Dialog title="Revisar y cerrar el asunto" trigger="Revisar y cerrar" triggerVariant="gold" width="sm" description="El resultado del área está incluido. Confirma cómo quedó el asunto; sus controles y seguimientos se mantienen."><EntryStatusForm entryId={entry.id} currentStatus={entry.status} type={entry.type} resolution={receivedResult??null} rootCause={entry.rootCause} targetStatus={EntryStatus.CERRADO} label="Revisar y cerrar"/></Dialog> : <a href="#resultado-asunto" className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white">Ver resultado recibido</a>)

            : open && attentionAreas.length > 0 ? (distributionEnabled?<SubjectDistributionDialog entryId={entry.id} revision={entry.updatedAt.toISOString()} requestKey={randomUUID()} areas={attentionAreas} room={entry.room?.number??null}/>:<SubjectAttentionDialog entryId={entry.id} revision={entry.updatedAt.toISOString()} requestKey={randomUUID()} areas={attentionAreas} room={entry.room?.number??null}/>)
            : !entry.ownerId && user.permissions.includes('entry.edit') ? <AssignEntryDialog entryId={entry.id} departmentId={entry.departmentId} ownerId={entry.ownerId} departments={options.departments} users={options.users}/>
            : canAttend && (entry.status !== EntryStatus.EN_CURSO || canFinish) ? <Dialog title={entry.status === EntryStatus.EN_CURSO ? 'Finalizar asunto' : 'Comenzar atención'} trigger={entry.status === EntryStatus.EN_CURSO ? 'Finalizar' : 'Comenzar atención'} triggerVariant="gold" triggerSize="sm" width="sm"><EntryStatusForm entryId={entry.id} currentStatus={entry.status} type={entry.type} resolution={entry.resolution} rootCause={entry.rootCause} targetStatus={entry.status === EntryStatus.EN_CURSO ? EntryStatus.CERRADO : EntryStatus.EN_CURSO} label={entry.status === EntryStatus.EN_CURSO ? 'Finalizar' : 'Comenzar atención'}/></Dialog>
            : <a href="#historial-asunto" className="rounded-md px-3 py-2 text-sm font-semibold">Ver resultado e historial</a>
          } more={<>
            {canManageEntryVisibility(user, entry.createdById) ? <EntryVisibilityDialog entryId={entry.id} revision={entry.updatedAt.toISOString()} departments={options.departments} hiddenAreas={entry.hiddenFromDepartments.map(d=>({value:d.id,label:d.active?d.name:`${d.name} (desactivada)`}))} hiddenDepartmentIds={entry.hiddenFromDepartments.map(d => d.id)} includeInHandover={entry.includeInReceptionHandover} /> : null}

            {user.permissions.includes('entry.content.edit') ? (
              <EditEntryDialog
                entry={{
                  id: entry.id,
                  title: entry.title,
                  description: entry.description,
                  dueAt: toDateTimeInput(entry.dueAt),
                  departmentId: entry.departmentId,
                  roomId: entry.roomId,
                  ownerId: entry.ownerId,
                  priority: entry.priority,
                  tags: entry.tags,
                }}
                departments={options.departments}
                users={options.users}
                rooms={options.rooms}
              />
            ) : null}

            {user.permissions.includes('entry.edit') ? (
              <Dialog
                title="Cambiar estado"
                triggerVariant="secondary"
                triggerSize="sm"
                width="sm"
                trigger="Cambiar estado"
              >
                <EntryStatusForm
                  entryId={entry.id}
                  currentStatus={entry.status}
                  type={entry.type}
                  resolution={entry.resolution}
                  rootCause={entry.rootCause}
                />
              </Dialog>
            ) : null}


            <Dialog
              title="Crear alerta para este asunto"
              description="Programa una llamada de atención. No crea otra novedad ni cambia el estado de este registro."
              triggerVariant="secondary"
              triggerSize="sm"
              trigger="Recordarme"
            >
              <OperationalAlarmCreateForm
                currentUserId={user.id}
                candidates={alertCandidates.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  username: candidate.username,
                  roleName: candidate.role.name,
                }))}
                defaultRoomNumber={entry.room?.number ?? undefined}
                source={{
                  entity: 'OperationalEntry',
                  id: entry.id,
                  link: `/libro/${entry.id}`,
                }}
              />
            </Dialog>

            {user.permissions.includes('entry.delete') ? (
              <DeleteEntryDialog entryId={entry.id} label="Eliminar" />
            ) : null}
            <a className="rounded-md px-3 py-2 text-sm font-medium text-petrol-800" href="#historial-asunto">Historial</a>
          </>}/>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Descripción" />
            <div className="space-y-4 px-4 py-4">
              <p className="whitespace-pre-line text-sm text-slate-700">{entry.description}</p>

              {isIncident ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Impacto</p>
                    <p className="text-sm text-petrol-900">
                      {entry.impact ? IMPACT_LABEL[entry.impact] : 'No registrado'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Acción inmediata
                    </p>
                    <p className="whitespace-pre-line text-sm text-petrol-900">
                      {entry.immediateAction ?? 'No registrada'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Causa</p>
                    <p className="whitespace-pre-line text-sm text-petrol-900">
                      {entry.rootCause ?? 'Por determinar'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">{open ? 'Último intento histórico' : 'Resolución'}</p>
                    <p className="whitespace-pre-line text-sm text-petrol-900">
                      {entry.resolution ?? 'Pendiente'}
                    </p>
                  </div>
                </div>
              ) : entry.resolution ? (
                <div>
                  <p className="text-xs font-medium text-slate-500">{open ? 'Último intento histórico' : 'Resolución'}</p>
                  <p className="whitespace-pre-line text-sm text-petrol-900">{entry.resolution}</p>
                </div>
              ) : null}

              {entry.closedAt ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
                  Cerrado el {formatDateTime(entry.closedAt)}
                  {entry.closedBy ? ` por ${entry.closedBy.name}` : ''}
                  {entry.reopenedAt ? ` · reabierto el ${formatDateTime(entry.reopenedAt)}` : ''}
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Seguimientos operativos previos" count={followUps.length} />
            {followUps.length === 0 ? (
              <EmptyState message="Este asunto no tiene seguimiento activo o histórico." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {followUps.map((followUp) => (
                  <li key={followUp.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={FOLLOWUP_STATUS_TONE[followUp.status]}>
                        {FOLLOWUP_STATUS_LABEL[followUp.status]}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {followUp.owner.name} · {formatDateTime(followUp.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-petrol-900">{followUp.action}</p>
                    {followUp.result ? (
                      <p className="mt-0.5 text-sm text-slate-700">
                        <span className="text-xs font-medium text-slate-500">Resultado: </span>
                        {followUp.result}
                      </p>
                    ) : null}
                    {followUp.nextAction ? (
                      <p className="mt-0.5 text-sm text-slate-700">
                        <span className="text-xs font-medium text-slate-500">Próxima acción: </span>
                        {followUp.nextAction}
                      </p>
                    ) : null}
                    {followUp.scheduledAt ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Programado para {formatDateTime(followUp.scheduledAt)} (
                        {relativeTime(followUp.scheduledAt)})
                      </p>
                    ) : null}
                    {followUp.status === FollowUpStatus.PENDIENTE ||
                    followUp.status === FollowUpStatus.VENCIDO ? (
                      <div className="mt-2 no-print">
                        <CloseFollowUpDialog followUpId={followUp.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Alertas vinculadas" count={linkedAlerts.length} />
            {linkedAlerts.length === 0 ? (
              <EmptyState message="Este asunto no tiene alertas programadas." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {linkedAlerts.map((alert) => {
                  const myRecipient = alert.recipients.find((item) => item.userId === user.id);
                  const active = alert.status === OperationalAlarmStatus.ACTIVA;
                  const canEdit =
                    alert.createdById === user.id ||
                    user.permissions.includes('shift.manage') ||
                    user.isSystemAdmin;
                  return (
                    <li key={alert.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="mt-0.5 rounded-lg bg-gold-50 p-2 text-gold-700">
                          <AlarmKindIcon kind={alert.kind} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-petrol-900">{alert.title}</p>
                            <Badge tone={active ? 'pendiente' : 'neutro'}>
                              {active
                                ? 'Activa'
                                : alert.status === OperationalAlarmStatus.CANCELADA
                                  ? 'Eliminada'
                                  : 'Atendida'}
                            </Badge>
                          </div>
                          {alert.note ? (
                            <p className="mt-0.5 text-sm text-slate-600">{alert.note}</p>
                          ) : null}
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDateTime(alert.dueAt)} · creada por {alert.createdBy.name}
                            {alert.repeatMinutes ? ` · repite cada ${alert.repeatMinutes} min` : ''}
                          </p>
                        </div>
                        {active ? (
                          <div className="flex flex-wrap gap-1.5 no-print">
                            {myRecipient && !myRecipient.acknowledgedAt ? (
                              <OperationalAlertRecipientActions recipientId={myRecipient.id} />
                            ) : null}
                            {canEdit && alert.kind !== 'TIMER' ? (
                              <OperationalAlertEditDialog
                                alert={{
                                  id: alert.id,
                                  title: alert.title,
                                  note: alert.note,
                                  dueAtLocal: toDateTimeInput(alert.dueAt),
                                  repeatMinutes: alert.repeatMinutes,
                                }}
                              />
                            ) : null}
                            {canEdit ? (
                              <ActionForm
                                action={cancelOperationalAlarmAction}
                                hideSuccess
                                refreshOnSuccess
                                className="space-y-0"
                              >
                                <input type="hidden" name="alarmId" value={alert.id} />
                                <SubmitButton
                                  variant="ghost"
                                  size="sm"
                                  pendingLabel="Eliminando…"
                                >
                                  Eliminar
                                </SubmitButton>
                              </ActionForm>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Tareas asignadas" count={tasks.length} />
            {tasks.length === 0 ? (
              <EmptyState message="No se asignaron tareas desde este asunto." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link href={detailHrefWithReturnContext(`/tareas/${task.id}`, returnContext)} className="block px-4 py-3 hover:bg-slate-50">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs tabular text-slate-400">#{task.humanId}</span>
                        <Badge tone={TASK_STATUS_TONE[task.status]}>
                          {TASK_STATUS_LABEL[task.status]}
                        </Badge>
                        <Badge tone={PRIORITY_TONE[task.priority]} withSymbol={false}>
                          {PRIORITY_LABEL[task.priority]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm font-medium text-petrol-900">{task.title}</p>
                      {task.completedAt && <p className="mt-2 text-sm text-petrol-900">{['VALIDADA','COMPLETADA'].includes(task.status)?'Resultado recibido':task.status === 'REALIZADA'?'Resultado por revisar':'Último intento histórico'} · {TASK_STATUS_LABEL[task.status]} · {formatDateTime(task.completedAt)}</p>}
                      {task.evidenceProvided && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-700">{task.evidenceProvided}</p>}
                      <p className="mt-0.5 text-xs text-slate-500">
                        {task.assignee?.name ?? 'Sin asignar'}
                        {task.dueAt ? ` · vence ${relativeTime(task.dueAt)}` : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Comentarios" count={entry._count.comments} />
            <Comments target={{ entryId: entry.id }} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <span id="historial-asunto"/><CardHeader title="Historial" count={history.length} />
            <HistoryTimeline events={history} />
          </Card>

          <p className="flex items-center gap-2 px-1 text-xs text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Última actualización {formatDateTime(entry.updatedAt)}
          </p>
        </div>
      </div>

      <LinkedAlertPrompt alerts={myDueLinkedAlerts} />
    </div>
  );
}
