import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EntryType, FollowUpStatus } from '@prisma/client';
import { ArrowLeft, CalendarClock, Trash2 } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import { getEntry } from '@/server/services/entries';
import { getHistory } from '@/server/services/history';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Comments } from '@/components/operational/comments';
import { HistoryTimeline } from '@/components/operational/history-timeline';
import {
  CloseFollowUpDialog,
  DeleteEntryDialog,
  EditEntryDialog,
  EntryStatusForm,
  RestoreEntryForm,
} from '@/components/operational/entry-actions';
import { TaskForm } from '@/components/forms/task-form';
import { createTaskAction } from '@/server/actions/tasks';
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
import { SHIFT_TYPE_LABEL } from '@/domain/shift';
import { formatDate, formatDateTime, relativeTime, toDateTimeInput } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;

  const entry = await getEntry(id).catch(() => null);
  if (!entry) notFound();

  const [followUps, tasks, history, options] = await Promise.all([
    prisma.followUp.findMany({
      where: {
        entryId: entry.id,
        deletedAt: null,
        OR: [
          { origin: null },
          { origin: { not: { startsWith: 'SUPERVISION_' } } },
        ],
      },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.task.findMany({
      where: { entryId: entry.id, deletedAt: null },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    getHistory({ entity: 'OperationalEntry', entityId: entry.id }),
    getFormOptions(),
  ]);

  const isIncident = entry.type === EntryType.INCIDENCIA;
  const open = ENTRY_OPEN_STATUSES.includes(entry.status);
  const overdue = isOverdue(entry.dueAt, open);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link
        href="/libro"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver al libro operativo
      </Link>

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
            <span className="text-sm font-semibold tabular text-slate-400">#{entry.seq}</span>
            <Chip>{ENTRY_TYPE_LABEL[entry.type]}</Chip>
            <Badge tone={ENTRY_STATUS_TONE[entry.status]}>
              {ENTRY_STATUS_LABEL[entry.status]}
            </Badge>
            <Badge tone={PRIORITY_TONE[entry.priority]} withSymbol={false}>
              Prioridad {PRIORITY_LABEL[entry.priority]}
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
                  ? `${SHIFT_TYPE_LABEL[entry.shift.type]} · ${formatDate(entry.shift.date)}`
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

          {entry.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <Chip key={tag}>#{tag}</Chip>
              ))}
            </div>
          ) : null}
        </div>

        {!entry.deletedAt ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 no-print">
            {user.permissions.includes('entry.edit') ? (
              <EditEntryDialog
                entry={{
                  id: entry.id,
                  title: entry.title,
                  description: entry.description,
                  dueAt: toDateTimeInput(entry.dueAt),
                  departmentId: entry.departmentId,
                  ownerId: entry.ownerId,
                  priority: entry.priority,
                  tags: entry.tags,
                }}
                departments={options.departments}
                users={options.users}
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

            {user.permissions.includes('task.create') ? (
              <Dialog
                title="Asignar tarea desde este asunto"
                description="Define qué debe hacerse y quién queda a cargo. La tarea conserva el vínculo con este asunto."
                triggerVariant="secondary"
                triggerSize="sm"
                trigger="Asignar tarea"
              >
                <TaskForm
                  action={createTaskAction}
                  options={options}
                  entryId={entry.id}
                  defaultAssigneeId={entry.ownerId ?? user.id}
                />
              </Dialog>
            ) : null}

            {user.permissions.includes('entry.delete') ? (
              <DeleteEntryDialog entryId={entry.id} label="Eliminar" />
            ) : null}
          </div>
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
                    <p className="text-xs font-medium text-slate-500">Resolución</p>
                    <p className="whitespace-pre-line text-sm text-petrol-900">
                      {entry.resolution ?? 'Pendiente'}
                    </p>
                  </div>
                </div>
              ) : entry.resolution ? (
                <div>
                  <p className="text-xs font-medium text-slate-500">Resolución</p>
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
            <CardHeader title="Tareas asignadas" count={tasks.length} />
            {tasks.length === 0 ? (
              <EmptyState message="No se asignaron tareas desde este asunto." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <Link href={`/tareas/${task.id}`} className="block px-4 py-3 hover:bg-slate-50">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs tabular text-slate-400">T#{task.seq}</span>
                        <Badge tone={TASK_STATUS_TONE[task.status]}>
                          {TASK_STATUS_LABEL[task.status]}
                        </Badge>
                        <Badge tone={PRIORITY_TONE[task.priority]} withSymbol={false}>
                          {PRIORITY_LABEL[task.priority]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm font-medium text-petrol-900">{task.title}</p>
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
            <CardHeader title="Historial" count={history.length} />
            <HistoryTimeline events={history} />
          </Card>

          <p className="flex items-center gap-2 px-1 text-xs text-slate-400">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Última actualización {formatDateTime(entry.updatedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
