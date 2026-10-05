import { Fragment } from 'react';
import { taskFollowUpReadWhere } from '@/server/services/followup-access';
import Link from 'next/link';
import { UxJourney } from '@/components/observability/ux-journey';
import packageJson from '../../../package.json';
import { redirect } from 'next/navigation';
import { Search, UserRound } from 'lucide-react';
import { NotificationCenter } from '@/components/layout/notification-center';
import { ChatWidget } from '@/components/layout/chat-widget';
import { ReceptionAssistant } from '@/components/layout/reception-assistant';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/server/auth/current-user';
import { needsInstall } from '@/server/services/install';
import { getSettingString } from '@/server/services/settings';
import { countMyActiveOperationalAlarms } from '@/server/services/operational-alarms';
import { visibleNavGroups } from '@/components/layout/nav-items';
import { DesktopNav, MobileNav } from '@/components/layout/nav';
import { AnnouncementGate } from '@/components/operational/announcement-gate';
import { ReceptionOperationGate } from '@/components/operational/reception-operation-gate';
import { HelpCenter } from '@/components/layout/help-center';
import { TutorialTour } from '@/components/layout/tutorial';
import {
  enabledTutorialModules,
  guidedTourSteps,
  moduleTutorialSteps,
} from '@/domain/tutorial-tour';
import { getBlockingAnnouncements } from '@/server/services/announcements';
import { TASK_OPEN_STATUSES } from '@/domain/labels';
import { initials, formatCalendarDate } from '@/lib/format';
import { resolveOperationalBusinessDate } from '@/server/services/shifts';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { getChatUnreadCount } from '@/server/services/chat';
import { AiAttribution } from '@/components/ai/ai-attribution';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import { canUseFronti } from '@/server/ai/fronti-access';
import { getReceptionOperationGate } from '@/server/services/reception-operation-gate';
import {
  AccountMenu,
  FrontiLauncher,
  PropertyMenu,
} from '@/components/layout/topbar-menus';
import { SupportRequestPanel } from '@/components/layout/support-request-panel';
import { assertMaintenanceAccess, getMaintenanceState, MaintenanceError } from '@/server/services/system-maintenance';
import { MaintenanceWatcher } from '@/components/operational/maintenance-watcher';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    if ((await getMaintenanceState()).enabled) redirect('/mantenimiento');
    if (await needsInstall()) redirect('/instalacion');
    redirect('/login');
  }
  try { await assertMaintenanceAccess(user); }
  catch (error) { if (error instanceof MaintenanceError) redirect('/mantenimiento'); throw error; }
  if (user.mustChangePassword) redirect('/cambiar-contrasena');
  if (!(await hasAcceptedCurrentTerms(user.id))) redirect('/aceptar-terminos');

  const [
    hotelName,
    alerts,
    notificationFeed,
    myOpenTasks,
    blocking,
    tutorialRow,
    chatUnread,
    frontiConfig,
    receptionGate,
    businessDate,
  ] = await Promise.all([
    getSettingString('hotel.name', 'Hotel'),
    countMyActiveOperationalAlarms(user.id),
    getNotificationFeedForUser(user.id),
    prisma.task.count({
      where: { AND: [taskFollowUpReadWhere(user)], deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
    }),
    getBlockingAnnouncements(user.id),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { tutorialDoneAt: true, tutorialKnownModules: true },
    }),
    user.roleOperational
      ? getChatUnreadCount(user.id)
      : Promise.resolve(0),
    getFrontiConfig(),
    getReceptionOperationGate(user),
    resolveOperationalBusinessDate(),
  ]);

  const tutorialDone = tutorialRow?.tutorialDoneAt !== null;
  const enabledModules = enabledTutorialModules(user.permissions);
  const knownModules = new Set(tutorialRow?.tutorialKnownModules ?? []);
  const pendingModules = tutorialDone
    ? enabledModules.filter((module) => !knownModules.has(module))
    : [];
  const groups = visibleNavGroups(user.permissions, user.isSystemAdmin);
  const items = groups.flatMap((group) => group.items);
  const badges = { '/notificaciones': alerts, '/libro': myOpenTasks };
  const frontiVisible = canUseFronti(user, frontiConfig.enabled);
  const maintenanceActive = user.isSystemAdmin && (await getMaintenanceState()).enabled;

  return (
    <div className="min-h-screen bg-[var(--aroh-canvas)]">
      <a href="#contenido-principal" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-petrol-900">Ir al contenido principal</a>
      {!user.isSystemAdmin && <MaintenanceWatcher />}
      {maintenanceActive && <div role="status" className="bg-amber-100 px-4 py-3 text-center text-sm text-amber-950">Mantenimiento activo: la operación del personal está pausada. <Link className="font-semibold underline" href="/admin/mantenimiento">Controlar / reabrir</Link></div>}
      <UxJourney/>
      <div className="flex min-h-screen min-w-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white no-print">
            <div className="mx-auto flex w-full max-w-[1680px] min-w-0 items-center gap-2 px-4 py-2 flex-wrap lg:gap-3 xl:flex-nowrap">
              <Link href="/" className="min-w-0 max-w-[min(12rem,45vw)] shrink-0" title={'AROH Central IA · ' + hotelName}>
                <span className="block text-sm font-semibold text-petrol-950">AROH <span className="text-gold-600">Central IA</span></span>
                <span className="block truncate text-xs text-slate-500">{hotelName}</span>
              </Link>

              <form
                action="/buscar"
                className="relative order-last w-full min-w-0 xl:order-none xl:w-auto xl:flex-1 xl:max-w-2xl"
                data-tour="global-search"
              >
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="q"
                  placeholder="Buscar #ID, habitación, huésped, responsable o texto…"
                  aria-label="Búsqueda global"
                  className="input-base h-9 pl-9"
                />
              </form>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {frontiVisible ? <FrontiLauncher displayName={frontiConfig.displayName} /> : null}
                <PropertyMenu hotelName={hotelName} />
                <AccountMenu
                  userName={user.name}
                  roleName={user.roleName}
                  initialsText={initials(user.name)}
                />

                <div data-tour="help-center">
                  <HelpCenter permissions={user.permissions} userId={user.id} />
                </div>

                <SupportRequestPanel version={packageJson.version} hotelName={hotelName} />
                <NotificationCenter initialSnapshot={notificationFeed} />

                {user.roleOperational ? (
                  <ChatWidget currentUserId={user.id} initialUnread={chatUnread} />
                ) : null}

                <Link
                  href="/perfil"
                  className="rounded-md p-2 text-petrol-700 hover:bg-gold-50 lg:hidden"
                  aria-label="Mi perfil"
                >
                  <UserRound className="h-5 w-5" aria-hidden="true" />
                </Link>
              </div>
            </div>
            <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-2 text-xs text-slate-600" aria-label="Contexto operativo">
              <p>Fecha operativa: <time dateTime={businessDate.toISOString().slice(0, 10)} className="font-semibold tabular text-petrol-900">{formatCalendarDate(businessDate)}</time></p>
              <p className="min-w-0 truncate" title={user.roleName}>{user.roleName}</p>
            </div>
            <DesktopNav groups={groups} badges={badges} />
            <MobileNav items={items} groups={groups} badges={badges} hotelName={hotelName} roleName={user.roleName} />
            <noscript>
              <details className="mx-auto w-full max-w-[1680px] border-t border-slate-200 px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-petrol-900">Abrir módulos disponibles</summary>
                <nav aria-label="Módulos sin JavaScript" className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {groups.map((group, index) => <section key={index}>
                    <h2 className="text-sm font-semibold text-petrol-900">{group.title || 'Inicio'}</h2>
                    <ul className="mt-2 space-y-2 text-sm">{[...new Map(group.items.flatMap(item => [{ href: item.href, label: item.label }, ...(item.menu?.flatMap(section => section.items) || [])]).map(link => [link.href, link])).values()].map(link => <li key={link.href}><Link href={link.href} className="underline text-petrol-700">{link.label}</Link></li>)}</ul>
                  </section>)}
                </nav>
              </details>
            </noscript>
          </header>

          <main id="contenido-principal" tabIndex={-1} className="mx-auto min-w-0 w-full max-w-[1680px] flex-1 px-4 pb-[calc(var(--mobile-nav-height)+1.5rem)] pt-5 lg:pb-8">
            {/* Keep streamed route content on its own fiber. React bundled with
                Next 15 can replay a claimed host before rewinding hydration. A
                constant keyed Fragment preserves HTML and route/shell identity. */}
            <Fragment key="aroh-route-content">{children}</Fragment>
          </main>

          <div className="mx-auto w-full max-w-[1680px] px-4 pb-[calc(var(--mobile-nav-height)+1.5rem)] lg:pb-4">
            <AiAttribution />
            <p className="mt-1 text-center text-[0.65rem] text-slate-400">
              AROH Central IA v{packageJson.version}
            </p>
          </div>
        </div>
      </div>

      {frontiVisible ? <ReceptionAssistant /> : null}

      <ReceptionOperationGate
        mode={receptionGate.mode}
        handoverId={receptionGate.handoverId}
      />

      {blocking.length > 0 ? (
        <AnnouncementGate announcements={blocking} userName={user.name} />
      ) : null}

      {blocking.length === 0 && !tutorialDone ? (
        <TutorialTour
          steps={guidedTourSteps(user.permissions)}
          userId={user.id}
          userName={user.name}
          suspended={receptionGate.mode !== 'ACTIVE'}
          mode="general"
        />
      ) : blocking.length === 0 && pendingModules.length > 0 ? (
        <TutorialTour
          steps={moduleTutorialSteps(pendingModules, user.permissions)}
          userId={user.id}
          userName={user.name}
          suspended={receptionGate.mode !== 'ACTIVE'}
          mode="modules"
          modules={pendingModules}
        />
      ) : null}
    </div>
  );
}
