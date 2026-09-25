import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskStatus } from '@prisma/client';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getTask } from '@/server/services/tasks';
import { getHistory } from '@/server/services/history';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Comments } from '@/components/operational/comments';
import { HistoryTimeline } from '@/components/operational/history-timeline';
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
  if (!task) notFound();

  const [history, options] = await Promise.all([
    getHistory({ entity: 'Task', entityId: task.id }),
    getFormOptions(),
  ]);

  const open = TASK_OPEN_STATUSES.includes(task.status);
  const overdue = isOverdue(task.dueAt, open);
  const doneItems = task.checklist.filter((item) => item.done).length;

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
            <span className="text-sm font-semibold tabular text-slate-400">T#{task.seq}</span>
            <Badge tone={overdue ? 'critico' : TASK_STATUS_TONE[task.status]}>
              {overdue ? 'Vencida' : TASK_STATUS_LABEL[task.status]}
            </Badge>
            <Badge tone={PRIORITY_TONE[task.priority]} withSymbol={false}>
              Prioridad {PRIORITY_LABEL[task.priority]}
            </Badge>
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
              <dt className="text-xs font-medium text-slate-500">Área</dt>
              <dd className="text-petrol-900">{task.department?.name ?? 'Sin área'}</dd>
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
                    #{task.entry.seq} · {task.entry.title}
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
        </div>

        {!task.deletedAt ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 no-print">
            {task.status === TaskStatus.PENDIENTE ? (
              <QuickStatusForm taskId={task.id} status={TaskStatus.EN_CURSO} label="Tomar" />
            ) : null}
            {open && task.status !== TaskStatus.REALIZADA && !task.evidenceRequired && user.permissions.includes('task.close') ? (
              <QuickStatusForm
                taskId={task.id}
                status={TaskStatus.REALIZADA}
                label="Resolver"
                variant="gold"
              />
            ) : null}
            {task.status === TaskStatus.REALIZADA && user.permissions.includes('supervision.task.validate') ? (
              <QuickStatusForm taskId={task.id} status={TaskStatus.VALIDADA} label="Validar" variant="gold" />
            ) : null}
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
                  dueAt: toDateTimeInput(task.dueAt),
                  departmentId: task.departmentId,
                  tags: task.tags,
                  fulfillmentCriteria: task.fulfillmentCriteria ?? '',
                  evidenceRequired: task.evidenceRequired ?? '',
                  evidenceProvided: task.evidenceProvided ?? '',
                }}
                departments={options.departments}
              />
            ) : null}
            {user.permissions.includes('entry.delete') ? (
              <DeleteTaskDialog taskId={task.id} />
            ) : null}
          </div>
        ) : null}
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
                  {task.deletedAt || !open ? (
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
          <CardHeader title="Historial" count={history.length} />
          <HistoryTimeline events={history} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Comentarios" count={task._count.comments} />
        <Comments target={{ taskId: task.id }} />
      </Card>
    </div>
  );
}
