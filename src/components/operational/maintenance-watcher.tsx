'use client';
import { useEffect } from 'react';

/** Refresh already open supported clients; the server remains the actual barrier. */
export function MaintenanceWatcher() {
  useEffect(() => {
    let pending = false;
    let disposed = false;
    const check = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const response = await fetch('/api/maintenance', { cache: 'no-store' });
        if (response.ok) {
          const state = await response.json() as { enabled?: boolean };
          if (!disposed && state.enabled === true) window.location.assign('/mantenimiento');
        }
      } catch { /* A failed poll never grants access; requests remain server-guarded. */ }
      finally { pending = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  return null;
}
