'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import {
  detailHrefWithListContext,
  listPositionKey,
  listReturnKey,
  listReturnLabel,
  readListPosition,
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

  useEffect(() => {
    let frame = 0;
    let position = null;
    let returning = false;
    const currentHref = href + window.location.hash;
    try {
      position = readListPosition(sessionStorage.getItem(listPositionKey(scope, href)));
      returning = sessionStorage.getItem(listReturnKey(scope)) === currentHref;
    } catch {
      // Storage can be disabled; native links and fragment navigation still work.
    }
    // A native Back may revisit a list whose fragment still names an earlier
    // row. The last activated row wins unless this is an explicit return.
    const anchor = window.location.hash.slice(1);
    setSelected(returning ? anchor || position?.rowAnchor || null : position?.rowAnchor || anchor || null);
    if (returning) {
      const saved = position;
      // Let Next complete its normal fragment navigation, then restore the exact
      // position only for the explicit return link. Back/Forward remain native.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const anchor = window.location.hash.slice(1);
          document.getElementById(anchor)?.focus({ preventScroll: true });
          if (saved?.rowAnchor === anchor) window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
          try { sessionStorage.removeItem(listReturnKey(scope)); } catch { /* optional storage */ }
        });
      });
    }
    return () => cancelAnimationFrame(frame);
  }, [href, scope]);

  function remember(rowAnchor: string) {
    setSelected(rowAnchor);
    try {
      sessionStorage.setItem(listPositionKey(scope, href), JSON.stringify({ rowAnchor, scrollY: window.scrollY }));
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
  return (
    <Link
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
    </Link>
  );
}

export function ListReturnLink({ href, scope }: { href: string; scope: string }) {
  function prepareReturn(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try { sessionStorage.setItem(listReturnKey(scope), href); } catch { /* native fragment fallback */ }
  }
  return (
    <Link
      href={href}
      onClick={prepareReturn}
      data-list-return
      className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {listReturnLabel(href)}
    </Link>
  );
}
