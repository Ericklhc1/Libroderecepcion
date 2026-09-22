import { EntryType } from '@prisma/client';
import type { BookFilters, BookKind } from '@/server/services/book';
import {
  addCalendarDateDays,
  calendarDateKey,
  hotelWallDateTime,
} from '@/domain/time';

export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value && value.length > 0 ? value : undefined;
}

function date(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const calendar = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(calendar.getTime())) return null;
  if (!endOfDay) return hotelWallDateTime(value, 0, 0);

  const next = addCalendarDateDays(calendar, 1);
  return new Date(hotelWallDateTime(calendarDateKey(next), 0, 0).getTime() - 1);
}

/**
 * Traduce los parámetros de la URL a filtros del libro. Los valores no
 * reconocidos se ignoran: la URL nunca puede provocar una consulta inválida.
 *
 * Desde v1.4.0 el Libro no interpreta prefijos PMS ni crea filtros estructurados
 * por habitación o reserva. Cualquier referencia se busca como texto del registro.
 */
export function parseBookFilters(
  params: RawSearchParams,
  defaults: Partial<BookFilters> = {},
): BookFilters {
  const estado = one(params.estado);
  const tipo = one(params.tipo);
  const clase = one(params.clase);
  const rawQ = one(params.q)?.trim();
  const kinds: BookKind[] | undefined =
    clase && ['entry', 'task', 'followup', 'alert'].includes(clase)
      ? [clase as BookKind]
      : defaults.kinds;

  return {
    ...defaults,
    q: rawQ,
    from: date(one(params.desde)),
    to: date(one(params.hasta), true),
    shiftId: one(params.turno) ?? null,
    userId: one(params.usuario) ?? null,
    departmentId: one(params.area) ?? null,
    entryType: tipo && tipo in EntryType ? (tipo as EntryType) : (defaults.entryType ?? null),
    status: estado && estado !== 'abiertos' ? estado : null,
    priority: one(params.prioridad) ?? null,
    ownerId: one(params.responsable) ?? null,
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