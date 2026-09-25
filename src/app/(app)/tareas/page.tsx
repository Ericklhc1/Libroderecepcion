import Link from 'next/link';
import { TaskStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardScroll, EmptyState } from '@/components/ui/card';
import { Filters } from '@/components/operational/filters';
import { QuickStatusForm } from '@/components/operational/task-actions';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_OPEN_STATUSES,
  TASK_ORIGIN_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  isOverdue,
} from '@/domain/labels';
import { filterValues, type RawSearchParams } from '@/lib/search-params';
import { relativeTime } from '@/lib/format';

export const metadata = { title: 'Tareas' };
export const dynamic = 'force-dynamic';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const values = filterValues(params);
  const onlyMine = params.mias === '1';

  const estado = values.estado;
  const where: Prisma.TaskWhereInput = {
    deletedAt: null,
    ...(onlyMine ? { assigneeId: user.id } : {}),
    ...(estado === 'abiertos'
      ? { status: { in: TASK_OPEN_STATUSES } }
      : estado && estado in TaskStatus
        ? { status: estado as TaskStatus }
        : {}),
    ...(values.prioridad ? { priority: values.prioridad as Prisma.EnumPriorityFilter } : {}),
    ...(values.area ? { departmentId: values.area } : {}),
    ...(values.responsable ? { assigneeId: values.responsable } : {}),
    ...(values.q
      ? {
          OR: [
            { title: { contains: values.q, mode: 'insensitive' } },
            { description: { contains: values.q, mode: 'insensitive' } },
            { tags: { has: values.q.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [tasks, options, counts] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
        entry: { select: { id: true, seq: true } },
        _count: { select: { checklist: true, comments: true } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }],
      take: 200,
    }),
    getFormOptions(),
    prisma.task.groupBy({
      by: ['status'],
      where: { deletedAt: null, ...(onlyMine ? { assigneeId: user.id } : {}) },
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Tareas</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Lo que hay que hacer, con responsable y fecha límite.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Vista especializada. Para ver las tareas junto al resto de la operación,
            abre el{' '}
            <Link href="/libro?clase=task" className="font-medium text-petrol-600 hover:underline">
              libro operativo
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={onlyMine ? '/tareas' : '/tareas?mias=1'}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
              onlyMine
                ? 'bg-petrol-700 text-white ring-petrol-700'
                : 'bg-white text-petrol-700 ring-slate-300'
            }`}
          >
            {onlyMine ? 'Viendo mis tareas' : 'Ver sólo mis tareas'}
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {Object.values(TaskStatus).map((status) => (
          <Link
            key={status}
            href={`/tareas?estado=${status}${onlyMine ? '&mias=1' : ''}`}
            className="rounded-lg bg-white px-3 py-1.5 text-xs shadow-card ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Badge tone={TASK_STATUS_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>
            <span className="ml-1 tabular text-slate-500">
              {countByStatus.get(status) ?? 0}
            </span>
          </Link>
        ))}
      </div>

      <Filters
        action="/tareas"
        fields={['q', 'estadoTarea', 'prioridad', 'area', 'responsable']}
        values={values}
        options={{ departments: options.departments, users: options.users }}
        extraHidden={onlyMine ? { mias: '1' } : undefined}
      />

      <Card>
        {tasks.length === 0 ? (
          <EmptyState
            message="No hay tareas con esos filtros."
            hint="Crea una tarea desde las acciones rápidas."
          />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const open = TASK_OPEN_STATUSES.includes(task.status);
              const overdue = isOverdue(task.dueAt, open);
              return (
                <li key={task.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link href={`/tareas/${task.id}`} className="min-w-0 flex-1 group">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs tabular text-slate-400">T#{task.seq}</span>
                        <Badge tone={overdue ? 'critico' : TASK_STATUS_TONE[task.status]}>
                          {overdue ? 'Vencida' : TASK_STATUS_LABEL[task.status]}
                        </Badge>
                        <Badge tone={PRIORITY_TONE[task.priority]} withSymbol={false}>
                          {PRIORITY_LABEL[task.priority]}
                        </Badge>
                        <Chip>{TASK_ORIGIN_LABEL[task.origin]}</Chip>
                        {task.entry ? <Chip>Registro #{task.entry.seq}</Chip> : null}
                      </div>
                      <p className="mt-1 font-medium text-petrol-900 group-hover:underline">
                        {task.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {task.assignee ? `Asignada a ${task.assignee.name}` : 'Sin asignar'}
                        {task.department ? ` · ${task.department.name}` : ''}
                        {task.dueAt
                          ? ` · ${overdue ? 'venció' : 'vence'} ${relativeTime(task.dueAt)}`
                          : ' · sin fecha límite'}
                        {task._count.checklist > 0 ? ` · ${task._count.checklist} pasos` : ''}
                        {task._count.comments > 0 ? ` · ${task._count.comments} comentarios` : ''}
                      </p>
                      {task.blockedReason ? (
                        <p className="mt-1 rounded bg-orange-50 px-2 py-1 text-xs text-orange-800">
                          Bloqueada: {task.blockedReason}
                        </p>
                      ) : null}
                    </Link>

                    <div className="flex flex-wrap gap-1.5 no-print">
                      {task.status === TaskStatus.PENDIENTE ? (
                        <QuickStatusForm
                          taskId={task.id}
                          status={TaskStatus.EN_CURSO}
                          label="Tomar"
                          variant="secondary"
                        />
                      ) : null}
                      {open && task.status !== TaskStatus.REALIZADA && !task.evidenceRequired && user.permissions.includes('task.close') ? (
                        <QuickStatusForm
                          taskId={task.id}
                          status={TaskStatus.REALIZADA}
                          label="Resolver"
                          variant="gold"
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
            </ul>
          </CardScroll>
        )}
      </Card>
    </div>
  );
}
