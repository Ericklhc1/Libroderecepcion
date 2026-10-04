'use client';

import { ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { detailHrefWithListContext, listPositionKey, listReturnKey, readListPosition, sameOperationalList } from '@/lib/list-navigation';
import { readWorklistPanelPosition, WORKLIST_HISTORY_KEY } from '@/lib/worklist-context';

export type ContextWorklistRow = {
  /** Canonical presentation anchor, e.g. registro-task-ID. Never an alternate entity ID. */
  id: string;
  title: string;
  /** Native record destination; works without JavaScript and in another tab. */
  href: string;
  /** Non-interactive summary supplied by the server. */
  summary: ReactNode;
  /** Existing details, linked records and authorized native forms, supplied by the server. */
  children: ReactNode;
  openLabel?: string;
  nativeLabel?: string;
  /** Historical fragment targets declared only for this authorized row. */
  fragmentTargets?: readonly string[];
};

export function ContextWorklist({ href, scope, label, rows, emptyMessage = 'No hay asuntos para estos filtros.', initialOpenId }: {
  href: string;
  scope: string;
  label: string;
  rows: ContextWorklistRow[];
  emptyMessage?: string;
  /** Deep links may open only a row already present in the authorized server response. */
  initialOpenId?: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const panelPosition = useRef<{ rowAnchor: string; scrollY: number } | null>(null);
  const closing = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const rowKey = rows.map(row => row.id).join('|');

  useEffect(() => {
    setHydrated(true);
    let frame = 0;
    const ids = rowsRef.current.map(row => row.id);
    const visible = (id: string | null | undefined) => id && ids.includes(id) ? id : null;
    const isCurrentList = () => sameOperationalList(window.location.pathname + window.location.search, href);
    const restore = (id: string, scrollY?: number, clearReturn = false) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          document.getElementById(id)?.focus({ preventScroll: true });
          if (scrollY !== undefined) window.scrollTo({ top: scrollY, behavior: 'instant' });
          if (clearReturn) { try { sessionStorage.removeItem(listReturnKey(scope)); } catch { /* optional storage */ } }
        });
      });
    };
    let saved = null;
    let returning = false;
    try {
      saved = readListPosition(sessionStorage.getItem(listPositionKey(scope, href)));
      returning = sessionStorage.getItem(listReturnKey(scope)) === href + window.location.hash;
    } catch { /* Native links, history and details do not require storage. */ }
    const anchor = visible(window.location.hash.slice(1));
    const fragmentRow = rowsRef.current.find(row => row.fragmentTargets?.includes(window.location.hash.slice(1)))?.id;
    setSelected((returning ? anchor : visible(saved?.rowAnchor)) || anchor);
    const marker = isCurrentList() ? readWorklistPanelPosition(window.history.state, href, scope, ids) : null;
    const historical = marker && window.location.hash === '#' + marker.rowAnchor ? marker : null;
    // A canonical row fragment is a return-to-list focus hint unless this
    // history entry was created by opening the panel itself.
    const initial = returning ? null : historical?.rowAnchor || (anchor ? null : visible(fragmentRow) || visible(initialOpenId));
    setPanelId(initial);
    if (initial) setSelected(initial);
    panelPosition.current = initial ? historical || { rowAnchor: initial, scrollY: window.scrollY } : null;
    if (returning && anchor) {
      restore(anchor, saved?.rowAnchor === anchor ? saved.scrollY : undefined, true);
    }

    const onHistory = () => {
      cancelAnimationFrame(frame);
      closing.current = false;
      if (!isCurrentList()) { setPanelId(null); return; }
      const position = readWorklistPanelPosition(window.history.state, href, scope, ids);
      if (position && window.location.hash === '#' + position.rowAnchor) {
        setSelected(position.rowAnchor);
        panelPosition.current = position;
        document.getElementById(position.rowAnchor)?.focus({ preventScroll: true });
        setPanelId(position.rowAnchor);
      } else {
        setPanelId(null);
        const last = panelPosition.current;
        if (last && visible(last.rowAnchor)) restore(last.rowAnchor, last.scrollY);
      }
    };
    window.addEventListener('popstate', onHistory);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('popstate', onHistory); };
  }, [href, scope, rowKey, initialOpenId]);

  useEffect(() => {
    const row = rowsRef.current.find(candidate => candidate.id === panelId);
    const fragment = window.location.hash.slice(1);
    if (!row?.fragmentTargets?.includes(fragment) || !/^[a-zA-Z0-9_-]+$/.test(fragment)) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const anchor = CSS.escape(fragment);
        const target = contentRef.current?.querySelector<HTMLElement>(`[id="${anchor}"], [data-worklist-anchor="${anchor}"]`);
        target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        target?.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [panelId, rowKey]);

  function remember(id: string) {
    setSelected(id);
    const position = { rowAnchor: id, scrollY: window.scrollY };
    try { sessionStorage.setItem(listPositionKey(scope, href), JSON.stringify(position)); } catch { /* optional storage */ }
    return position;
  }

  function openRow(event: MouseEvent<HTMLAnchorElement>, row: ContextWorklistRow) {
    // Preserve native new-tab/window, downloads and fallback navigation.
    if (!hydrated || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (panelId === row.id || closing.current) return;
    const position = remember(row.id);
    panelPosition.current = position;
    // Next's supported native-history adapter carries its router metadata. Do not
    // copy private router flags: that bypasses URL synchronization in the adapter.
    // This new entry stores only presentation context; the prior entry is intact.
    window.history.pushState({ [WORKLIST_HISTORY_KEY]: { ...position, href, scope } }, '', `${href}#${row.id}`);
    setPanelId(row.id);
  }

  function closePanel() {
    if (closing.current) return;
    const current = readWorklistPanelPosition(window.history.state, href, scope, rows.map(row => row.id));
    if (current && sameOperationalList(window.location.pathname + window.location.search, href)) {
      closing.current = true;
      window.history.back();
    } else {
      // A server-selected deep link has no panel-created entry to go back to.
      setPanelId(null);
      const position = panelPosition.current;
      if (position) requestAnimationFrame(() => {
        document.getElementById(position.rowAnchor)?.focus({ preventScroll: true });
        window.scrollTo({ top: position.scrollY, behavior: 'instant' });
      });
    }
  }

  const active = rows.find(row => row.id === panelId);
  const nativeHref = (row: ContextWorklistRow) => detailHrefWithListContext(row.href, href, row.id);
  function scrollWithinPanel(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    const fragment = link?.getAttribute('href');
    if (!link || link.target || link.hasAttribute('download') || !fragment || !/^#[a-zA-Z0-9_-]+$/.test(fragment)) return;
    const anchor = CSS.escape(fragment.slice(1));
    const target = event.currentTarget.querySelector<HTMLElement>(`[id="${anchor}"], [data-worklist-anchor="${anchor}"]`);
    if (!target) return;
    // A native fragment navigation would create a state-less history entry and
    // close the surrounding panel. Internal result anchors only scroll/focus.
    event.preventDefault();
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    target.focus({ preventScroll: true });
  }
  return (
    <section aria-label={label} data-context-worklist className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-petrol-900">{label}</h2>
        <p className="mt-1 text-xs text-slate-600">Consulta el contexto y continúa en el trabajo vinculado.</p>
      </header>
      {rows.length === 0 ? <p className="p-6 text-sm text-slate-600">{emptyMessage}</p> : <ul className="divide-y divide-slate-200">
        {rows.map(row => <li key={row.id}><article data-worklist-row={row.id}>
          <a
            id={row.id}
            href={nativeHref(row)}
            aria-label={row.openLabel || row.title}
            aria-haspopup={hydrated ? 'dialog' : undefined}
            aria-current={selected === row.id ? 'true' : undefined}
            data-list-item={row.id}
            onClick={event => openRow(event, row)}
            onAuxClick={() => remember(row.id)}
            className={cn('group flex scroll-mt-40 items-center gap-3 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-petrol-500', selected === row.id && 'bg-petrol-50 ring-2 ring-inset ring-petrol-300')}
          >
            <div className="min-w-0 flex-1">{row.summary}</div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          </a>
          <div className="px-4 pb-3"><a href={nativeHref(row)} onClick={() => remember(row.id)} className="inline-flex items-center gap-1 text-xs font-medium text-petrol-700 underline" data-worklist-native>{row.nativeLabel || 'Abrir ficha completa'}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a></div>
          {!hydrated && <noscript><details open={initialOpenId === row.id} className="border-t border-slate-100 px-4 py-3" data-worklist-fallback>
            <summary className="cursor-pointer text-sm font-medium">Consultar contexto y acciones</summary>
            <div className="mt-4 space-y-4">{row.children}</div>
          </details></noscript>}
        </article></li>)}
      </ul>}
      <Dialog open={Boolean(active)} onOpenChange={open => { if (!open) closePanel(); }} title={active?.title || 'Contexto del trabajo'} description="Información y acciones del registro original" presentation="side-panel">
        {active && <div ref={contentRef} className="min-w-0 space-y-5 break-words" data-worklist-panel={active.id} onClickCapture={scrollWithinPanel}>
          <a href={nativeHref(active)} onClick={() => remember(active.id)} className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 underline" data-worklist-native>{active.nativeLabel || 'Abrir ficha completa'}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
          {active.children}
          <div className="border-t border-slate-200 pt-4"><button type="button" onClick={closePanel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-petrol-800">Cancelar y volver a la lista</button></div>
        </div>}
      </Dialog>
    </section>
  );
}
