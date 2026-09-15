'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  BarChart3,
  BedDouble,
  BookOpen,
  CalendarClock,
  History,
  Home,
  ListChecks,
  Repeat,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { NavItem } from './nav-items';

const ICONS = {
  home: Home,
  book: BookOpen,
  shift: CalendarClock,
  task: ListChecks,
  incident: ShieldAlert,
  alert: AlertTriangle,
  followup: Repeat,
  guest: BedDouble,
  history: History,
  metrics: BarChart3,
  admin: Settings,
} as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({
  items,
  badges,
}: {
  items: NavItem[];
  badges?: Partial<Record<string, number>>;
}) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1" aria-label="Navegación principal">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        const badge = badges?.[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-petrol-800 font-semibold text-white'
                : 'text-petrol-100 hover:bg-petrol-800/60',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{item.label}</span>
            {badge && badge > 0 ? (
              <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[0.65rem] font-bold tabular text-petrol-950">
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </Link>
        );
      })}
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
              'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[0.65rem] font-medium',
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
