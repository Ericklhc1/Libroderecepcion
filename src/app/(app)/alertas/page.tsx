import Link from 'next/link';
import { AlertStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { alertInclude } from '@/server/services/alerts';
import { refreshAlertsInBackground } from '@/server/services/dashboard';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Comments } from '@/components/operational/comments';
import {
  AcknowledgeAlertForm,
  ClosureValidationActions,
  CreateAlertDialog,
  ResolveAlertDialog,
  RunEngineForm,
  SnoozeAlertForm,
} from '@/components/operational/alert-actions';
import { TaskForm } from '@/components/forms/task-form';
import { createTaskAction } from '@/server/actions/tasks';
import {
  ALERT_LEVEL_LABEL,
  ALERT_LEVEL_TONE,
  ALERT_STATUS_LABEL,
  ALERT_STATUS_TONE,
  ALERT_TYPE_LABEL,
} from '@/domain/labels';
import { formatDateTime, relativeTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Alertas' };
export const dynamic = 'force-dynamic';

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  refreshAlertsInBackground();

  const estado = typeof params.estado === 'string' ? params.estado : 'activas';
  const now = new Date();

  const where: Prisma.AlertWhereInput = {
    deletedAt: null,
    ...(estado === 'activas'
      ? {
          OR: [
            { status: { in: [AlertStatus.NUEVA, AlertStatus.VISTA] } },
            { status: AlertStatus.POSPUESTA, snoozedUntil: { lte: now } },
          ],
        }
      : estado === 'pospuestas'
        ? { status: AlertStatus.POSPUESTA }
        : estado === 'resueltas'
          ? { status: AlertStatus.RESUELTA }
          : {}),
  };

  const [alerts, options, counts] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: alertInclude,
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    getFormOptions(),
    prisma.alert.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));
  const selected = typeof params.alerta === 'string' ? params.alerta : null;
  const canManage = user.permissions.includes('alert.manage');

  const TABS: Array<{ key: string; label: string; count?: number }> = [
    { key: 'activas', label: 'Activas' },
    { key: 'pospuestas', label: 'Pospuestas', count: countByStatus.get(AlertStatus.POSPUESTA) },
    { key: 'resueltas', label: 'Resueltas', count: countByStatus.get(AlertStatus.RESUELTA) },
    { key: 'todas', label: 'Todas' },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Alertas</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Generadas automáticamente por el motor de reglas o creadas a mano. Se pueden marcar
            como vistas, posponer o resolver.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Vista especializada. Para ver las alertas junto al resto de la operación,
            abre el{' '}
            <Link href="/libro?clase=alert" className="font-medium text-petrol-600 hover:underline">
              libro operativo
            </Link>
            .
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2 no-print">
            <RunEngineForm />
            <CreateAlertDialog options={options} />
          </div>
        ) : null}
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Filtro de alertas">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/alertas?estado=${tab.key}`}
            aria-current={estado === tab.key ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
              estado === tab.key
                ? 'bg-petrol-700 text-white ring-petrol-700'
                : 'bg-white text-petrol-700 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span className="ml-1 tabular opacity-70">{tab.count}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {alerts.length === 0 ? (
        <Card>
          <EmptyState
            message="No hay alertas en esta vista."
            hint="El motor de alertas revisa garantías, cobros, vencimientos, incidencias críticas y entregas pendientes."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
          const shiftValidation = alert.dedupeKey?.startsWith('shift-validation:') === true;
          const canValidateThisClosure = shiftValidation && user.username.toLowerCase() === 'eherrera';
          return (
            <li key={alert.id} id={alert.id}>
              <Card className={selected === alert.id ? 'ring-2 ring-gold-400' : undefined}>
                <div className="px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ALERT_LEVEL_TONE[alert.level]}>
                      {ALERT_LEVEL_LABEL[alert.level]}
                    </Badge>
                    <Chip>{ALERT_TYPE_LABEL[alert.type]}</Chip>
                    <Badge tone={ALERT_STATUS_TONE[alert.status]}>
                      {ALERT_STATUS_LABEL[alert.status]}
                    </Badge>
                    {alert.auto ? <Chip>Automática</Chip> : <Chip>Manual</Chip>}
                    {alert.department ? <Chip>{alert.department.name}</Chip> : null}
                  </div>

                  <h2 className="mt-2 font-semibold text-petrol-900">{alert.title}</h2>
                  {alert.message ? (
                    <p className="mt-1 text-sm text-slate-700">{alert.message}</p>
                  ) : null}

                  <p className="mt-2 text-xs text-slate-500">
                    Creada {formatDateTime(alert.createdAt)}
                    {alert.dueAt ? ` · vence ${relativeTime(alert.dueAt)}` : ''}
                    {alert.snoozedUntil
                      ? ` · pospuesta hasta ${formatDateTime(alert.snoozedUntil)}`
                      : ''}
                    {alert.acknowledgedBy ? ` · vista por ${alert.acknowledgedBy.name}` : ''}
                    {alert.resolvedBy
                      ? ` · resuelta por ${alert.resolvedBy.name} el ${formatDateTime(alert.resolvedAt)}`
                      : ''}
                  </p>

                  {alert.resolutionNote ? (
                    <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                      {alert.resolutionNote}
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {alert.entry ? (
                      <Link
                        href={`/libro/${alert.entry.id}`}
                        className="font-medium text-petrol-600 hover:underline"
                      >
                        Registro #{alert.entry.seq}
                      </Link>
                    ) : null}
                    {alert.task ? (
                      <Link
                        href={`/tareas/${alert.task.id}`}
                        className="font-medium text-petrol-600 hover:underline"
                      >
                        Tarea T#{alert.task.seq}
                      </Link>
                    ) : null}
                    {alert.handover ? (
                      <Link
                        href={`/turno/entrega/${alert.handover.id}`}
                        className="font-medium text-petrol-600 hover:underline"
                      >
                        Entrega de turno
                      </Link>
                    ) : null}
                    {alert.reservation ? (
                      <span className="text-slate-500">Reserva {alert.reservation.code}</span>
                    ) : null}
                    {alert.guest ? (
                      <span className="text-slate-500">
                        {alert.guest.fullName}
                        {alert.guest.roomNumber ? ` · hab. ${alert.guest.roomNumber}` : ''}
                      </span>
                    ) : null}
                  </div>
                </div>

                {canManage && alert.status !== AlertStatus.RESUELTA ? (
                  <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 px-4 py-3 no-print">
                    {shiftValidation ? (
                      canValidateThisClosure ? (
                        <ClosureValidationActions alertId={alert.id} />
                      ) : (
                        <p className="text-xs text-slate-500">Validación asignada a Erick Herrera.</p>
                      )
                    ) : (
                      <>
                        {alert.status === AlertStatus.NUEVA ? (
                          <AcknowledgeAlertForm alertId={alert.id} />
                        ) : null}
                        <SnoozeAlertForm alertId={alert.id} />
                        <ResolveAlertDialog alertId={alert.id} auto={alert.auto} />
                        {user.permissions.includes('task.create') ? (
                          <Dialog
                            title="Crear tarea desde la alerta"
                            triggerVariant="secondary"
                            triggerSize="sm"
                            trigger="Crear tarea"
                          >
                            <TaskForm
                              action={createTaskAction}
                              options={options}
                              alertId={alert.id}
                              defaultAssigneeId={user.id}
                              showOrigin={false}
                            />
                          </Dialog>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}

                {selected === alert.id ? (
                  <div className="border-t border-slate-200">
                    <CardHeader title="Comentarios" count={alert._count.comments} />
                    <Comments target={{ alertId: alert.id }} />
                  </div>
                ) : alert._count.comments > 0 ? (
                  <div className="border-t border-slate-200 px-4 py-2">
                    <Link
                      href={`/alertas?estado=${estado}&alerta=${alert.id}#${alert.id}`}
                      className="text-xs font-medium text-petrol-600 hover:underline"
                    >
                      Ver {alert._count.comments} comentario(s)
                    </Link>
                  </div>
                ) : (
                  <div className="border-t border-slate-200 px-4 py-2">
                    <Link
                      href={`/alertas?estado=${estado}&alerta=${alert.id}#${alert.id}`}
                      className="text-xs font-medium text-petrol-600 hover:underline"
                    >
                      Comentar
                    </Link>
                  </div>
                )}
              </Card>
            </li>
          );
          })}
        </ul>
      )}
    </div>
  );
}
