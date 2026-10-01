'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlarmClock,
  Banknote,
  BarChart3,
  BedDouble,
  BookOpen,
  CalendarClock,
  ChevronDown,
  DoorClosed,
  History,
  Home,
  KeyRound,
  LogOut,
  Settings,
  ShieldCheck,
  Menu,
  UserRound,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { logoutAction } from '@/server/actions/auth';
import { lockBodyScroll } from '@/lib/body-scroll-lock';
import { GroupedNav } from './app-sidebar';
import type { NavGroup, NavItem } from './nav-items';

const ICONS = {
  home: Home,
  book: BookOpen,
  shift: CalendarClock,
  supervision: ShieldCheck,
  guest: BedDouble,
  history: History,
  metrics: BarChart3,
  room: DoorClosed,
  key: KeyRound,
  cash: Banknote,
  alarm: AlarmClock,
  admin: Settings,
} as const;

function isActive(pathname: string, href: string): boolean {
  const target = href.split(/[?#]/, 1)[0] ?? href;
  if (target === '/') return pathname === '/';
  return pathname === target || pathname.startsWith(`${target}/`);
}

function badgeFor(
  badges: Partial<Record<string, number>> | undefined,
  href: string,
): number | undefined {
  const path = href.split(/[?#]/, 1)[0] ?? href;
  return badges?.[href] ?? badges?.[path];
}

function Badge({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[0.72rem] font-semibold tabular text-petrol-950">
      {value > 99 ? '99+' : value}
    </span>
  );
}

export function DesktopNav({
  groups,
  badges,
}: {
  groups: NavGroup[];
  badges?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const [openHref, setOpenHref] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
    width: number;
    arrowLeft: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const items = groups.flatMap((group) => group.items);
  const openItem = items.find((item) => item.href === openHref && item.menu?.length);

  const positionMenu = useCallback((href: string) => {
    if (typeof window === 'undefined') return;
    const trigger = triggerRefs.current[href];
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const preferredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12));
    const arrowLeft = Math.max(
      18,
      Math.min(rect.left + rect.width / 2 - left, width - 18),
    );

    setMenuPosition({
      left,
      top: rect.bottom + 8,
      width,
      arrowLeft,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setOpenHref(null);
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  useEffect(() => {
    if (!openHref) return;

    positionMenu(openHref);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onViewportChange = () => positionMenu(openHref);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [openHref, closeMenu, positionMenu]);

  return (
    <div
      ref={rootRef}
      className="hidden border-t border-petrol-800 bg-petrol-950 lg:block"
    >
      <nav
        aria-label="Navegación principal"
        className="mx-auto w-full max-w-[1680px] overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="mx-auto flex w-max min-w-full items-stretch justify-center">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            const badge = badgeFor(badges, item.href);
            const hasMenu = Boolean(item.menu?.length);
            const open = openHref === item.href;

            const className = cn(
              'relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-[0.8rem] font-medium transition-[background-color,color] duration-150',
              active || open
                ? 'bg-petrol-800 text-white'
                : 'text-petrol-100 hover:bg-petrol-900 hover:text-white',
            );

            if (!hasMenu) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={className}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                  {badge && badge > 0 ? <Badge value={badge} /> : null}
                  {active ? (
                    <span
                      className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gold-500"
                      aria-hidden="true"
                    />
                  ) : null}
                </Link>
              );
            }

            return (
              <button
                key={item.href}
                ref={(node) => {
                  triggerRefs.current[item.href] = node;
                }}
                type="button"
                onClick={() => {
                  if (open) {
                    closeMenu();
                    return;
                  }
                  setOpenHref(item.href);
                  requestAnimationFrame(() => positionMenu(item.href));
                }}
                aria-expanded={open}
                aria-haspopup="menu"
                className={className}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
                {badge && badge > 0 ? <Badge value={badge} /> : null}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-petrol-300 transition-transform duration-200',
                    open && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
                {active ? (
                  <span
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-gold-500"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {openItem?.menu?.length && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Opciones de ${openItem.label}`}
              className="nav-dropdown-enter fixed z-[70] rounded-lg border border-slate-300 bg-white shadow-[0_18px_42px_-24px_rgba(9,24,32,0.48)]"
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuPosition.width,
              }}
            >
              <span
                className="absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-slate-200 bg-white"
                style={{ left: menuPosition.arrowLeft - 6 }}
                aria-hidden="true"
              />
              <div className="max-h-[min(70vh,34rem)] overflow-y-auto p-2">
                {openItem.menu.map((section, sectionIndex) => (
                  <section
                    key={section.title}
                    className={cn(
                      'min-w-0',
                      sectionIndex > 0 && 'mt-1 border-t border-slate-100 pt-1',
                    )}
                  >
                    <h2 className="px-2 pb-1 pt-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      {section.title}
                    </h2>
                    <ul className="space-y-0.5">
                      {section.items.map((subitem) => {
                        const subActive =
                          pathname === (subitem.href.split(/[?#]/, 1)[0] ?? subitem.href);
                        return (
                          <li key={subitem.href}>
                            <Link
                              href={subitem.href}
                              title={subitem.description}
                              role="menuitem"
                              onClick={closeMenu}
                              className={cn(
                                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.82rem] transition-[background-color,color,box-shadow] duration-150',
                                subActive
                                  ? 'bg-petrol-50 font-semibold text-petrol-900 shadow-sm ring-1 ring-petrol-100'
                                  : 'text-slate-700 hover:bg-slate-50 hover:text-petrol-900',
                              )}
                            >
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 shrink-0 rounded-full border transition-colors',
                                  subActive
                                    ? 'border-gold-600 bg-gold-500'
                                    : 'border-slate-300 bg-white',
                                )}
                                aria-hidden="true"
                              />
                              <span className="min-w-0 flex-1 truncate">{subitem.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function SidebarNav({ groups, badges }: { groups: NavGroup[]; badges?: Partial<Record<string, number>> }) {
  return <GroupedNav groups={groups} badges={badges} />;
}

/** Barra inferior para móvil: acceso a lo que se usa de pie en el mesón. */
/**
 * Barra inferior en móvil.
 *
 * Muestra los destinos principales y, al final, «Más», que abre el resto.
 * Ese botón NO es un adorno: el menú lateral está oculto por debajo de `lg`,
 * así que sin él Llaves, Auditoría y Administración quedaban
 * **inalcanzables desde el teléfono**. La barra sólo pintaba cinco
 * elementos y los demás no tenían ninguna otra puerta.
 *
 * El panel cierra con **mi perfil y cerrar sesión**, por el mismo motivo y
 * corrigiendo el mismo descuido: el único botón de cerrar sesión vivía dentro
 * del `<aside>` oculto, así que **desde el teléfono no había forma de salir**.
 * En un mesón que se comparte entre turnos, no poder cerrar sesión no es una
 * incomodidad: es que el siguiente opera con la cuenta del anterior.
 */
export function MobileNav({
  items,
  groups,
  badges,
}: {
  items: NavItem[];
  groups?: NavGroup[];
  badges?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const [openMore, setOpenMore] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mobileItems = items.filter((item) => item.mobile).slice(0, 4);
  const shownHrefs = new Set(mobileItems.map((item) => item.href));
  const restItems = items.filter((item) => !shownHrefs.has(item.href));

  // Al navegar, el panel se cierra: si no, quedaría tapando la pantalla nueva.
  useEffect(() => {
    setOpenMore(false);
  }, [pathname]);

  // Escape cierra, como cualquier panel del sistema.
  useEffect(() => {
    if (!openMore) return;
    const trigger = moreTriggerRef.current;
    const unlock = lockBodyScroll();
    morePanelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpenMore(false); moreTriggerRef.current?.focus(); }
      if (event.key === 'Tab') {
        const controls = morePanelRef.current?.querySelectorAll<HTMLElement>('a[href], button, [tabindex="0"]');
        const first = controls?.[0]; const last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const onResize = () => { if (window.innerWidth >= 1024) setOpenMore(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); unlock(); trigger?.focus(); };
  }, [openMore]);

  const restHasBadge = restItems.some((item) => (badges?.[item.href] ?? 0) > 0);
  const restIsActive = restItems.some((item) => isActive(pathname, item.href));

  return (
    <>
      {openMore && mounted ? createPortal(
        <div className="fixed inset-0 z-[60] lg:hidden no-print">
          <button
            type="button"
            className="surface-enter absolute inset-0 bg-petrol-950/40"
            aria-label="Cerrar el menú"
            onClick={() => setOpenMore(false)}
          />
          <div ref={morePanelRef} role="dialog" aria-modal="true" aria-label="Todo el menú" className="mobile-menu-enter absolute inset-x-0 bottom-[var(--mobile-nav-height)] max-h-[calc(100dvh-var(--mobile-nav-height)-env(safe-area-inset-top)-1rem)] overflow-y-auto overscroll-contain rounded-t-lg border-t-2 border-t-gold-500 bg-white p-3 shadow-[0_-12px_40px_-28px_rgba(9,24,32,0.45)]">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-sm font-semibold text-petrol-900">Todo el menú</p>
              <button
                type="button"
                onClick={() => setOpenMore(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <GroupedNav
              groups={(groups ?? [{ title: null, items }]).map(group => ({ ...group, items: group.items.filter(item => !shownHrefs.has(item.href)) })).filter(group => group.items.length > 0)}
              badges={badges}
              light
              onNavigate={() => setOpenMore(false)}
            />

            {/*
              La cuenta, separada del menú por una línea: no es un destino
              operativo, es de quién es esta sesión.
            */}
            <div className="mt-2 border-t border-slate-200 pt-2">
              <Link
                href="/perfil"
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 active:bg-slate-100"
              >
                <UserRound className="h-5 w-5 shrink-0 text-petrol-600" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Mi perfil</span>
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-700 active:bg-red-50"
                >
                  <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-left">Cerrar sesión</span>
                </button>
              </form>
            </div>
          </div>
        </div>, document.body
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex pb-[env(safe-area-inset-bottom)] border-t border-petrol-800 bg-petrol-950 lg:hidden no-print"
        aria-label="Navegación rápida"
      >
      {mobileItems.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        const badge = badgeFor(badges, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex h-[3.75rem] flex-1 flex-col justify-center items-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium transition-colors active:bg-petrol-50',
              active ? 'text-white' : 'text-petrol-200',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full truncate">{item.mobileLabel ?? item.label}</span>
            {badge && badge > 0 ? (
              <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
            ) : null}
            {active ? (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-gold-500" aria-hidden="true" />
            ) : null}
          </Link>
        );
      })}

      {restItems.length > 0 ? (
        <button
          type="button"
          ref={moreTriggerRef}
          onClick={() => setOpenMore((open) => !open)}
          aria-expanded={openMore}
          className={cn(
            'relative flex h-[3.75rem] flex-1 flex-col justify-center items-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium transition-colors active:bg-petrol-50',
            openMore || restIsActive ? 'text-white' : 'text-petrol-200',
          )}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          <span className="truncate">Más</span>
          {restHasBadge ? (
            <span
              className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-600"
              aria-hidden="true"
            />
          ) : null}
          {restIsActive ? (
            <span
              className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-gold-500"
              aria-hidden="true"
            />
          ) : null}
        </button>
      ) : null}
      </nav>
    </>
  );
}
