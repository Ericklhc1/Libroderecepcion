import type { HandoverLevel } from '@prisma/client';
export type PrintItem = { level: HandoverLevel; section: string; title: string; detail: string | null; refType: string | null; refId?: string | null };
const levels = { URGENTE: { priority: 'URG', order: 0 }, IMPORTANTE: { priority: 'IMP', order: 1 }, INFORMATIVO: { priority: 'INF', order: 2 } };

/** Defense for historic photographs, which retain their original rows in DB. */
export function isReceptionHandoverItem(item: Pick<PrintItem, 'refType' | 'section' | 'title'>) {
  return item.refType !== 'task' && item.section !== 'Tareas pendientes' &&
    !/^(?:[^:]+:\s*)?Validar cierre de turno$/i.test(item.title.trim()) &&
    !/supervisi[oó]n/i.test(item.section);
}
export function handoverPrintRows(items: PrintItem[]) {
  const grouped = new Map<string, { level: HandoverLevel; priority: string; order: number; ref: string; title: string; detail: string; due: string; count: number; refType: string | null }>();
  for (const item of items.filter(isReceptionHandoverItem)) {
    const match = item.title.match(/^#(\d+)\s+(.*)$/s);
    const ref = match?.[1] ?? '';
    const title = match?.[2] ?? item.title;
    const due = item.detail?.match(/(?:Vence|VENCIDA):\s*([^·]+)(?:\s*·|$)/)?.[1]?.trim() ?? '';
    const detail = (item.detail ?? '').replace(/\s*·?\s*(?:Vence|VENCIDA):\s*[^·]+/, '').replace(/\s*·?\s*Sin responsable asignado/, '').replace(/\s*·?\s*Área: Recepción/, '').trim();
    const key = JSON.stringify([item.level, ref, title, detail, due, item.refType]);
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { level: item.level, ...levels[item.level], ref, title, detail, due, count: 1, refType: item.refType });
  }
  return [...grouped.values()].sort((a, b) => a.order - b.order);
}
export function handoverPrintCounts(rows: ReturnType<typeof handoverPrintRows>) {
  return { urgente: rows.filter(r => r.level === 'URGENTE').reduce((n, r) => n + r.count, 0), importante: rows.filter(r => r.level === 'IMPORTANTE').reduce((n, r) => n + r.count, 0), informativo: rows.filter(r => r.level === 'INFORMATIVO').reduce((n, r) => n + r.count, 0) };
}
