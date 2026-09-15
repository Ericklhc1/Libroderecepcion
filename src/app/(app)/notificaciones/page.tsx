import Link from 'next/link';
import { Bell } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { NOTIFICATION_TYPE_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import { MarkAllReadForm, MarkOneReadForm } from './notification-actions';

export const metadata = { title: 'Notificaciones' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requirePageUser();

  // Filtrado por usuario: nadie puede ver notificaciones ajenas.
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });

  const unread = notifications.filter((n) => n.readAt === null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <Bell className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Notificaciones
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            {unread.length > 0
              ? `Tienes ${unread.length} notificación(es) sin leer.`
              : 'Estás al día.'}
          </p>
        </div>
        {unread.length > 0 ? <MarkAllReadForm /> : null}
      </header>

      <Card>
        <CardHeader title="Bandeja" count={notifications.length} />
        {notifications.length === 0 ? (
          <EmptyState
            message="No tienes notificaciones."
            hint="Recibirás avisos al asignarte tareas, ante incidencias críticas, vencimientos y entregas disponibles."
          />
        ) : (
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
                      <span className="rounded bg-gold-500 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-petrol-950">
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
                {notification.readAt === null ? (
                  <MarkOneReadForm id={notification.id} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="pb-2 text-xs text-slate-400">
        Los avisos son internos. La arquitectura queda preparada para agregar correo o WhatsApp sin
        modificar los módulos operativos.
      </p>
    </div>
  );
}
