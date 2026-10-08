import { groupNotificationItems } from '@/domain/notification-summary';
import {NoticeNavigation} from '@/components/operational/notice-navigation';
import Link from 'next/link';
import { Bell, Search } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { notificationWhereForUser } from '@/server/services/notification-access';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { NOTIFICATION_TYPE_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import { NotificationMessage } from '@/components/layout/notification-message';
import {
  MarkAllReadForm,
  MarkOneReadForm,
  OpenNotificationButton,
} from './notification-actions';

export const metadata = { title: 'Avisos · Recibidos' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser({ allowAreaOperation:true });
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const estado = typeof params.estado === 'string' ? params.estado : '';

  const notificationWhere: Prisma.NotificationWhereInput = {
    ...await notificationWhereForUser(user.id),
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

  const notifications = await prisma.notification.findMany({
    where: notificationWhere,
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take: 150,
  });
  const groups = groupNotificationItems(notifications.map(item => ({...item, createdAt:item.createdAt.toISOString(), readAt:item.readAt?.toISOString()??null})));
  const unread = notifications.filter((item) => item.readAt === null);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <Bell className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Avisos · Recibidos
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Resultados y cambios que recibiste. Abre el aviso para continuar en el asunto original. Leer un aviso no resuelve el asunto.
          </p>
        </div>
        {unread.length > 0 ? <MarkAllReadForm /> : null}
      </header>

      <NoticeNavigation permissions={user.permissions} current="received"/>
      <form method="get" className="flex flex-wrap gap-2 rounded-xl bg-white p-2 ring-1 ring-slate-200">
        <label className="relative min-w-[15rem] flex-1">
          <span className="sr-only">Filtrar notificaciones</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Buscar en notificaciones…"
            className="input-base w-full pl-9"
          />
        </label>
        <label className="min-w-[9rem]">
          <span className="sr-only">Estado</span>
          <select name="estado" defaultValue={estado} className="input-base">
            <option value="">Todas</option>
            <option value="nuevas">No leídas</option>
            <option value="leidas">Leídas</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-petrol-700 px-3 py-2 text-sm font-medium text-white hover:bg-petrol-800">
          Filtrar
        </button>
        {query || estado ? (
          <Link href="/notificaciones" className="rounded-lg px-3 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Limpiar
          </Link>
        ) : null}
      </form>

      <Card>
        <CardHeader title="Avisos recibidos" count={notifications.length} />
        {notifications.length === 0 ? (
          <EmptyState
            message={query ? 'No hay notificaciones que coincidan con el filtro.' : 'No tienes notificaciones.'}
            hint="Aquí sólo aparecen avisos; la gestión se realiza en la novedad, tarea, alerta o proceso original."
          />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
              {groups.map(({items, title, body}) => { const notification = items[0]!; const unreadCount = items.filter(item=>item.readAt===null).length; return (
                <li
                  key={notification.id}
                  className={`flex flex-wrap items-start gap-3 px-4 py-3 ${
                    unreadCount > 0 ? 'bg-gold-50/40' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip>{NOTIFICATION_TYPE_LABEL[notification.type]}</Chip>
                      <time className="text-xs tabular text-slate-400">
                        {formatDateTime(notification.createdAt)}
                      </time>
                      {unreadCount > 0 ? (
                        <span className="rounded bg-gold-500 px-1.5 py-0.5 text-[0.6rem] font-semibold text-petrol-950">
                          {unreadCount} sin leer
                        </span>
                      ) : null}
                    </div>
                    <NotificationMessage notification={{...notification,title:title??notification.title,body:body??notification.body}} />
                    {items.length>1&&<details className="mt-1"><summary className="cursor-pointer text-xs font-semibold">×{items.length} avisos · ver originales</summary><ul>{items.map(original=><li key={original.id} className="flex flex-wrap items-center gap-2 py-1 text-xs"><span>{original.title}</span><time>{formatDateTime(original.createdAt)}</time>{original.link?<OpenNotificationButton id={original.id} href={original.link} unread={original.readAt===null}/>:original.readAt===null?<MarkOneReadForm id={original.id}/>:<span>Leído</span>}</li>)}</ul></details>}
                    {notification.link ? (
                      <OpenNotificationButton
                        id={notification.id}
                        href={notification.link}
                        unread={notification.readAt === null}
                      />
                    ) : null}
                  </div>
                  {notification.readAt === null && !notification.link ? (
                    <MarkOneReadForm id={notification.id} />
                  ) : null}
                </li>
              ); })}
            </ul>
          </CardScroll>
        )}
      </Card>
    </div>
  );
}
