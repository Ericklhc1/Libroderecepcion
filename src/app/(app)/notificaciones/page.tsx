import Link from 'next/link';
import { Bell, Search } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { LIVE_ALERT_WHERE } from '@/server/services/alert-engine';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import {
  ALERT_LEVEL_LABEL,
  ALERT_LEVEL_TONE,
  NOTIFICATION_TYPE_LABEL,
} from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import {
  ResolveAlertQuickForm,
  Snooze30AlertForm,
} from '@/components/operational/alert-actions';
import { MarkAllReadForm, MarkOneReadForm } from './notification-actions';

export const metadata = { title: 'Notificaciones' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const estado = typeof params.estado === 'string' ? params.estado : '';
  const seccion = typeof params.seccion === 'string' ? params.seccion : '';
  const canManageAlerts = hasPermission(user, 'alert.manage');
  const canApproveCash = hasPermission(user, 'cash.approve');
  const isSupervisor = user.roleKey === ROLE_KEYS.SUPERVISOR;
  const canValidateClosure = isSupervisor || user.isSystemAdmin;
  const now = new Date();

  const notificationWhere: Prisma.NotificationWhereInput = {
    userId: user.id,
    ...(estado === 'nuevas'
      ? { readAt: null }
      : estado === 'leidas'
        ? { readAt: { not: null } }
        : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const actionKinds: Prisma.AlertWhereInput[] = [];
  if (canManageAlerts) {
    actionKinds.push({ dedupeKey: { startsWith: 'checkout-unconfirmed:' } });
  }
  if (canApproveCash) {
    actionKinds.push({ dedupeKey: { startsWith: 'cash-transfer:' } });
    actionKinds.push({ dedupeKey: { startsWith: 'cash-manual:' } });
  }
  if (isSupervisor) {
    actionKinds.push({ dedupeKey: { startsWith: 'handover-elements-none:' } });
  }
  if (canValidateClosure) actionKinds.push({ dedupeKey: { startsWith: 'shift-validation:' } });

  const alertFilters: Prisma.AlertWhereInput[] = [
    LIVE_ALERT_WHERE(now),
    { OR: actionKinds },
  ];
  if (query) {
    alertFilters.push({
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { message: { contains: query, mode: 'insensitive' } },
      ],
    });
  }

  const [notifications, actionableAlerts] = await Promise.all([
    seccion === 'acciones'
      ? Promise.resolve([])
      : prisma.notification.findMany({
          where: notificationWhere,
          orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
          take: 100,
        }),
    seccion !== 'avisos' && actionKinds.length > 0
      ? prisma.alert.findMany({
          where: { AND: alertFilters },
          orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const unread = notifications.filter((n) => n.readAt === null);
  const checkoutAlerts = actionableAlerts.filter((alert) =>
    alert.dedupeKey?.startsWith('checkout-unconfirmed:'),
  );
  const approvalAlerts = actionableAlerts.filter(
    (alert) =>
      alert.dedupeKey?.startsWith('cash-transfer:') ||
      alert.dedupeKey?.startsWith('cash-manual:') ||
      alert.dedupeKey?.startsWith('handover-elements-none:') ||
      alert.dedupeKey?.startsWith('shift-validation:'),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <Bell className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Centro de notificaciones
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Avisos personales y acciones operativas que puedes resolver o posponer desde aquí.
          </p>
        </div>
        {unread.length > 0 ? <MarkAllReadForm /> : null}
      </header>

      <form method="get" className="flex gap-2 rounded-xl bg-white p-2 ring-1 ring-slate-200">
        <label className="relative flex-1">
          <span className="sr-only">Filtrar notificaciones</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Filtrar por habitación, reserva, huésped, concepto…"
            className="input-base w-full pl-9"
          />
        </label>
        <label className="min-w-[9rem]">
          <span className="sr-only">Sección</span>
          <select name="seccion" defaultValue={seccion} className="input-base">
            <option value="">Todo</option>
            <option value="acciones">Acciones</option>
            <option value="avisos">Avisos</option>
          </select>
        </label>
        <label className="min-w-[9rem]">
          <span className="sr-only">Estado de avisos</span>
          <select name="estado" defaultValue={estado} className="input-base">
            <option value="">Todos</option>
            <option value="nuevas">No leídos</option>
            <option value="leidas">Leídos</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-petrol-700 px-3 py-2 text-sm font-medium text-white hover:bg-petrol-800">
          Filtrar
        </button>
        {query || estado || seccion ? (
          <Link href="/notificaciones" className="rounded-lg px-3 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Limpiar
          </Link>
        ) : null}
      </form>

      {seccion !== 'avisos' && checkoutAlerts.length > 0 ? (
        <Card>
          <CardHeader title="Check-outs por gestionar" count={checkoutAlerts.length} />
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            No son tarjetas persistentes del tablero. Gestiona el aviso aquí: resuélvelo o posponlo 30 minutos.
          </p>
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {checkoutAlerts.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ALERT_LEVEL_TONE[alert.level]}>{ALERT_LEVEL_LABEL[alert.level]}</Badge>
                    <time className="text-xs tabular text-slate-400">{formatDateTime(alert.createdAt)}</time>
                  </div>
                  <p className="mt-1 text-sm font-medium text-petrol-900">{alert.title}</p>
                  {alert.message ? <p className="mt-0.5 text-sm text-slate-600">{alert.message}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2 no-print">
                  <Snooze30AlertForm alertId={alert.id} />
                  <ResolveAlertQuickForm alertId={alert.id} />
                </div>
              </li>
            ))}
          </ul>
        </CardScroll>
        </Card>
      ) : null}

      {seccion !== 'avisos' && approvalAlerts.length > 0 ? (
        <Card>
          <CardHeader title="Autorizaciones y validaciones" count={approvalAlerts.length} />
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {approvalAlerts.map((alert) => {
              const cashTransfer = alert.dedupeKey?.startsWith('cash-transfer:');
              const cashManual = alert.dedupeKey?.startsWith('cash-manual:');
              const noElements = alert.dedupeKey?.startsWith('handover-elements-none:');
              const cash = cashTransfer || cashManual;
              const label = cash
                ? 'Autorizar'
                : noElements
                  ? 'Validar justificación'
                  : 'Validar cierre';
              const category = cash ? 'Caja' : noElements ? 'Entrega' : 'Cierre de turno';
              return (
                <li key={alert.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="atencion">{category}</Badge>
                      <time className="text-xs tabular text-slate-400">{formatDateTime(alert.createdAt)}</time>
                    </div>
                    <p className="mt-1 text-sm font-medium text-petrol-900">{alert.title}</p>
                    {alert.message ? <p className="mt-0.5 text-sm text-slate-600">{alert.message}</p> : null}
                  </div>
                  <ResolveAlertQuickForm alertId={alert.id} label={label} />
                </li>
              );
            })}
          </ul>
        </CardScroll>
        </Card>
      ) : null}

      {seccion !== 'acciones' ? <Card>
        <CardHeader title="Avisos personales" count={notifications.length} />
        {notifications.length === 0 ? (
          <EmptyState
            message={query ? 'No hay avisos que coincidan con el filtro.' : 'No tienes notificaciones.'}
            hint="Recibirás avisos por tareas, incidencias, vencimientos, entregas y solicitudes de autorización."
          />
        ) : (
          <CardScroll>
          <ul className="divide-y divide-slate-100">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={`flex flex-wrap items-start gap-3 px-4 py-3 ${
                  notification.readAt === null ? 'bg-gold-50/40' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>{NOTIFICATION_TYPE_LABEL[notification.type]}</Chip>
                    <time className="text-xs tabular text-slate-400">
                      {formatDateTime(notification.createdAt)}
                    </time>
                    {notification.readAt === null ? (
                      <span className="rounded bg-gold-500 px-1.5 py-0.5 text-[0.6rem] font-semibold text-petrol-950">
                        Nueva
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-petrol-900">{notification.title}</p>
                  {notification.body ? (
                    <p className="mt-0.5 text-sm text-slate-600">{notification.body}</p>
                  ) : null}
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline"
                    >
                      Abrir
                    </Link>
                  ) : null}
                </div>
                {notification.readAt === null ? <MarkOneReadForm id={notification.id} /> : null}
              </li>
            ))}
          </ul>
        </CardScroll>
        )}
      </Card> : null}

      <p className="pb-2 text-xs text-slate-400">
        Las alertas operativas siguen conservando trazabilidad, pero las que requieren una acción inmediata se administran desde esta bandeja.
      </p>
    </div>
  );
}
