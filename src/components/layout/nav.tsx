'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
    <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular text-petrol-950">
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
  const rootRef = useRef<HTMLDivElement>(null);
  const items = groups.flatMap((group) => group.items);
  const openItem = items.find((item) => item.href === openHref && item.menu?.length);

  useEffect(() => {
    setOpenHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!openHref) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenHref(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpenHref(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openHref]);

  return (
    <div ref={rootRef} className="hidden lg:block">
      <nav
        aria-label="Navegación principal"
        className="flex min-w-0 items-stretch overflow-x-auto border-t border-slate-100 bg-white px-3"
      >
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          const badge = badgeFor(badges, item.href);
          const hasMenu = Boolean(item.menu?.length);
          const open = openHref === item.href;

          const className = cn(
            'relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors',
            active || open
              ? 'bg-petrol-50 text-petrol-900'
              : 'text-slate-600 hover:bg-slate-50 hover:text-petrol-800',
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
              type="button"
              onClick={() => setOpenHref((value) => (value === item.href ? null : item.href))}
              aria-expanded={open}
              className={className}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {badge && badge > 0 ? <Badge value={badge} /> : null}
              <ChevronDown
                className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', open && 'rotate-180')}
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
      </nav>

      {openItem?.menu?.length ? (
        <div className="border-t border-slate-200 bg-slate-50/95 px-5 py-3 shadow-inner">
          <div
            className="grid gap-x-8 gap-y-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(openItem.menu.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {openItem.menu.map((section) => (
              <section key={section.title} className="min-w-0">
                <h2 className="mb-2 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">
                  {section.title}
                </h2>
                <ul className="space-y-1">
                  {section.items.map((subitem) => {
                    const subActive =
                      pathname === (subitem.href.split(/[?#]/, 1)[0] ?? subitem.href);
                    return (
                      <li key={subitem.href}>
                        <Link
                          href={subitem.href}
                          title={subitem.description}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                            subActive
                              ? 'bg-white font-semibold text-petrol-900 ring-1 ring-slate-200'
                              : 'text-slate-700 hover:bg-white hover:text-petrol-900',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full border',
                              subActive ? 'border-gold-600 bg-gold-500' : 'border-slate-400',
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{subitem.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarNav({
  groups,
  badges,
}: {
  groups: NavGroup[];
  badges?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegación principal" className="space-y-5">
      {groups.map((group, index) => (
        <div key={group.title ?? 'principal'} className="space-y-1">
          {group.title ? (
            <p className="px-3 pb-1 text-xs font-medium text-petrol-300">{group.title}</p>
          ) : null}
          {index > 0 && !group.title ? (
            <hr className="mx-3 border-petrol-800" aria-hidden="true" />
          ) : null}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            const badge = badgeFor(badges, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                /*
                  `active:` da el cambio de estado en el mismo clic, antes de
                  que llegue la respuesta del servidor: quien está en el mesón
                  no se queda dudando si el toque quedó registrado.
                */
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors active:bg-petrol-700',
                  active
                    ? 'bg-petrol-800 font-semibold text-white'
                    : 'text-petrol-100 hover:bg-petrol-800/60',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{item.label}</span>
                {badge && badge > 0 ? <Badge value={badge} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
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
  badges,
}: {
  items: NavItem[];
  badges?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const [openMore, setOpenMore] = useState(false);

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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMore(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openMore]);

  const restHasBadge = restItems.some((item) => (badges?.[item.href] ?? 0) > 0);
  const restIsActive = restItems.some((item) => isActive(pathname, item.href));

  return (
    <>
      {openMore ? (
        <div className="fixed inset-0 z-40 lg:hidden no-print">
          <button
            type="button"
            className="absolute inset-0 bg-petrol-950/40"
            aria-label="Cerrar el menú"
            onClick={() => setOpenMore(false)}
          />
          <div className="absolute inset-x-0 bottom-[3.75rem] max-h-[70vh] overflow-y-auto rounded-t-2xl bg-white p-3 shadow-2xl">
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
            <ul className="space-y-1">
              {restItems.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                const badge = badgeFor(badges, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                        active
                          ? 'bg-petrol-50 text-petrol-900'
                          : 'text-slate-700 active:bg-slate-100',
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-petrol-600" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {badge && badge > 0 ? <Badge value={badge} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>

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
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden no-print"
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
              'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium transition-colors active:bg-petrol-50',
              active ? 'text-petrol-800' : 'text-slate-500',
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
          onClick={() => setOpenMore((open) => !open)}
          aria-expanded={openMore}
          className={cn(
            'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium transition-colors active:bg-petrol-50',
            openMore || restIsActive ? 'text-petrol-800' : 'text-slate-500',
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
