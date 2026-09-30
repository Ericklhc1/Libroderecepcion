import Link from 'next/link';
import packageJson from '../../../package.json';
import { redirect } from 'next/navigation';
import { BookOpen, Search, UserRound } from 'lucide-react';
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
import { guidedTourSteps } from '@/domain/tutorial-tour';
import { getBlockingAnnouncements } from '@/server/services/announcements';
import { TASK_OPEN_STATUSES } from '@/domain/labels';
import { initials } from '@/lib/format';
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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    if (await needsInstall()) redirect('/instalacion');
    redirect('/login');
  }
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
  ] = await Promise.all([
    getSettingString('hotel.name', 'Hotel'),
    countMyActiveOperationalAlarms(user.id),
    getNotificationFeedForUser(user.id),
    prisma.task.count({
      where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
    }),
    getBlockingAnnouncements(user.id),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { tutorialDoneAt: true },
    }),
    user.roleOperational && !user.isSystemAdmin
      ? getChatUnreadCount(user.id)
      : Promise.resolve(0),
    getFrontiConfig(),
    getReceptionOperationGate(user),
  ]);

  const tutorialDone = tutorialRow?.tutorialDoneAt !== null;
  const groups = visibleNavGroups(user.permissions);
  const items = groups.flatMap((group) => group.items);
  const badges = { '/alertas': alerts, '/libro': myOpenTasks };
  const frontiVisible = canUseFronti(user, frontiConfig.enabled);

  return (
    <div className="min-h-screen bg-[#f4f2ed]">
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-300 border-t-2 border-t-gold-500 bg-white/98 backdrop-blur no-print">
          <div className="mx-auto flex w-full max-w-[1680px] min-w-0 items-center gap-2 px-3 py-2">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-petrol-950 text-gold-400 ring-1 ring-petrol-800">
                <BookOpen className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="hidden min-w-0 xl:block">
                <span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-petrol-700">
                  AROH Central IA
                </span>
                <span className="block max-w-44 truncate text-[0.9rem] font-semibold text-slate-700">
                  {hotelName}
                </span>
              </span>
            </Link>

            <form
              action="/buscar"
              className="relative min-w-[11rem] flex-1 xl:max-w-2xl"
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
              {user.roleOperational && !user.isSystemAdmin ? (
                <ChatWidget currentUserId={user.id} initialUnread={chatUnread} />
              ) : null}

              <Link
                href="/perfil"
                className="rounded-lg p-2 text-petrol-700 hover:bg-petrol-50 lg:hidden"
                aria-label="Mi perfil"
              >
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <DesktopNav groups={groups} badges={badges} />
        </header>

        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 lg:pb-8">{children}</main>
        <div className="px-4 pb-24 lg:pb-4">
          <AiAttribution />
          <p className="mt-1 text-center text-[0.65rem] text-slate-400">
            AROH Central IA v{packageJson.version}
          </p>
        </div>
      </div>

      <MobileNav items={items} badges={badges} />

      {frontiVisible ? <ReceptionAssistant /> : null}

      <ReceptionOperationGate
        mode={receptionGate.mode}
        handoverId={receptionGate.handoverId}
      />

      {blocking.length > 0 ? (
        <AnnouncementGate announcements={blocking} userName={user.name} />
      ) : null}

      {!tutorialDone && blocking.length === 0 ? (
        <TutorialTour
          steps={guidedTourSteps(user.permissions)}
          userId={user.id}
          userName={user.name}
          suspended={receptionGate.mode !== 'ACTIVE'}
        />
      ) : null}
    </div>
  );
}
