/** Presentation only: originals remain available with their own links and read state. */
export function groupDisplayRows<T>(rows: readonly T[], key: (row: T) => string): Array<{ row: T; items: T[] }> {
  const groups: Array<{ row: T; items: T[] }> = [];
  const index = new Map<string, { row: T; items: T[] }>();
  for (const row of rows) {
    const k = key(row);
    const existing = index.get(k);
    if (existing) existing.items.push(row);
    else { const group = { row, items: [row] }; index.set(k, group); groups.push(group); }
  }
  return groups;
}
