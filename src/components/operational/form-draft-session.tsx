'use client';
import { useEffect } from 'react';
import { clearFormDraftStorage } from '@/domain/form-draft';

export function FormDraftSession({ userId }: { userId: string }) {
  useEffect(() => {
    try {
      const key = 'aroh:form-draft-user';
      if (sessionStorage.getItem(key) !== userId) clearFormDraftStorage(sessionStorage);
      sessionStorage.setItem(key, userId);
    } catch { /* Browsers may reject session storage; forms disclose the fallback. */ }
    const logout = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement) || !event.target.hasAttribute('data-clear-form-drafts')) return;
      try { clearFormDraftStorage(sessionStorage); sessionStorage.removeItem('aroh:form-draft-user'); } catch { /* Optional storage. */ }
      window.dispatchEvent(new Event('aroh:clear-form-drafts'));
    };
    document.addEventListener('submit', logout, true);
    return () => document.removeEventListener('submit', logout, true);
  }, [userId]);
  return null;
}

export function ClearHandoverDrafts({ handoverId }: { handoverId: string }) {
  useEffect(() => {
    try { clearFormDraftStorage(sessionStorage, handoverId); } catch { /* Optional storage. */ }
  }, [handoverId]);
  return null;
}
