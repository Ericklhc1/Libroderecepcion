import type { NotificationFeedItem } from './notifications';

export const NOTIFICATION_SUMMARY_LIMIT = 240;

type NotificationText = { type: string; title: string; body: string | null };

export function compactNotificationText(value: string, limit = NOTIFICATION_SUMMARY_LIMIT): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  const excerpt = text.slice(0, limit - 1);
  const lastSpace = excerpt.lastIndexOf(' ');
  return `${excerpt.slice(0, lastSpace > limit / 2 ? lastSpace : undefined).trimEnd()}…`;
}

/** Only notification presentation changes; the stored evidence remains intact. */
export function notificationPresentation(item: NotificationText): { title: string; body: string | null } {
  if (item.type !== 'FRONTI_HALLAZGO') {
    return { title: item.title, body: item.body ? compactNotificationText(item.body) : null };
  }

  const sourceTitle = item.title.replace(/^Fronti\s*·\s*/i, '').replace(/^Novedad requiere seguimiento:\s*/i, '');
  const original = item.body ?? '';
  const title = /Prioridad:\s*CRITICA\b/i.test(original) && !/^Crítica ·/i.test(sourceTitle)
    ? `Crítica · ${sourceTitle}` : sourceTitle;
  const legacy = /Qué pasó:|Lectura de Fronti:|Evidencia:/i.test(original);
  if (!legacy) return { title, body: original ? compactNotificationText(original) : null };

  // Recover facts from old templates, never the speculative "Lectura de Fronti".
  const fact = (original.match(/Qué pasó:\s*([\s\S]*?)(?=Qué está mal|Qué hacer:|$)/i)?.[1] ?? '')
    .replace(/\bc[a-z0-9]{20,32}\b/gi, '')
    .replace(/(?:tipo|prioridad|gravedad|estado)\s+[A-Z_]+\s*·\s*/g, '')
    .replace(/^requiere seguimiento\s*·\s*/i, '')
    .trim();

  const cash = title.match(/Arqueo\s+#(\d+) con diferencia (CLP|USD|EUR) ([+-]?[\d.,]+)/i);
  if (cash) {
    const [, id, currency, amount] = cash;
    const shortage = amount?.startsWith('-');
    return {
      title: `${shortage ? 'Faltan' : 'Sobran'} ${currency} ${amount?.replace(/^[+-]/, '')} · arqueo #${id}`,
      body: 'Revisa el conteo y los movimientos asociados al arqueo.',
    };
  }
  if (/Inventario de llaves con diferencias/i.test(title)) {
    return { title, body: 'El conteo físico registró diferencias. Revisa las llaves y contrasta el conteo guardado.' };
  }
  if (/^Tarea #\d+ vencida/i.test(sourceTitle)) {
    const assignee = fact.match(/responsable ([^·]+)/i)?.[1]?.trim();
    const due = fact.match(/fecha límite ([\dT:.Z+-]+)/i)?.[1];
    const date = due ? new Date(due) : null;
    const deadline = date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('es-CL', {
          timeZone: 'America/Santiago', day: '2-digit', month: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(date)
      : null;
    return { title, body: compactNotificationText([
      deadline ? `Venció el ${deadline}.` : 'La fecha límite pasó y la tarea seguía abierta al emitirse el aviso.',
      assignee ? `Responsable: ${assignee}.` : '',
      'Revisa el avance y actualiza la tarea.',
    ].filter(Boolean).join(' ')) };
  }
  if (fact) return { title, body: compactNotificationText(fact.replace(/[.\s]+$/, '') + '.') };
  if (/Garantía por resolver/i.test(title)) {
    return { title, body: 'La fecha objetivo venció y la garantía seguía vigente al emitirse el aviso. Revisa su situación en Caja.' };
  }
  return { title, body: 'La novedad fue marcada para seguimiento. Abre el registro y revisa la gestión pendiente.' };
}

/** Accept a short, grounded model response, or let the caller use its factual fallback. */
export function parseFrontiNotificationSummary(response: string, evidence: string): string | null {
  try {
    const value: unknown = JSON.parse(response);
    if (!value || typeof value !== 'object' || !('summary' in value) || typeof value.summary !== 'string') return null;
    const summary = value.summary.trim().replace(/\s+/g, ' ');
    if (!summary || summary.length > NOTIFICATION_SUMMARY_LIMIT) return null;
    if (/Qué pasó:|Qué está mal|Qué hacer:|Lectura de Fronti:|\bc[a-z0-9]{20,32}\b/i.test(summary)) return null;
    const sourceNumbers = new Set(evidence.match(/\d+(?:[.,:]\d+)*/g) ?? []);
    if ((summary.match(/\d+(?:[.,:]\d+)*/g) ?? []).some((number) => !sourceNumbers.has(number))) return null;
    const deadlines = evidence.match(/\b\d{1,2}:\d{2}(?!\d)/g) ?? [];
    if (deadlines.some((time) => !summary.includes(time))) return null;
    if (/\bantes de\b/i.test(evidence) && !/\b(?:antes|primero|previamente|tras|después de|una vez)\b/i.test(summary)) return null;
    if (/\b(?:equipo|sala)\s+\d/i.test(summary) && !/\b(?:equipo|sala)\s+\d/i.test(evidence)) return null;
    return summary;
  } catch {
    return null;
  }
}

export type NotificationDisplayGroup<T extends NotificationFeedItem = NotificationFeedItem> = {
  id: string;
  items: T[];
  title: string | null;
  body: string | null;
};

/** Group related key-count notices from one hotel day without merging their identities or read state. */
export function groupNotificationItems<T extends NotificationFeedItem>(items: T[]): NotificationDisplayGroup<T>[] {
  const groups: NotificationDisplayGroup<T>[] = [];
  const keysByDay = new Map<string, NotificationDisplayGroup<T>>();
  const duplicates = new Map<string, NotificationDisplayGroup<T>>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const isKeyCount = item.type === 'FRONTI_HALLAZGO' && /Inventario de llaves con diferencias/i.test(item.title);
    if (!isKeyCount || !Number.isFinite(date.getTime())) {
      const day = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(date) : item.createdAt;
      const key = JSON.stringify([item.type, item.title, item.body, item.entity, item.entityId, item.link, day]);
      const existing = duplicates.get(key);
      if (existing) existing.items.push(item);
      else { const group = { id: item.id, items: [item], title: null, body: null }; duplicates.set(key, group); groups.push(group); }
      continue;
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(date);
    let group = keysByDay.get(day);
    if (!group) {
      group = { id: `key-counts:${day}`, items: [], title: null, body: null };
      keysByDay.set(day, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  for (const group of keysByDay.values()) {
    if (group.items.length < 2) continue;
    const floors = [...new Set(group.items.flatMap((item) => {
      const floor = item.title.match(/piso (\d+)/i)?.[1];
      return floor ? [Number(floor)] : [];
    }))].sort((a, b) => a - b);
    group.title = `Llaves · ${group.items.length} avisos de diferencias`;
    group.body = [
      floors.length ? `Pisos ${new Intl.ListFormat('es-CL').format(floors.map(String))}.` : '',
      'Revisa el conteo más reciente de cada piso.',
    ].filter(Boolean).join(' ');
  }
  return groups;
}

export function notificationDeviceItems(items: NotificationFeedItem[]): NotificationFeedItem[] {
  return groupNotificationItems(items).map((group) => {
    const newest = group.items.reduce((a, b) => a.createdAt > b.createdAt ? a : b);
    return group.title
      ? { ...newest, title: group.title, body: group.body, link: '/llaves?piso=todos' }
      : newest;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
