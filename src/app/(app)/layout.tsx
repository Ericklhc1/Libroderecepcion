import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Bell, BookOpen, LogOut, Search, UserRound } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/server/auth/current-user';
import { needsInstall } from '@/server/services/install';
import { getSettingString } from '@/server/services/settings';
import { countLiveAlerts } from '@/server/services/alert-engine';
import { visibleNavGroups } from '@/components/layout/nav-items';
import { MobileNav, SidebarNav } from '@/components/layout/nav';
import { AnnouncementGate } from '@/components/operational/announcement-gate';
import { HelpCenter } from '@/components/layout/help-center';
import { TutorialTour } from '@/components/layout/tutorial';
import { tutorialSteps } from '@/domain/help';
import { getBlockingAnnouncements } from '@/server/services/announcements';
import { QuickActions } from '@/components/layout/quick-actions';
import { logoutAction } from '@/server/actions/auth';
import { TASK_OPEN_STATUSES } from '@/domain/labels';
import { initials } from '@/lib/format';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    if (await needsInstall()) redirect('/instalacion');
    redirect('/login');
  }
  if (user.mustChangePassword) redirect('/cambiar-contrasena');

  const [hotelName, alerts, unreadNotifications, myOpenTasks, blocking, tutorialRow] =
    await Promise.all([
      getSettingString('hotel.name', 'Hotel'),
      countLiveAlerts(),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      prisma.task.count({
        where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
      }),
      // Comunicados obligatorios sin confirmar. Va en el mismo Promise.all:
      // es una consulta más, no una espera más.
      getBlockingAnnouncements(user.id),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { tutorialDoneAt: true },
      }),
    ]);

  const tutorialDone = tutorialRow?.tutorialDoneAt !== null;

  const groups = visibleNavGroups(user.permissions);
  const items = groups.flatMap((group) => group.items);
  const badges = { '/supervision': alerts, '/libro': myOpenTasks };

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Barra lateral (escritorio) */}
      {/*
        El aside se fija a la ventana (`sticky top-0` + `h-screen`). Antes sólo
        era una columna flex sin altura: crecía con el contenido, su
        `overflow-y-auto` interno no tenía nada que recortar y el menú
        desaparecía al desplazarse. Ningún ancestro lleva `overflow`, que es
        lo que permite que `sticky` funcione aquí.
      */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-petrol-900 lg:flex no-print">
        <div className="flex items-center gap-3 border-b border-petrol-800 px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500 text-petrol-950">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.65rem] font-medium text-gold-300">
              {hotelName}
            </p>
            <p className="truncate text-sm font-semibold text-white">Libro Operativo</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav groups={groups} badges={badges} />
        </div>

        <div className="border-t border-petrol-800 px-3 py-3">
          <Link
            href="/perfil"
            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-petrol-800/60"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-petrol-700 text-xs font-semibold text-gold-200">
              {initials(user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{user.name}</span>
              <span className="block truncate text-xs text-petrol-200">{user.roleName}</span>
            </span>
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-petrol-200 hover:bg-petrol-800/60 hover:text-white"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
          <div className="flex items-center gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-petrol-800 text-gold-300">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>

            <form action="/historial" className="relative min-w-0 flex-1 max-w-xl">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                name="q"
                placeholder="Buscar en el libro: título, huésped, habitación, reserva, etiqueta…"
                aria-label="Búsqueda global"
                className="input-base pl-9"
              />
            </form>

            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/notificaciones"
                className="relative rounded-lg p-2 text-petrol-700 hover:bg-petrol-50"
                aria-label={`Notificaciones${unreadNotifications > 0 ? ` (${unreadNotifications} sin leer)` : ''}`}
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadNotifications > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[0.6rem] font-semibold tabular text-white">
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </span>
                ) : null}
              </Link>
              {/*
                La ayuda vive en la cabecera, al lado de las notificaciones:
                se necesita desde cualquier pantalla y no es un destino del
                menú. Filtra por permisos, así que nadie ve el procedimiento
                de algo que no puede hacer.
              */}
              <HelpCenter permissions={user.permissions} />
              <Link
                href="/perfil"
                className="rounded-lg p-2 text-petrol-700 hover:bg-petrol-50 lg:hidden"
                aria-label="Mi perfil"
              >
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto border-t border-slate-100 px-4 py-2">
            <QuickActions user={user} compact />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:pb-8">{children}</main>
      </div>

      <MobileNav items={items} badges={badges} />

      {/*
        El comunicado obligatorio se monta al final y por encima de todo
        (`z-[60]`, sobre el menú móvil que va en `z-40`). Se renderiza DENTRO
        del layout, no en lugar de él: así la pantalla de abajo sigue cargada y
        al confirmar no hay que volver a montarla.

        El bloqueo es de interfaz, no de seguridad: quien sepa usar la consola
        puede saltárselo. Lo que el sistema garantiza es que sin confirmar no
        queda registro de lectura, y eso es lo que el Supervisor necesita.
      */}
      {blocking.length > 0 ? (
        <AnnouncementGate announcements={blocking} userName={user.name} />
      ) : null}

      {/*
        Recorrido guiado del primer ingreso. No se muestra junto al comunicado
        obligatorio: si alguien entra por primera vez y además tiene un aviso
        que bloquea, primero lo urgente. El recorrido espera a la próxima
        pantalla, y sigue esperando hasta que lo termine o lo salte.
      */}
      {!tutorialDone && blocking.length === 0 ? (
        <TutorialTour steps={tutorialSteps(user.permissions)} userName={user.name} />
      ) : null}
    </div>
  );
}
