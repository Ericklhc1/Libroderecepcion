'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { logoutAction } from '@/server/actions/auth';
import { lockBodyScroll } from '@/lib/body-scroll-lock';
import { GroupedNav } from './app-sidebar';
import { AppearancePreference } from '@/components/appearance/appearance-preference';
import type { NavGroup, NavItem } from './nav-items';
import { badgeFor, navigationContext } from './navigation-state';
import { NAV_ICONS } from './navigation-icons';

export { DesktopNav } from './fns-navigation';

export function SidebarNav({ groups, badges }: { groups: NavGroup[]; badges?: Partial<Record<string, number>> }) {
  return <GroupedNav groups={groups} badges={badges} />;
}

/** Barra inferior para móvil: acceso a lo que se usa de pie en el mesón.
 * Módulos y Más abren el catálogo completo, incluidas las vistas secundarias de
 * los accesos rápidos. Perfil, apariencia y salida siguen disponibles por rol.
 */
type MobileNavProps = {
  items: NavItem[];
  groups?: NavGroup[];
  badges?: Partial<Record<string, number>>;
  hotelName?: string;
  roleName?: string;
};

export function MobileNav(props: MobileNavProps) {
  return <Suspense fallback={<div className="h-12 bg-petrol-950 lg:hidden" />}><MobileNavigation {...props} /></Suspense>;
}

