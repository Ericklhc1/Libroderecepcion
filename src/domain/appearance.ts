/** Browser-only presentation preference. It never represents a user or permission. */
export const APPEARANCE_STORAGE_KEY = 'aroh.appearance.v1';
export const APPEARANCE_OPTIONS = ['light', 'dark', 'system'] as const;
export type AppearancePreference = (typeof APPEARANCE_OPTIONS)[number];
export type ResolvedAppearance = Exclude<AppearancePreference, 'system'>;

export function parseAppearance(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemDark: boolean,
): ResolvedAppearance {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function readAppearance(storage: Pick<Storage, 'getItem'> | null): AppearancePreference {
  try {
    return parseAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function saveAppearance(
  storage: Pick<Storage, 'setItem'> | null,
  preference: AppearancePreference,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(APPEARANCE_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

/**
 * Self-contained because it runs in <head>, before React and the first paint.
 * Storage and matchMedia can be blocked independently. No user text enters it.
 */
function initializeAppearance(storageKey: string) {
  let preference = 'system';
  let systemDark = false;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark') preference = stored;
  } catch { /* A private/restricted browser still gets a usable theme. */ }
  try {
    systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { /* Light is the safe fallback without media-query support. */ }
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.theme = theme;
}

export const APPEARANCE_INIT_SCRIPT = `(${initializeAppearance.toString()})(${JSON.stringify(APPEARANCE_STORAGE_KEY)});`;
