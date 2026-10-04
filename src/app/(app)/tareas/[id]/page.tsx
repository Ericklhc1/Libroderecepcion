import { taskFollowUpReadWhere } from '@/server/services/followup-access';
import Link from 'next/link';
import { SubjectActions, SubjectContext } from '@/components/operational/subject-surface';
import { nextWorkAction } from '@/domain/coordination';
import { notFound } from 'next/navigation';
import { OperationalAlarmStatus, TaskStatus } from '@prisma/client';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { getTask } from '@/server/services/tasks';
import { getHistory } from '@/server/services/history';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Comments } from '@/components/operational/comments';
import { HistoryTimeline } from '@/components/operational/history-timeline';
import {
  AlarmKindIcon,
  LinkedAlertPrompt,
  OperationalAlarmCreateForm,
  OperationalAlertEditDialog,
  OperationalAlertRecipientActions,
} from '@/components/operational/operational-alarm-form';
import { cancelOperationalAlarmAction } from '@/server/actions/operational-alarms';
import { listAlarmCandidates } from '@/server/services/operational-alarms';
import {
  AssignTaskDialog,
  ChecklistToggleForm,
  DeleteTaskDialog,
  EditTaskDialog,
  QuickStatusForm,
  RestoreTaskForm,
  TaskStatusDialog,
} from '@/components/operational/task-actions';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_OPEN_STATUSES,
  TASK_ORIGIN_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  isOverdue,
} from '@/domain/labels';
import { formatDateTime, relativeTime, toDateTimeInput } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;

  const task = await getTask(id).catch(() => null);
  if (!task || !await prisma.task.count({where:{id:task.id,AND:[taskFollowUpReadWhere(user)]}})) notFound();

  const [history, options, linkedAlerts, alertCandidates] = await Promise.all([
    getHistory({ entity: 'Task', entityId: task.id }),
    getFormOptions(user),
    prisma.operationalAlarm.findMany({
      where: { sourceEntity: 'Task', sourceId: task.id },
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
  ]);

  const open = TASK_OPEN_STATUSES.includes(task.status);
  const scheduled = Boolean(task.startsAt && task.startsAt > new Date());
  const overdue = isOverdue(task.dueAt, open);
  const doneItems = task.checklist.filter((item) => item.done).length;
  const canChange = user.permissions.includes('task.edit') || task.assigneeId === user.id || task.createdById === user.id;
  const canValidate = user.permissions.includes('supervision.task.validate') && (!task.requiresIndependentValidation || (!!task.completedById && task.completedById !== user.id));
  const assign = user.permissions.includes('task.assign') ? <AssignTaskDialog taskId={task.id} currentAssigneeId={task.assigneeId} users={options.users}/> : null;
  const statusAction = (status: TaskStatus, label: string) => <QuickStatusForm taskId={task.id} status={status} label={label} variant="gold"/>;
  const finish = canChange ? (task.evidenceRequired || task.requiresIndependentValidation || !user.permissions.includes('task.close')
    ? <TaskStatusDialog taskId={task.id} currentStatus={task.status} targetStatus={TaskStatus.REALIZADA} label="Finalizar" variant="gold"/>
    : statusAction(TaskStatus.COMPLETADA, 'Resolver')) : null;
  const primaryAction = !open ? <a href="#historial-asunto" className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white">Ver resultado</a>
    : scheduled ? <p className="text-sm text-slate-600">Disponible desde {formatDateTime(task.startsAt!)}</p>
    : !task.assigneeId && task.status !== TaskStatus.REALIZADA ? (assign ?? (canChange ? task.status === TaskStatus.PENDIENTE ? statusAction(TaskStatus.EN_CURSO,'Comenzar atención') : task.status === TaskStatus.BLOQUEADA ? statusAction(TaskStatus.EN_CURSO,'Resolver impedimento') : finish : null))
    : task.status === TaskStatus.REALIZADA ? (canValidate ? statusAction(TaskStatus.VALIDADA,'Validar') : <p className="text-sm text-slate-600">Pendiente de revisión autorizada</p>)
    : task.status === TaskStatus.BLOQUEADA ? (canChange ? statusAction(TaskStatus.EN_CURSO,'Resolver impedimento') : null)
    : task.status === TaskStatus.PENDIENTE ? (task.assigneeId === user.id ? statusAction(TaskStatus.ACEPTADA,'Confirmar recepción') : assign ?? <p className="text-sm text-slate-600">El responsable debe confirmar la recepción</p>)
    : task.status === TaskStatus.ACEPTADA && !task.evidenceRequired && !task.requiresIndependentValidation && user.permissions.includes('task.close') ? finish
    : ['ACEPTADA','DEVUELTA'].includes(task.status) ? (canChange ? statusAction(TaskStatus.EN_CURSO,'Comenzar atención') : null)
    : finish;
  const secondaryAction = !scheduled && (canChange || canValidate) && open ? (task.status === TaskStatus.REALIZADA
    ? (canValidate ? <TaskStatusDialog taskId={task.id} currentStatus={task.status} targetStatus={TaskStatus.DEVUELTA} label="Devolver"/> : null)
    : canChange && ['ACEPTADA','EN_CURSO','DEVUELTA'].includes(task.status)
      ? <TaskStatusDialog taskId={task.id} currentStatus={task.status} targetStatus={TaskStatus.BLOQUEADA} label="Informar impedimento"/>
      : null) : null;
  const myDueLinkedAlerts = linkedAlerts
    .filter((alert) => alert.status === OperationalAlarmStatus.ACTIVA)
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

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href="/tareas"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a tareas
      </Link>

      {task.deletedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-200 px-4 py-3 text-sm text-slate-700">
          <span className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Tarea eliminada el {formatDateTime(task.deletedAt)}
            {task.deletionReason ? ` · Motivo: ${task.deletionReason}` : ''}
          </span>
          {user.permissions.includes('entry.restore') ? (
            <RestoreTaskForm taskId={task.id} />
          ) : null}
        </div>
      ) : null}

      <Card>
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tabular text-slate-400">#{task.humanId}</span>
            <Badge tone={overdue ? 'critico' : TASK_STATUS_TONE[task.status]}>
              {overdue ? 'Vencida' : TASK_STATUS_LABEL[task.status]}
            </Badge>
            <Badge tone={PRIORITY_TONE[task.priority]} withSymbol={false}>
              Prioridad {PRIORITY_LABEL[task.priority]}
            </Badge>
            {scheduled ? <Chip>Programada</Chip> : null}
            <Chip>Origen: {TASK_ORIGIN_LABEL[task.origin]}</Chip>
          </div>

          <h1 className="mt-2 text-xl font-semibold text-petrol-900">{task.title}</h1>

          {task.description ? (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{task.description}</p>
          ) : null}

          {task.fulfillmentCriteria ? (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium text-petrol-900">Criterio de cumplimiento: </span>
              {task.fulfillmentCriteria}
            </div>
          ) : null}

          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500">Asignada a</dt>
              <dd className="text-petrol-900">{task.assignee?.name ?? 'Sin asignar'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Creada por</dt>
              <dd className="text-petrol-900">
                {task.createdBy.name} · {formatDateTime(task.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Habitación</dt>
              <dd className="text-petrol-900">
                {task.room ? (
                  <Link href={`/novedades/habitacion?habitacion=${task.room.number}`} className="font-medium text-gold-700 hover:underline">
                    {task.room.number}
                  </Link>
                ) : 'Sin habitación'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Área</dt>
              <dd className="text-petrol-900">{task.department?.name ?? 'Sin área'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Inicio</dt>
              <dd className="text-petrol-900">
                {task.startsAt
                  ? `${formatDateTime(task.startsAt)} (${relativeTime(task.startsAt)})`
                  : 'Inmediato'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Fecha límite</dt>
              <dd className={overdue ? 'font-semibold text-red-700' : 'text-petrol-900'}>
                {task.dueAt
                  ? `${formatDateTime(task.dueAt)} (${relativeTime(task.dueAt)})`
                  : 'Sin fecha límite'}
              </dd>
            </div>
            {task.completedAt ? (
              <div>
                <dt className="text-xs font-medium text-slate-500">Completada</dt>
                <dd className="text-petrol-900">{formatDateTime(task.completedAt)}</dd>
              </div>
            ) : null}
            {task.validatedAt ? (
              <div>
                <dt className="text-xs font-medium text-slate-500">Validada</dt>
                <dd className="text-petrol-900">{formatDateTime(task.validatedAt)}</dd>
              </div>
            ) : null}
            {task.entry ? (
              <div>
                <dt className="text-xs font-medium text-slate-500">Registro origen</dt>
                <dd>
                  <Link
                    href={`/libro/${task.entry.id}`}
                    className="font-medium text-petrol-600 hover:underline"
                  >
                    #{task.entry.humanId} · {task.entry.title}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>

          {task.blockedReason ? (
            <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800 ring-1 ring-orange-200">
              Bloqueada: {task.blockedReason}
            </p>
          ) : null}
          {task.evidenceRequired ? (
            <p className="mt-3 text-sm text-slate-700"><span className="font-medium">Evidencia requerida:</span> {task.evidenceRequired}</p>
          ) : null}
          {task.evidenceProvided ? (
            <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Evidencia aportada:</span> {task.evidenceProvided}</p>
          ) : null}
          {task.participants.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {task.participants.map((participant) => (
                <Chip key={participant.id}>{participant.role === 'PRINCIPAL' ? 'Responsable' : 'Colabora'}: {participant.user.name}</Chip>
              ))}
            </div>
          ) : null}

          {task.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <Chip key={tag}>#{tag}</Chip>
              ))}
            </div>
          ) : null}
          <SubjectContext folio={task.entry ? `Asunto #${task.entry.humanId} · Trabajo #${task.humanId}` : `Asunto #${task.humanId}`} origin={task.entry ? task.entry.title : task.createdBy.name} nextAction={nextWorkAction(task.status,task.assigneeId,task.workAcknowledgedAt,task.workNextAction)} impediment={task.blockedReason} result={task.evidenceProvided}/>
        </div>

        {!task.deletedAt ? (
          <SubjectActions primary={primaryAction} secondary={secondaryAction} more={<>

            {user.permissions.includes('task.edit') ? (
              <TaskStatusDialog taskId={task.id} currentStatus={task.status} />
            ) : null}
            {user.permissions.includes('task.assign') ? (
              <AssignTaskDialog
                taskId={task.id}
                currentAssigneeId={task.assigneeId}
                users={options.users}
              />
            ) : null}
            {user.permissions.includes('task.edit') && open ? (
              <EditTaskDialog
                task={{
                  id: task.id,
                  title: task.title,
                  description: task.description ?? '',
                  priority: task.priority,
                  startsAt: toDateTimeInput(task.startsAt),
                  dueAt: toDateTimeInput(task.dueAt),
                  departmentId: task.departmentId,
                  roomId: task.roomId,
                  tags: task.tags,
                  fulfillmentCriteria: task.fulfillmentCriteria ?? '',
                  evidenceRequired: task.evidenceRequired ?? '',
                  evidenceProvided: task.evidenceProvided ?? '',
                }}
                departments={options.departments}
                rooms={options.rooms}
              />
            ) : null}
            <Dialog
              title="Crear alerta para esta tarea"
              description="Programa una llamada de atención vinculada a esta tarea. No cambia su estado."
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
                defaultRoomNumber={task.room?.number ?? undefined}
                source={{
                  entity: 'Task',
                  id: task.id,
                  link: `/tareas/${task.id}`,
                }}
              />
            </Dialog>
            {user.permissions.includes('entry.delete') ? (
              <DeleteTaskDialog taskId={task.id} />
            ) : null}
            <a className="rounded-md px-3 py-2 text-sm font-medium text-petrol-800" href="#historial-asunto">Historial</a>
          </>}/>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Alertas vinculadas" count={linkedAlerts.length} />
        {linkedAlerts.length === 0 ? (
          <EmptyState message="Esta tarea no tiene alertas programadas." />
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
                      {alert.note ? <p className="mt-0.5 text-sm text-slate-600">{alert.note}</p> : null}
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
                            <SubmitButton variant="ghost" size="sm" pendingLabel="Eliminando…">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Checklist"
            count={task.checklist.length}
            action={
              task.checklist.length > 0 ? (
                <span className="text-xs tabular text-slate-500">
                  {doneItems}/{task.checklist.length} listos
                </span>
              ) : null
            }
          />
          {task.checklist.length === 0 ? (
            <EmptyState message="Esta tarea no tiene checklist." />
          ) : (
            <ul className="space-y-1 px-4 py-3">
              {task.checklist.map((item) => (
                <li key={item.id}>
                  {task.deletedAt || !open || scheduled ? (
                    <span
                      className={`flex items-start gap-2 px-1 py-1 text-sm ${
                        item.done ? 'text-slate-400 line-through' : 'text-petrol-900'
                      }`}
                    >
                      <span aria-hidden="true">{item.done ? '✓' : '○'}</span>
                      {item.text}
                    </span>
                  ) : (
                    <ChecklistToggleForm itemId={item.id} done={item.done} text={item.text} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <span id="historial-asunto"/><CardHeader title="Historial" count={history.length} />
          <HistoryTimeline events={history} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Comentarios" count={task._count.comments} />
        <Comments target={{ taskId: task.id }} />
      </Card>

      <LinkedAlertPrompt alerts={myDueLinkedAlerts} />
    </div>
  );
}
