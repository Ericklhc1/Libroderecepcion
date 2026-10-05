'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  parseAppearance,
  resolveAppearance,
  saveAppearance,
  type AppearancePreference,
} from '@/domain/appearance';

type AppearanceContextValue = {
  preference: AppearancePreference;
  persisted: boolean;
  setPreference: (preference: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function systemPrefersDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

function applyAppearance(preference: AppearancePreference, systemDark = systemPrefersDark()) {
  const theme = resolveAppearance(preference, systemDark);
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.theme = theme;
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  // The head script already painted the correct theme. A stable server snapshot
  // prevents a hydration mismatch in controls, even without browser storage.
  const [preference, updatePreference] = useState<AppearancePreference>('system');
  const [persisted, setPersisted] = useState(true);
  const currentPreference = useRef<AppearancePreference>('system');

  const setPreference = useCallback((next: AppearancePreference) => {
    currentPreference.current = next;
    updatePreference(next);
    applyAppearance(next);
    setPersisted(saveAppearance(browserStorage(), next));
  }, []);

  useEffect(() => {
    const initial = parseAppearance(document.documentElement.dataset.appearance);
    currentPreference.current = initial;
    updatePreference(initial);
    applyAppearance(initial);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== browserStorage()) return;
      const next = parseAppearance(event.newValue);
      currentPreference.current = next;
      updatePreference(next);
      setPersisted(true);
      applyAppearance(next);
    };
    const onSystemChange = (event: MediaQueryListEvent) => {
      if (currentPreference.current === 'system') applyAppearance('system', event.matches);
    };

    let media: MediaQueryList | undefined;
    try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch { /* Optional browser API. */ }
    if (media?.addEventListener) media.addEventListener('change', onSystemChange);
    else media?.addListener?.(onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      if (media?.removeEventListener) media.removeEventListener('change', onSystemChange);
      else media?.removeListener?.(onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <AppearanceContext.Provider value={{ preference, persisted, setPreference }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('AppearancePreference requires AppearanceProvider');
  return context;
}
