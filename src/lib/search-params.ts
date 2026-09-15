import { EntryType } from '@prisma/client';
import type { BookFilters, BookKind } from '@/server/services/book';

export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value && value.length > 0 ? value : undefined;
}

function date(value: string | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  else parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/**
 * Traduce los parámetros de la URL a filtros del libro. Los valores no
 * reconocidos se ignoran: la URL nunca puede provocar una consulta inválida.
 */
export function parseBookFilters(
  params: RawSearchParams,
  defaults: Partial<BookFilters> = {},
): BookFilters {
  const estado = one(params.estado);
  const tipo = one(params.tipo);
  const clase = one(params.clase);

  const kinds: BookKind[] | undefined =
    clase && ['entry', 'task', 'followup', 'alert'].includes(clase)
      ? [clase as BookKind]
      : defaults.kinds;

  return {
    ...defaults,
    q: one(params.q),
    from: date(one(params.desde)),
    to: date(one(params.hasta), true),
    shiftId: one(params.turno) ?? null,
    userId: one(params.usuario) ?? null,
    departmentId: one(params.area) ?? null,
    entryType: tipo && tipo in EntryType ? (tipo as EntryType) : (defaults.entryType ?? null),
    status: estado && estado !== 'abiertos' ? estado : null,
    priority: one(params.prioridad) ?? null,
    ownerId: one(params.responsable) ?? null,
    room: one(params.habitacion) ?? null,
    reservation: one(params.reserva) ?? null,
    onlyOpen: estado === 'abiertos' ? true : defaults.onlyOpen,
    includeDeleted: one(params.eliminados) === '1' ? true : defaults.includeDeleted,
    kinds,
    page: Number(one(params.pagina) ?? '1') || 1,
  };
}

export function filterValues(params: RawSearchParams): Record<string, string | undefined> {
  const keys = [
    'q',
    'tipo',
    'estado',
    'prioridad',
    'area',
    'responsable',
    'usuario',
    'turno',
    'habitacion',
    'reserva',
    'desde',
    'hasta',
    'clase',
  ];
  const out: Record<string, string | undefined> = {};
  for (const key of keys) out[key] = one(params[key]);
  return out;
}

/** Construye la URL de una página conservando los filtros actuales. */
export function pageHref(
  base: string,
  params: RawSearchParams,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = one(value);
    if (single && key !== 'pagina') search.set(key, single);
  }
  if (page > 1) search.set('pagina', String(page));
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}
