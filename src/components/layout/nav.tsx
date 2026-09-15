'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BedDouble,
  BookOpen,
  CalendarClock,
  DoorClosed,
  History,
  Home,
  KeyRound,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/cn';
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
  admin: Settings,
} as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Badge({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular text-petrol-950">
      {value > 99 ? '99+' : value}
    </span>
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
            const badge = badges?.[item.href];
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
export function MobileNav({
  items,
  badges,
}: {
  items: NavItem[];
  badges?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  const mobileItems = items.filter((item) => item.mobile).slice(0, 5);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden no-print"
      aria-label="Navegación rápida"
    >
      {mobileItems.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        const badge = badges?.[item.href];
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
            <span className="truncate">{item.label.split(' ')[0]}</span>
            {badge && badge > 0 ? (
              <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
            ) : null}
            {active ? (
              <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-gold-500" aria-hidden="true" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
