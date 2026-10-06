'use client';

import Link from 'next/link';
import { preserveScheduleContextHref } from '@/domain/schedule-navigation';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { NavGroup } from './nav-items';
import { activeDestination, badgeFor, navigationContext } from './navigation-state';
import { NAV_ICONS } from './navigation-icons';
import { secondaryDestinations } from './navigation-presentation';

type Props = { groups: NavGroup[]; badges?: Partial<Record<string, number>> };

export function DesktopNav(props: Props) {
  return <Suspense fallback={<div className="hidden h-14 lg:block" />}><DesktopModules {...props} /></Suspense>;
}

/** Navigation disclosures, not application menus: native links retain Tab and browser behavior. */
function DesktopModules({ groups, badges }: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = pathname + '?' + search;
  const current = navigationContext(groups, pathname, search);
  const [selection, setSelection] = useState<{ index: number; route: string } | null>(null);
  const openIndex = selection?.route === route ? selection.index : null;
  const openGroup = openIndex !== null ? groups[openIndex] : undefined;
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusEdge = useRef<'first' | 'last' | null>(null);
  const id = useId();

  // Do not resurrect an old disclosure when browser Back returns to its route.
  useEffect(() => { setSelection(null); setExpandedModule(null); }, [route]);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) { setSelection(null); setExpandedModule(null); } };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    if (openIndex === null) return;
    const trigger = triggerRefs.current[openIndex];
    const controls = panelRef.current?.querySelectorAll<HTMLElement>('[data-navigation-module] a[href], [data-navigation-module] button');
    if (focusEdge.current) (focusEdge.current === 'last' ? controls?.[controls.length - 1] : controls?.[0])?.focus();
    focusEdge.current = null;
    const close = (event: Event) => {
      if (event.type === 'keydown') {
        if ((event as KeyboardEvent).key !== 'Escape') return;
        event.preventDefault();
        setSelection(null);
        trigger?.focus();
        return;
      }
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || trigger?.contains(target))) return;
      setSelection(null);
    };
    const onResize = () => { if (window.innerWidth < 1024) setSelection(null); };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
      window.removeEventListener('resize', onResize);
    };
  }, [openIndex]);

  return <div className="hidden border-t border-petrol-200 lg:block" data-module-navigation="desktop">
    <nav aria-label="Módulos" className="relative mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-x-3 px-4 py-2">
      <div className="flex flex-wrap items-stretch gap-2">
        {groups.map((group, index) => {
          const first = group.items[0];
          if (!first) return null;
          const isCurrent = current.group === group;
          const label = group.title ?? first.label;
          const Icon = NAV_ICONS[first.icon];
          const count = group.items.reduce((sum, item) => sum + badgeFor(badges, item.href), 0);
          const className = cn('relative flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-colors',
            isCurrent || openIndex === index ? 'bg-petrol-950 ring-2 ring-petrol-400 ring-offset-2 ring-offset-[var(--aroh-topbar)]' : 'bg-petrol-800 hover:bg-petrol-900');
          if (!group.title && group.items.length === 1 && !first.menu?.length) return <Link key={first.href} href={preserveScheduleContextHref(first.href, pathname, search)}
            aria-current={isCurrent ? 'page' : undefined} className={className} onClick={() => setSelection(null)}>
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </Link>;
          return <button key={label + index} type="button" ref={node => { triggerRefs.current[index] = node; }}
            aria-label={label} aria-expanded={openIndex === index} aria-controls={openIndex === index ? id + '-panel' : undefined}
            data-active-module={isCurrent || undefined} className={className}
            onClick={() => { setExpandedModule(null); setSelection(openIndex === index ? null : { index, route }); }}
            onKeyDown={event => {
              if (event.key === 'Tab' && !event.shiftKey && openIndex === index) {
                event.preventDefault();
                panelRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
                return;
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              if (openIndex === index) {
                const links = panelRef.current?.querySelectorAll<HTMLElement>('[data-navigation-module] a[href], [data-navigation-module] button');
                (event.key === 'ArrowUp' ? links?.[links.length - 1] : links?.[0])?.focus();
              } else {
                setExpandedModule(null);
                focusEdge.current = event.key === 'ArrowUp' ? 'last' : 'first';
                setSelection({ index, route });
              }
            }}>
            <Icon className="h-4 w-4" aria-hidden="true" /><span>{label}</span>
            {count > 0 ? <span className="rounded-full bg-petrol-100 px-1.5 text-xs font-semibold text-petrol-950">{count > 99 ? '99+' : count}</span> : null}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', openIndex === index && 'rotate-180')} aria-hidden="true" />
          </button>;
        })}
      </div>
      {current.item ? <p className="ml-auto flex min-h-10 min-w-0 max-w-full items-center gap-2 py-2 text-xs text-petrol-700" aria-label="Módulo actual">
        <span className="font-semibold text-petrol-900">{current.item.label}</span>
        {current.destinationLabel && current.destinationLabel !== current.item.label ? <><ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" /><span>{current.destinationLabel}</span></> : null}
      </p> : null}
      {openGroup ? <div ref={panelRef} id={id + '-panel'} aria-label={'Accesos de ' + openGroup.title}
        className="nav-dropdown-enter absolute left-4 top-full z-50 mt-1 w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xl"
        onKeyDown={event => {
          if (event.key === 'Tab' && event.shiftKey && document.activeElement === event.currentTarget.querySelector('button, a[href]')) {
            event.preventDefault();
            setSelection(null);
            if (openIndex !== null) triggerRefs.current[openIndex]?.focus();
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const links = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-navigation-module] a[href], [data-navigation-module] button')];
          const index = links.indexOf(document.activeElement as HTMLElement);
          if (index < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
          links[next]?.focus();
        }}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
          <p className="text-sm font-semibold text-petrol-900">{openGroup.title}</p>
          <button type="button" className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar accesos" onClick={() => { setSelection(null); if (openIndex !== null) triggerRefs.current[openIndex]?.focus(); }}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="max-h-[min(65dvh,36rem)] space-y-1 overflow-y-auto overscroll-contain p-2">
          {openGroup.items.map((item, itemIndex) => {
            const Icon = NAV_ICONS[item.icon];
            const active = current.item?.href === item.href;
            const destination = active ? activeDestination(item, pathname, search) : null;
            const sections = secondaryDestinations(item);
            const expanded = expandedModule === item.href;
            const count = badgeFor(badges, item.href);
            return <div key={item.href} className="min-w-0" data-navigation-module={item.href}>
              <div className={cn('flex items-center rounded-md', active ? 'bg-petrol-50' : 'hover:bg-slate-50')}>
                <Link href={preserveScheduleContextHref(item.href, pathname, search)} onClick={() => setSelection(null)} aria-current={destination === item.href ? 'page' : undefined}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-petrol-900 hover:bg-petrol-50">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{item.label}</span>
                  {count > 0 ? <span className="ml-auto rounded-full bg-petrol-100 px-1.5 text-xs text-petrol-950">{count > 99 ? '99+' : count}</span> : null}
                </Link>
                {sections.length > 0 ? <button type="button" aria-label={'Vistas de ' + item.label} aria-expanded={expanded}
                  aria-controls={expanded ? id + '-views-' + itemIndex : undefined}
                  onClick={() => setExpandedModule(expanded ? null : item.href)}
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium text-petrol-700 hover:bg-petrol-100">
                  Vistas<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
                </button> : null}
              </div>
              {expanded ? <div id={id + '-views-' + itemIndex} className="mb-2 ml-5 border-l border-petrol-200 py-1 pl-3">
                {sections.map((section, sectionIndex) => <div key={section.title + sectionIndex}>
                  <h2 className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">{section.title}</h2>
                  {section.items.map(link => <Link key={link.href} href={preserveScheduleContextHref(link.href, pathname, search)} onClick={() => setSelection(null)}
                    aria-current={destination === link.href ? 'page' : undefined} title={link.description}
                    className={cn('flex min-h-11 items-center rounded-md px-3 py-2 text-sm hover:bg-slate-100', destination === link.href ? 'bg-petrol-50 font-semibold text-petrol-900' : 'text-slate-700')}>
                    {link.label}
                  </Link>)}
                </div>)}
              </div> : null}
            </div>;
          })}
        </div>
      </div> : null}
    </nav>
  </div>;
}
