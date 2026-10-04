import type { RawSearchParams } from './search-params';

export type OperationalListPath = '/libro' | '/tareas';

const ORIGIN = 'https://aroh.invalid';
const MAX_HREF_LENGTH = 1900;
const LIST_PARAMS = new Set([
  'q', 'clase', 'tipo', 'estado', 'prioridad', 'area', 'responsable',
  'usuario', 'turno', 'desde', 'hasta', 'pagina', 'eliminados', 'mias',
]);
const ROW_ANCHOR = /^registro-(entry|task|followup|alert)-[a-zA-Z0-9_-]+$/;

function parseListReturnHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_HREF_LENGTH || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (path !== '/libro' && path !== '/tareas') return null;
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN || url.pathname !== path) return null;
    const search = new URLSearchParams();
    for (const [key, item] of url.searchParams) {
      if (LIST_PARAMS.has(key) && item && !search.has(key)) search.set(key, item);
    }
    const hash = ROW_ANCHOR.test(url.hash.slice(1)) ? url.hash : '';
    const query = search.toString();
    const result = `${path}${query ? `?${query}` : ''}${hash}`;
    return result.length <= MAX_HREF_LENGTH ? result : null;
  } catch {
    return null;
  }
}

/** Only existing list routes are accepted, never a detail, API or external URL. */
export function safeListReturnHref(value: unknown, fallback: OperationalListPath): string {
  return parseListReturnHref(value) ?? fallback;
}

/** Capture native filters and pagination; ephemeral return data is not a filter. */
export function operationalListHref(path: OperationalListPath, params: RawSearchParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const item = Array.isArray(value) ? value[0] : value;
    if (LIST_PARAMS.has(key) && item) search.set(key, item);
  }
  const query = search.toString();
  return safeListReturnHref(`${path}${query ? `?${query}` : ''}`, path);
}

export function listRowAnchor(kind: string, id: string): string {
  return `registro-${kind}-${id}`;
}

/** Add UI context without replacing the canonical entity route or its ID. */
export function detailHrefWithListContext(href: string, listHref: string, rowAnchor: string): string {
  if (!ROW_ANCHOR.test(rowAnchor)) return href;
  return detailHrefWithReturnContext(href, `${listHref.split('#', 1)[0]}#${rowAnchor}`);
}

/** Carry the same list through native entry/task links without inventing a return. */
export function detailHrefWithReturnContext(href: string, context: unknown): string {
  const returnHref = parseListReturnHref(context);
  if (!returnHref) return href;
  const path = href.split(/[?#]/, 1)[0] ?? '';
  if (!/^\/(libro|tareas)\/[a-zA-Z0-9_-]+$/.test(path)) return href;
  const url = new URL(href, ORIGIN);
  url.searchParams.set('desdeLista', returnHref);
  const result = url.pathname + url.search + url.hash;
  // Native action-return URLs have a 2,000-character limit. Retain a working
  // direct link if an unusually long search cannot fit inside that contract.
  return result.length <= MAX_HREF_LENGTH ? result : href;
}

export function listReturnLabel(href: string): string {
  const url = new URL(href, ORIGIN);
  if (url.pathname === '/tareas') return 'Volver a tareas';
  if (url.searchParams.get('clase') === 'task') return 'Volver a la lista de tareas';
  if (url.searchParams.get('tipo') === 'INCIDENCIA') return 'Volver a incidencias';
  return 'Volver a novedades';
}

export type ListPosition = { rowAnchor: string; scrollY: number };

export function readListPosition(value: string | null): ListPosition | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const { rowAnchor, scrollY } = parsed as Partial<ListPosition>;
    if (typeof rowAnchor !== 'string' || !ROW_ANCHOR.test(rowAnchor) ||
        typeof scrollY !== 'number' || !Number.isFinite(scrollY) || scrollY < 0 || scrollY > 10_000_000) return null;
    return { rowAnchor, scrollY };
  } catch {
    return null;
  }
}

export function listPositionKey(scope: string, href: string): string {
  return `aroh:list-position:${scope}:${href.split('#', 1)[0]}`;
}

export function listReturnKey(scope: string): string {
  return `aroh:list-return:${scope}`;
}
