import { readListPosition, type ListPosition } from './list-navigation';

export const WORKLIST_HISTORY_KEY = 'arohContextPanel';
export type WorklistPanelPosition = ListPosition & { href: string; scope: string };

/** Presentation-only marker, scoped to this user, exact list and visible rows. */
export function readWorklistPanelPosition(
  state: unknown,
  href: string,
  scope: string,
  rowIds: readonly string[],
): WorklistPanelPosition | null {
  if (!state || typeof state !== 'object') return null;
  const candidate = (state as Record<string, unknown>)[WORKLIST_HISTORY_KEY];
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Partial<WorklistPanelPosition>;
  if (typeof value.rowAnchor !== 'string' || typeof value.scrollY !== 'number') return null;
  const position = readListPosition(JSON.stringify({ rowAnchor: value.rowAnchor, scrollY: value.scrollY }));
  if (!position || value.href !== href || value.scope !== scope || !rowIds.includes(position.rowAnchor)) return null;
  return { ...position, href, scope };
}