function MobileNavigation({ items, groups, badges, hotelName, roleName }: MobileNavProps) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = pathname + '?' + search;
  const allGroups = groups ?? [{ title: null, items }];
  const current = navigationContext(allGroups, pathname, search);
  const [openMore, setOpenMore] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(true);
  const id = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mobileItems = items.filter((item) => item.mobile).slice(0, 4);
  const shownHrefs = new Set(mobileItems.map((item) => item.href));
  const restItems = items.filter((item) => !shownHrefs.has(item.href));
  const CurrentIcon = current.item ? NAV_ICONS[current.item.icon] : Menu;
  const openPanel = (trigger: HTMLButtonElement) => {
    panelTriggerRef.current = trigger;
    returnFocus.current = true;
    setOpenMore(true);
  };
  const closePanel = (restoreFocus = true) => {
    returnFocus.current = restoreFocus;
    setOpenMore(false);
  };

  // A new query view is a real navigation too, even if its pathname is unchanged.
  useEffect(() => {
    returnFocus.current = false;
    setOpenMore(false);
  }, [route]);

  useEffect(() => {
    if (!openMore) return;
    const trigger = panelTriggerRef.current;
    const unlock = lockBodyScroll();
    morePanelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); returnFocus.current = true; setOpenMore(false); }
      if (event.key === 'Tab') {
        const controls = morePanelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:checked, [tabindex="0"]');
        const first = controls?.[0]; const last = controls?.[controls.length - 1];
        const outside = !morePanelRef.current?.contains(document.activeElement);
        if (event.shiftKey && (outside || document.activeElement === first)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (outside || document.activeElement === last)) { event.preventDefault(); first?.focus(); }
      }
    };
    const onResize = () => { if (window.innerWidth >= 1024) { returnFocus.current = false; setOpenMore(false); } };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); unlock(); if (returnFocus.current) trigger?.focus(); };
  }, [openMore]);

  const restHasBadge = restItems.some(item => badgeFor(badges, item.href) > 0);
  const restIsActive = restItems.some(item => current.item?.href === item.href);

  return <>
    <div className="border-t border-petrol-800 bg-petrol-950 px-4 text-white lg:hidden" data-module-navigation="mobile">
      <button type="button" onClick={event => openPanel(event.currentTarget)} aria-expanded={openMore} aria-controls={openMore ? id + '-panel' : undefined}
        aria-label={'Abrir módulos. Actual: ' + (current.item?.label ?? 'Navegación')}
        className="flex min-h-12 w-full items-center gap-2 py-2 text-left">
        <CurrentIcon className="h-4 w-4 shrink-0 text-gold-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current.item?.label ?? 'Navegación'}</span>
          {current.destinationLabel && current.destinationLabel !== current.item?.label ? <span className="block truncate text-xs text-petrol-200">{current.destinationLabel}</span> : null}
        </span>
        <span className="text-xs text-petrol-200">Módulos</span><Menu className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
    </div>
    {openMore && mounted ? createPortal(
      <div className="fixed inset-0 z-[60] lg:hidden no-print">
        <div className="surface-enter absolute inset-0 bg-petrol-950/40" aria-hidden="true" onClick={() => closePanel()} />
        <div ref={morePanelRef} id={id + '-panel'} role="dialog" aria-modal="true" aria-label="Todo el menú"
          className="mobile-menu-enter absolute inset-x-0 bottom-[var(--mobile-nav-height)] max-h-[calc(100dvh-var(--mobile-nav-height)-env(safe-area-inset-top)-1rem)] overflow-y-auto overscroll-contain rounded-t-lg border-t-2 border-t-gold-500 bg-white p-3 shadow-[0_-12px_40px_-28px_rgba(9,24,32,0.45)]">
          <div className="mb-2 flex items-start justify-between gap-3 px-1">
            <div className="min-w-0"><p className="text-sm font-semibold text-petrol-900">Todo el menú</p>
              {hotelName ? <p className="truncate text-xs text-slate-500">{hotelName}</p> : null}
              {roleName ? <p className="truncate text-xs text-slate-500">{roleName}</p> : null}
            </div>
            <button type="button" onClick={() => closePanel()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {/* All filtered modules remain here, including the submenus of bottom shortcuts. */}
          <GroupedNav groups={allGroups} badges={badges} light onNavigate={() => closePanel(false)} />
          <div className="mt-2 border-t border-slate-200 pt-2">
            <Link href="/perfil" onClick={() => closePanel(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 active:bg-slate-100">
              <UserRound className="h-5 w-5 shrink-0 text-petrol-600" aria-hidden="true" /><span>Mi perfil</span>
            </Link>
            <div className="px-3 py-3"><AppearancePreference /></div>
            <form action={logoutAction}>
              <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-700 active:bg-red-50">
                <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" /><span>Cerrar sesión</span>
              </button>
            </form>
          </div>
        </div>
      </div>, document.body,
    ) : null}
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-petrol-800 bg-petrol-950 pb-[env(safe-area-inset-bottom)] lg:hidden no-print" aria-label="Navegación rápida">
      {mobileItems.map(item => {
        const Icon = NAV_ICONS[item.icon];
        const active = current.item?.href === item.href;
        const badge = badgeFor(badges, item.href);
        return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
          className={cn('relative flex h-[3.75rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium transition-colors active:bg-petrol-800', active ? 'text-white' : 'text-petrol-200')}>
          <Icon className="h-5 w-5" aria-hidden="true" /><span className="max-w-full truncate">{item.mobileLabel ?? item.label}</span>
          {badge > 0 ? <><span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" /><span className="sr-only">{badge} pendientes</span></> : null}
          {active ? <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-gold-500" aria-hidden="true" /> : null}
        </Link>;
      })}
      <button type="button" ref={moreTriggerRef} onClick={event => openMore ? closePanel() : openPanel(event.currentTarget)} aria-expanded={openMore} aria-controls={openMore ? id + '-panel' : undefined}
        className={cn('relative flex h-[3.75rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium transition-colors active:bg-petrol-800', openMore || restIsActive ? 'text-white' : 'text-petrol-200')}>
        <Menu className="h-5 w-5" aria-hidden="true" /><span>Más</span>
        {restHasBadge ? <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" /> : null}
        {restIsActive ? <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-gold-500" aria-hidden="true" /> : null}
      </button>
    </nav>
  </>;
}
