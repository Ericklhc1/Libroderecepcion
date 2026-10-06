/** Serialización legible de evidencia JSON. No interpreta causas ni modifica el original. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join('; ') : 'Sin elementos';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${formatAuditValue(item)}`)
      .join(' · ') || 'Sin cambios';
  }
  return String(value);
}
