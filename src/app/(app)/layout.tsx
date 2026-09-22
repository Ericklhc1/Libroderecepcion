import Link from 'next/link';
import packageJson from '../../../package.json';
import { redirect } from 'next/navigation';
import { Bell, BookOpen, LogOut, Search, UserRound } from 'lucide-react';
import { NotificationChime } from '@/components/layout/notification-chime';
import { ReceptionAssistant } from '@/components/layout/reception-assistant';
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
import { guidedTourSteps } from '@/domain/tutorial-tour';
import { getBlockingAnnouncements } from '@/server/services/announcements';
import { QuickActions } from '@/components/layout/quick-actions';
import { logoutAction } from '@/server/actions/auth';
import { TASK_OPEN_STATUSES } from '@/domain/labels';
import { initials } from '@/lib/format';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { AiAttribution } from '@/components/ai/ai-attribution';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    if (await needsInstall()) redirect('/instalacion');
    redirect('/login');
  }
  if (user.mustChangePassword) redirect('/cambiar-contrasena');
  if (!(await hasAcceptedCurrentTerms(user.id))) redirect('/aceptar-terminos');

  const [hotelName, alerts, unreadNotifications, myOpenTasks, blocking, tutorialRow] =
    await Promise.all([
      getSettingString('hotel.name', 'Hotel'),
      countLiveAlerts(),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      prisma.task.count({
        where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
      }),
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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-petrol-900 lg:flex no-print">
        <div className="flex items-center gap-3 border-b border-petrol-800 px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500 text-petrol-950">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.65rem] font-medium text-gold-300">{hotelName}</p>
            <p className="truncate text-sm font-semibold text-white">Libro Operativo</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav groups={groups} badges={badges} />
        </div>

        <div className="border-t border-petrol-800 px-3 py-3">
          <Link href="/perfil" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-petrol-800/60">
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
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
          <div className="flex items-center gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-petrol-800 text-gold-300">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>

            <form action="/libro" className="relative min-w-0 flex-1 max-w-xl" data-tour="global-search">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                name="q"
                placeholder="Buscar: #registro, T#tarea, texto, categoría o responsable…"
                aria-label="Búsqueda global"
                className="input-base pl-9"
              />
            </form>

            <div className="ml-auto flex items-center gap-2">
              <NotificationChime initialNotifications={unreadNotifications} initialAlerts={alerts} />
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
              <div data-tour="help-center">
                <HelpCenter permissions={user.permissions} />
              </div>
              <Link
                href="/perfil"
                className="rounded-lg p-2 text-petrol-700 hover:bg-petrol-50 lg:hidden"
                aria-label="Mi perfil"
              >
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto border-t border-slate-100 px-4 py-2" data-tour="quick-actions">
            <QuickActions user={user} compact />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:pb-8">{children}</main>
        <div className="px-4 pb-24 lg:pb-4">
          <AiAttribution />
          <p className="mt-1 text-center text-[0.65rem] text-slate-400">Libro Operativo v{packageJson.version}</p>
        </div>
      </div>

      <MobileNav items={items} badges={badges} />
      <ReceptionAssistant />

      {blocking.length > 0 ? <AnnouncementGate announcements={blocking} userName={user.name} /> : null}

      {!tutorialDone && blocking.length === 0 ? (
        <TutorialTour steps={guidedTourSteps(user.permissions)} userName={user.name} />
      ) : null}
    </div>
  );
}
