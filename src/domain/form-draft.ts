export type DraftControl = { value: string; checked: boolean; selected: string[] | null };
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_DRAFT_BYTES = 32_000;

/** Only explicitly selected non-secret text/quantity controls are eligible. */
export function encodeFormDraft(values: Map<string, DraftControl>, fields: string[], now = Date.now(), revision: string | null = null): string {
  const allowed = new Set(fields);
  return JSON.stringify({ version: 1, savedAt: now, revision, values: [...values].filter(([key]) => allowed.has(key.replace(/#\d+$/, ''))) });
}

export function decodeFormDraft(raw: string | null, fields: string[], now = Date.now()): Map<string, DraftControl> | null {
  if (!raw || raw.length > MAX_DRAFT_BYTES) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !Number.isFinite(parsed.savedAt) || parsed.savedAt > now || now - parsed.savedAt > MAX_AGE_MS || !Array.isArray(parsed.values)) return null;
    const allowed = new Set(fields);
    const values = new Map<string, DraftControl>();
    for (const row of parsed.values) {
      if (!Array.isArray(row) || row.length !== 2) continue;
      const [key, item] = row;
      if (typeof key !== 'string' || !allowed.has(key.replace(/#\d+$/, '')) || !item || typeof item.value !== 'string' || item.value.length > 4_000) continue;
      // A local draft never restores a physical confirmation or permission.
      values.set(key, { value: item.value, checked: false, selected: null });
    }
    return values.size ? values : null;
  } catch { return null; }
}

export const FORM_DRAFT_PREFIX = 'aroh:form-draft:v1:';
export function formDraftRevision(raw: string | null): string | null {
  try { const value = JSON.parse(raw ?? 'null'); return typeof value?.revision === 'string' ? value.revision : null; } catch { return null; }
}
/** Removes only this feature's drafts; never clears other browser preferences/data. */
export function clearFormDraftStorage(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, handoverId?: string): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key?.startsWith(FORM_DRAFT_PREFIX) && (!handoverId || key.split(':').includes(handoverId))) storage.removeItem(key);
  }
}
