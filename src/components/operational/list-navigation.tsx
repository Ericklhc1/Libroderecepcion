'use client';

import { ArrowLeft } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  detailHrefWithListContext,
  listPositionKey,
  listReturnKey,
  listReturnLabel,
  readListPosition,
  sameOperationalList,
  type ListPosition,
} from '@/lib/list-navigation';

type ListContextValue = {
  href: string;
  selected: string | null;
  remember: (rowAnchor: string) => void;
};
const ListContext = createContext<ListContextValue | null>(null);

/** Per-tab presentation state only. No operational records or history rewriting. */
export function ListNavigation({ href, scope, children }: {
  href: string;
  scope: string;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const traversalHref = useRef<string | null>(null);

  useEffect(() => {
    let frame = 0;
    let pagePosition: ListPosition | null = null;
    const historyKey = () => {
      const entryKey = window.navigation?.currentEntry?.key;
      return entryKey ? `${listPositionKey(scope, href)}:history:${entryKey}` : null;
    };
    const restore = (fromHistory: boolean, cachedPosition: ListPosition | null = null) => {
      cancelAnimationFrame(frame);
      let position = null;
      let historyPosition = cachedPosition;
      let returning = false;
      try {
        position = readListPosition(sessionStorage.getItem(listPositionKey(scope, href)));
        const key = historyKey();
        if (!historyPosition && key) historyPosition = readListPosition(sessionStorage.getItem(key));
        returning = sessionStorage.getItem(listReturnKey(scope)) === href + window.location.hash;
      } catch {
        // Storage can be disabled; native links and fragment navigation still work.
      }
      // A native Back may revisit a list whose fragment still names an earlier
      // row. The last activated row wins unless this is an explicit return.
      const anchor = window.location.hash.slice(1);
      const selectedAnchor = returning ? anchor || position?.rowAnchor || null : position?.rowAnchor || anchor || null;
      if (!returning && !fromHistory) { setSelected(selectedAnchor); return; }
      // Repeated visits to the same filtered URL are different history entries.
      // Never restore another visit's scroll. Older browsers without entry keys
      // keep native restoration, except for a cached document's own snapshot.
      const saved = returning ? position : historyPosition;
      // A restored document can paint before the hydrated list has its full
      // height. Restore presentation after layout, without rewriting history or
      // changing the browser's scroll-restoration mode. Only explicit returns
      // move focus; native Back/Forward keep their normal focus behavior.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const target = selectedAnchor ? document.getElementById(selectedAnchor) : null;
          if (returning) target?.focus({ preventScroll: true });
          if (saved && document.getElementById(saved.rowAnchor) && (!returning || saved.rowAnchor === selectedAnchor)) {
            window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
          }
          setSelected(selectedAnchor);
          if (returning) { try { sessionStorage.removeItem(listReturnKey(scope)); } catch { /* optional storage */ } }
        });
      });
    };
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    // The original navigation entry survives later client-route changes. Apply
    // its history signal only to the document URL it actually loaded.
    const documentHref = navigation ? new URL(navigation.name) : null;
    const clientTraversal = traversalHref.current !== null && sameOperationalList(traversalHref.current, href);
    traversalHref.current = null;
    restore(clientTraversal || (navigation?.type === 'back_forward' && documentHref?.pathname === window.location.pathname && documentHref?.search === window.location.search));
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) restore(true, pagePosition); };
    const onHistory = () => {
      cancelAnimationFrame(frame);
      traversalHref.current = window.location.pathname + window.location.search;
      // Query-only client traversals may update the href prop after popstate.
      // Keep that signal until this component renders the destination list.
      if (!sameOperationalList(traversalHref.current, href)) return;
      traversalHref.current = null;
      restore(true);
    };
    const onPageHide = () => {
      try {
        const last = readListPosition(sessionStorage.getItem(listPositionKey(scope, href)));
        if (!last || !document.getElementById(last.rowAnchor)) return;
        pagePosition = { rowAnchor: last.rowAnchor, scrollY: window.scrollY };
        const key = historyKey();
        if (key) sessionStorage.setItem(key, JSON.stringify(pagePosition));
      } catch { /* optional storage */ }
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('popstate', onHistory);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('popstate', onHistory);
    };
  }, [href, scope]);

  function remember(rowAnchor: string) {
    setSelected(rowAnchor);
    try {
      const position = JSON.stringify({ rowAnchor, scrollY: window.scrollY });
      sessionStorage.setItem(listPositionKey(scope, href), position);
      const entryKey = window.navigation?.currentEntry?.key;
      if (entryKey) sessionStorage.setItem(`${listPositionKey(scope, href)}:history:${entryKey}`, position);
    } catch { /* optional storage */ }
  }

  return <ListContext.Provider value={{ href, selected, remember }}>{children}</ListContext.Provider>;
}

export function ListItemLink({ href, rowAnchor, className, children }: {
  href: string;
  rowAnchor: string;
  className?: string;
  children: ReactNode;
}) {
  const context = useContext(ListContext);
  const selected = context?.selected === rowAnchor;
  // Keep this boundary document-native: CI reproduced activated client links
  // remaining on the source route. Saving context must not gate navigation on
  // the RSC transition; the browser owns activation, new tabs and history.
  return (
    <a
      id={rowAnchor}
      href={context ? detailHrefWithListContext(href, context.href, rowAnchor) : href}
      onClick={() => context?.remember(rowAnchor)}
      onAuxClick={() => context?.remember(rowAnchor)}
      data-list-item={rowAnchor}
      aria-current={selected ? 'true' : undefined}
      className={cn('scroll-mt-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-petrol-500', className,
        !context?.selected && 'target:bg-petrol-50 target:ring-2 target:ring-inset target:ring-petrol-300',
        selected && 'bg-petrol-50 ring-2 ring-inset ring-petrol-300')}
    >
      {children}
    </a>
  );
}

export function ListReturnLink({ href, scope }: { href: string; scope: string }) {
  function prepareReturn(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try { sessionStorage.setItem(listReturnKey(scope), href); } catch { /* native fragment fallback */ }
  }
  return (
    <a
      href={href}
      onClick={prepareReturn}
      data-list-return
      className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {listReturnLabel(href)}
    </a>
  );
}
