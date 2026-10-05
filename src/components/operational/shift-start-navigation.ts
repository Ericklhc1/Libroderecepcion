'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/server/action';

type ShiftStartAction = (state: ActionState | null, form: FormData) => Promise<ActionState>;
type ShiftStartMode = 'handover' | 'reception';

/** Only the two shift-start forms use this adapter; server actions stay unchanged. */
export function createShiftStartAction(
  action: ShiftStartAction,
  mode: ShiftStartMode,
  navigate: (href: string) => void,
): ShiftStartAction {
  let pending: Promise<ActionState> | null = null;
  let committed: Extract<ActionState, { ok: true }> | null = null;

  return (state, form) => {
    // React can queue a second submit before the pending button paints. A
    // committed start is not repeated even if that queued call arrives later.
    if (committed) return Promise.resolve(committed);
    if (pending) return pending;

    const source = window.location.href;
    const navigation = window.navigation;
    const entryKey = navigation?.currentEntry?.key;
    let superseded = false;
    const cancelNavigation = () => { superseded = true; };
    const changedEntry = () => {
      if (window.location.href !== source || (entryKey && navigation?.currentEntry?.key !== entryKey)) {
        cancelNavigation();
      }
    };
    const navigateAway = (event: NavigateEvent) => {
      if (event.destination.url !== source) cancelNavigation();
    };
    const followLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      // Record intent before a slow client-route transition changes the URL.
      // Do not prevent the link, rewrite history, or clear shell/Fronti state.
      if (link.href !== source) cancelNavigation();
    };
    document.addEventListener('click', followLink, true);
    window.addEventListener('popstate', cancelNavigation);
    window.addEventListener('hashchange', cancelNavigation);
    window.addEventListener('pagehide', cancelNavigation);
    navigation?.addEventListener('navigate', navigateAway);
    navigation?.addEventListener('currententrychange', changedEntry);

    let listening = true;
    const cleanup = () => {
      if (!listening) return;
      listening = false;
      document.removeEventListener('click', followLink, true);
      window.removeEventListener('popstate', cancelNavigation);
      window.removeEventListener('hashchange', cancelNavigation);
      window.removeEventListener('pagehide', cancelNavigation);
      navigation?.removeEventListener('navigate', navigateAway);
      navigation?.removeEventListener('currententrychange', changedEntry);
    };
    pending = (async () => {
      try {
        const result = await Promise.resolve().then(() => action(state, form));
        if (result.ok) committed = result;
        changedEntry();
        // Revalidation may already have unmounted the form. Its explicit
        // successful result can still advance the same, uninterrupted visit.
        if (result.ok && result.id && !superseded) {
          cleanup();
          navigate(`/turno/entrega/${encodeURIComponent(result.id)}${mode === 'handover' ? '?paso=1' : ''}`);
        }
        return result;
      } finally {
        cleanup();
        pending = null;
      }
    })();
    return pending;
  };
}

export function useShiftStartNavigation(action: ShiftStartAction, mode: ShiftStartMode, recordId: string) {
  const router = useRouter();
  const current = useRef<{
    action: ShiftStartAction;
    mode: ShiftStartMode;
    recordId: string;
    router: typeof router;
    run: ShiftStartAction;
  } | null>(null);
  if (!current.current || current.current.action !== action || current.current.mode !== mode || current.current.recordId !== recordId || current.current.router !== router) {
    current.current = { action, mode, recordId, router, run: createShiftStartAction(action, mode, href => router.push(href)) };
  }
  return current.current.run;
}
