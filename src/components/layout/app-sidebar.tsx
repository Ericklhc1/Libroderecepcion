'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Home, BookOpen, CalendarClock, ShieldCheck, BedDouble, History, BarChart3, DoorClosed, KeyRound, Banknote, AlarmClock, Settings } from 'lucide-react';
import type { NavGroup, NavItem } from './nav-items';
import { cn } from '@/lib/cn';

const icons = { home: Home, book: BookOpen, shift: CalendarClock, supervision: ShieldCheck, guest: BedDouble, history: History, metrics: BarChart3, room: DoorClosed, key: KeyRound, cash: Banknote, alarm: AlarmClock, admin: Settings };

export function activeModule(groups: NavGroup[], pathname: string): string | null {
  const candidates = groups.flatMap(group => group.items).flatMap(item =>
    [item.href, ...(item.menu ?? []).flatMap(section => section.items.map(link => link.href))]
      .map(href => ({ root: item.href, path: href.split(/[?#]/)[0] ?? href, primary: href === item.href }))
  ).filter(candidate => candidate.path === '/' ? pathname === '/' :
    pathname === candidate.path || pathname.startsWith(candidate.path + '/'));
  return candidates.sort((a, b) => b.path.length - a.path.length || Number(b.primary) - Number(a.primary))[0]?.root ?? null;
}

export function activeDestination(item: NavItem, pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const candidates = [item.href, ...(item.menu ?? []).flatMap(section => section.items.map(link => link.href))];
  return candidates.filter(href => {
    if (href.includes('#')) return false;
    const url = new URL(href, 'https://navigation.invalid');
    return url.pathname === pathname && [...url.searchParams].every(([key, value]) => params.get(key) === value);
  }).sort((a, b) => new URL(b, 'https://navigation.invalid').searchParams.size - new URL(a, 'https://navigation.invalid').searchParams.size)[0] ?? null;
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className="rounded-full bg-gold-500 px-1.5 text-xs font-semibold text-petrol-950">{value > 99 ? '99+' : value}</span> : null;
}

type Props = { groups: NavGroup[]; badges?: Partial<Record<string, number>>; compact?: boolean; light?: boolean; onNavigate?: () => void };

export function GroupedNav(props: Props) {
  return <Suspense fallback={<nav aria-label="Cargando navegación" />}><Navigation {...props} /></Suspense>;
}

function Navigation({ groups, badges, compact = false, light = false, onNavigate }: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = pathname + '?' + search;
  const active = activeModule(groups, pathname);
  const activeGroup = groups.findIndex(group => group.title && group.items.some(item => item.href === active));
  // Route-scoped state follows navigation, while manual closing stays closed on the current page.
  const [selection, setSelection] = useState<{ route: string; group: number | null; item: string | null } | null>(null);
  const openGroup = selection?.route === route ? selection.group : activeGroup >= 0 ? activeGroup : null;
  const openItem = selection?.route === route ? selection.item : null;
  const [flyout, setFlyout] = useState<{ item: NavItem; route: string; left: number; top: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const currentFlyout = compact && flyout?.route === route ? flyout : null;

  useEffect(() => {
    if (!currentFlyout) return;
    const close = (event: Event) => {
      if (event.type === 'keydown') {
        if ((event as KeyboardEvent).key !== 'Escape') return;
        triggerRef.current?.focus();
      } else if ((event.type === 'pointerdown' || event.type === 'scroll') && (flyoutRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node))) return;
      setFlyout(null);
    };
    flyoutRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [currentFlyout]);

  const badge = (item: NavItem) => badges?.[item.href] ?? badges?.[item.href.split(/[?#]/)[0] ?? item.href] ?? 0;
  const row = cn('flex min-h-10 items-center gap-2 rounded-md border-l-2 px-3 py-2 text-sm font-medium',
    light ? 'border-transparent text-slate-700 hover:bg-slate-100' : 'border-transparent text-petrol-200 hover:border-petrol-700 hover:bg-petrol-900');
  const selected = light ? 'bg-petrol-50 text-petrol-900' : 'border-gold-500 bg-petrol-800 text-white';
  const destinations = (item: NavItem) => <div className="space-y-1">
    {item.menu?.map((section, index) => <div key={section.title + index}>
      <p className={cn('px-3 pt-2 text-xs font-semibold', light || compact ? 'text-slate-500' : 'text-petrol-400')}>{section.title}</p>
      {section.items.map(subitem => <Link key={subitem.href} href={subitem.href}
        onClick={() => { setFlyout(null); onNavigate?.(); }}
        aria-current={activeDestination(item, pathname, search) === subitem.href ? 'page' : undefined}
        className={cn('block rounded-md px-3 py-2 text-sm', light || compact ? 'text-slate-700 hover:bg-slate-100' : 'text-petrol-200 hover:bg-petrol-900',
          activeDestination(item, pathname, search) === subitem.href && (light || compact ? 'bg-petrol-50 font-semibold' : 'bg-petrol-800 font-semibold'))}>
        {subitem.label}
      </Link>)}
    </div>)}
  </div>;

  const moduleRow = (item: NavItem, groupIndex: number) => {
    const Icon = icons[item.icon];
    const hasMenu = !!item.menu?.length;
    if (compact) return <div key={item.href} className="relative">
      {hasMenu ? <button type="button" title={item.label} aria-label={item.label}
        aria-expanded={currentFlyout?.item.href === item.href} aria-controls={currentFlyout?.item.href === item.href ? id + '-flyout' : undefined}
        onClick={event => {
          if (currentFlyout?.item.href === item.href) { setFlyout(null); return; }
          triggerRef.current = event.currentTarget;
          const rect = event.currentTarget.getBoundingClientRect();
          setFlyout({ item, route, left: Math.min(rect.right + 8, window.innerWidth - 332), top: Math.max(12, Math.min(rect.top, window.innerHeight - 360)) });
        }} className={cn(row, 'w-full justify-center px-2', active === item.href && selected)}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      </button> : <Link href={item.href} onClick={onNavigate} title={item.label} aria-label={item.label} aria-current={active === item.href ? 'page' : undefined}
        className={cn(row, 'justify-center px-2', active === item.href && selected)}><Icon className="h-5 w-5" aria-hidden="true" /></Link>}
      {badge(item) > 0 ? <span className="pointer-events-none absolute right-0 top-0"><Count value={badge(item)} /></span> : null}
    </div>;
    return <div key={item.href}>
      <div className="flex items-center">
        <Link href={item.href} onClick={onNavigate} className={cn(row, 'min-w-0 flex-1', active === item.href && selected)}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{item.label}</span><Count value={badge(item)} />
        </Link>
        {hasMenu ? <button type="button" aria-label={'Opciones de ' + item.label} aria-expanded={openItem === item.href}
          aria-controls={openItem === item.href ? id + '-module-' + groupIndex + '-' + groupIndexForItem(item) : undefined}
          className={cn('rounded p-2', light ? 'text-slate-600' : 'text-petrol-300')}
          onClick={() => setSelection({ route, group: groupIndex, item: openItem === item.href ? null : item.href })}>
          <ChevronDown className={cn('h-4 w-4', openItem === item.href && 'rotate-180')} aria-hidden="true" />
        </button> : null}
      </div>
      {hasMenu && openItem === item.href ? <div id={id + '-module-' + groupIndex + '-' + groupIndexForItem(item)} className="ml-4 border-l border-petrol-700 pl-1">{destinations(item)}</div> : null}
    </div>;
  };
  function groupIndexForItem(item: NavItem) { return groups.flatMap(group => group.items).findIndex(candidate => candidate.href === item.href); }

  return <nav aria-label="Navegación principal" className="space-y-2">
    {groups.map((group, index) => {
      if (compact) return <div key={group.title ?? 'principal'} className={cn('space-y-1', index > 0 && 'border-t border-petrol-800 pt-2')}>{group.items.map(item => moduleRow(item, index))}</div>;
      if (!group.title) return <div key="principal">{group.items.map(item => moduleRow(item, index))}</div>;
      const single = group.items.length === 1 ? group.items[0] : null;
      if (single && !single.menu?.length) return <div key={group.title}>{moduleRow(single, index)}</div>;
      return <div key={group.title} onKeyDown={event => {
        if (event.key === 'Escape' && openGroup === index) {
          event.stopPropagation();
          setSelection({ route, group: null, item: null });
          event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus();
        }
      }}>
        <button type="button" aria-expanded={openGroup === index} aria-controls={openGroup === index ? id + '-group-' + index : undefined}
          className={cn(row, 'w-full text-left', activeGroup === index && selected)}
          onClick={() => setSelection({ route, group: openGroup === index ? null : index, item: null })}>
          <span className="flex-1">{group.title}</span><Count value={group.items.reduce((total, item) => total + badge(item), 0)} />
          <ChevronDown className={cn('h-4 w-4', openGroup === index && 'rotate-180')} aria-hidden="true" />
        </button>
        {openGroup === index ? <div id={id + '-group-' + index} className="mt-1 space-y-1">
          {single?.menu?.length ? destinations(single) : group.items.map(item => moduleRow(item, index))}
        </div> : null}
      </div>;
    })}
    {currentFlyout && typeof document !== 'undefined' ? createPortal(<div ref={flyoutRef} id={id + '-flyout'}
      aria-label={'Opciones de ' + currentFlyout.item.label} className="fixed z-50 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
      style={{ left: currentFlyout.left, top: currentFlyout.top, maxHeight: 'calc(100dvh - ' + (currentFlyout.top + 12) + 'px)' }}>
      <Link href={currentFlyout.item.href} onClick={() => setFlyout(null)} className="block rounded-md px-3 py-2 font-semibold text-petrol-900 hover:bg-slate-100">Abrir {currentFlyout.item.label}</Link>
      {destinations(currentFlyout.item)}
    </div>, document.body) : null}
  </nav>;
}

export function AppSidebar({ groups, badges, hotelName, version, userId }: Props & { hotelName: string; version: string; userId: string }) {
  const [compact, setCompact] = useState(false);
  const storageKey = 'aroh:sidebar:v1:' + userId;
  useEffect(() => { try { setCompact(localStorage.getItem(storageKey) === 'compact'); } catch { /* Preference is optional. */ } }, [storageKey]);
  const toggle = () => {
    const next = !compact;
    try { localStorage.setItem(storageKey, next ? 'compact' : 'expanded'); } catch { /* Storage disabled. */ }
    setCompact(next);
  };
  return <aside className={cn('sticky top-0 hidden h-dvh shrink-0 self-start flex-col border-r border-petrol-800 bg-petrol-950 lg:flex no-print', compact ? 'w-16' : 'w-56')}>
    <Link href="/" title={'AROH Central IA · ' + hotelName} className="block shrink-0 border-b border-petrol-800 px-3 py-4">
      {compact ? <span className="block text-center font-semibold text-gold-400">A</span> : <><span className="block truncate text-base text-white">AROH <span className="font-semibold text-gold-400">Central IA</span></span><span className="mt-1 block truncate text-xs text-petrol-300">{hotelName}</span></>}
    </Link>
    <button type="button" onClick={toggle} aria-label={compact ? 'Ampliar barra lateral' : 'Reducir barra lateral a iconos'} aria-expanded={!compact}
      title={compact ? 'Ampliar barra lateral' : 'Reducir barra lateral'} className="m-2 flex items-center justify-center gap-2 rounded p-2 text-petrol-200 hover:bg-petrol-800">
      {compact ? <PanelLeftOpen className="h-5 w-5" /> : <><PanelLeftClose className="h-5 w-5" /><span className="text-xs">Reducir menú</span></>}
    </button>
    <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain py-2', compact ? 'px-2' : 'px-3')}>
      <GroupedNav groups={groups} badges={badges} compact={compact} />
    </div>
    <div className="shrink-0 border-t border-petrol-800 px-3 py-3" title={'AROH Central IA v' + version}>
      {!compact ? <p className="text-xs text-petrol-400">Opera con sentido.</p> : null}
      <p className="mt-1 truncate text-[0.62rem] text-petrol-500">v{version}</p>
    </div>
  </aside>;
}
