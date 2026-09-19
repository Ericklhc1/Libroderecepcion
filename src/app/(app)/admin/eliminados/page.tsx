import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import type { RawSearchParams } from '@/lib/search-params';
import { Chip } from '@/components/ui/badge';
import { ENTRY_TYPE_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import { RestoreEntryForm } from '@/components/operational/entry-actions';
import { RestoreTaskForm } from '@/components/operational/task-actions';
import { RestoreFollowUpForm, RestoreAlertForm } from './restore-forms';

export const metadata = { title: 'Registros eliminados' };
export const dynamic = 'force-dynamic';

export default async function DeletedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('entry.restore');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const tipo = typeof params.tipo === 'string' ? params.tipo : '';

  const [entries, tasks, followUps, alerts] = await Promise.all([
    prisma.operationalEntry.findMany({
      where: { NOT: { deletedAt: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
    }),
    prisma.task.findMany({
      where: { NOT: { deletedAt: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
    }),
    prisma.followUp.findMany({
      where: { NOT: { deletedAt: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
    }),
    prisma.alert.findMany({
      where: { NOT: { deletedAt: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
    }),
  ]);

  const deletedByIds = Array.from(
    new Set(
      [...entries, ...tasks, ...followUps, ...alerts]
        .map((row) => row.deletedById)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const users = deletedByIds.length
    ? await prisma.user.findMany({
        where: { id: { in: deletedByIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const who = (id: string | null) => (id ? (nameById.get(id) ?? 'Usuario eliminado') : 'Sistema');

  const textMatches = (values: Array<string | number | null | undefined>) =>
    !q ||
    values
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
      .toLowerCase()
      .includes(q);
  const visibleEntries = entries.filter((entry) =>
    textMatches([entry.seq, entry.title, entry.deletionReason, entry.type]),
  );
  const visibleTasks = tasks.filter((task) =>
    textMatches([task.seq, task.title, task.deletionReason]),
  );
  const visibleFollowUps = followUps.filter((followUp) =>
    textMatches([followUp.action, followUp.deletionReason]),
  );
  const visibleAlerts = alerts.filter((alert) =>
    textMatches([alert.title, alert.message, alert.deletionReason]),
  );
  const shownEntries = !tipo || tipo === 'libro' ? visibleEntries : [];
  const shownTasks = !tipo || tipo === 'tareas' ? visibleTasks : [];
  const shownFollowUps = !tipo || tipo === 'seguimientos' ? visibleFollowUps : [];
  const shownAlerts = !tipo || tipo === 'alertas' ? visibleAlerts : [];
  const total = shownEntries.length + shownTasks.length + shownFollowUps.length + shownAlerts.length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <Trash2 className="h-5 w-5 text-slate-500" aria-hidden="true" />
          Registros eliminados
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Nada se elimina de forma definitiva desde la interfaz: todo registro operativo se marca
          como eliminado y puede restaurarse dejando constancia en la auditoría.
        </p>
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar título, ID, motivo…"
        clearHref="/admin/eliminados"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Tipo</span>
          <select name="tipo" defaultValue={tipo} className="input-base w-full">
            <option value="">Todos</option>
            <option value="libro">Libro</option>
            <option value="tareas">Tareas</option>
            <option value="seguimientos">Seguimientos</option>
            <option value="alertas">Alertas</option>
          </select>
        </label>
      </ListFilterBar>

      {total === 0 ? (
        <Card>
          <EmptyState message="No hay registros eliminados." />
        </Card>
      ) : null}

      {shownEntries.length > 0 ? (
        <Card>
          <CardHeader title="Registros del libro" count={shownEntries.length} />
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {shownEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular text-slate-400">#{entry.seq}</span>
                    <Chip>{ENTRY_TYPE_LABEL[entry.type]}</Chip>
                  </div>
                  <p className="mt-1 font-medium text-petrol-900">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Eliminado {formatDateTime(entry.deletedAt)} por {who(entry.deletedById)}
                    {entry.deletionReason ? ` · Motivo: ${entry.deletionReason}` : ''}
                  </p>
                </div>
                <RestoreEntryForm entryId={entry.id} />
              </li>
            ))}
          </ul>
        </CardScroll>
        </Card>
      ) : null}

      {shownTasks.length > 0 ? (
        <Card>
          <CardHeader title="Tareas" count={shownTasks.length} />
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {shownTasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-petrol-900">
                    <span className="mr-2 text-xs tabular text-slate-400">T#{task.seq}</span>
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Eliminada {formatDateTime(task.deletedAt)} por {who(task.deletedById)}
                    {task.deletionReason ? ` · Motivo: ${task.deletionReason}` : ''}
                  </p>
                </div>
                <RestoreTaskForm taskId={task.id} />
              </li>
            ))}
          </ul>
        </CardScroll>
        </Card>
      ) : null}

      {shownFollowUps.length > 0 ? (
        <Card>
          <CardHeader title="Seguimientos" count={shownFollowUps.length} />
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {shownFollowUps.map((followUp) => (
              <li
                key={followUp.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-petrol-900">{followUp.action}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Eliminado {formatDateTime(followUp.deletedAt)} por {who(followUp.deletedById)}
                    {followUp.deletionReason ? ` · Motivo: ${followUp.deletionReason}` : ''}
                  </p>
                </div>
                <RestoreFollowUpForm followUpId={followUp.id} />
              </li>
            ))}
          </ul>
        </CardScroll>
        </Card>
      ) : null}

      {shownAlerts.length > 0 ? (
        <Card>
          <CardHeader title="Alertas" count={shownAlerts.length} />
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {shownAlerts.map((alert) => (
              <li
                key={alert.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-petrol-900">{alert.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Eliminada {formatDateTime(alert.deletedAt)} por {who(alert.deletedById)}
                    {alert.deletionReason ? ` · Motivo: ${alert.deletionReason}` : ''}
                  </p>
                </div>
                <RestoreAlertForm alertId={alert.id} />
              </li>
            ))}
          </ul>
        </CardScroll>
        </Card>
      ) : null}
    </div>
  );
}
