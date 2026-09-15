import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getBookItems } from '@/server/services/book';
import { getFormOptions } from '@/server/services/options';
import { getShiftOptions } from '@/server/services/shift-options';
import { Card, EmptyState } from '@/components/ui/card';
import { BookList } from '@/components/operational/book-row';
import { Filters } from '@/components/operational/filters';
import { ViewTabs } from '@/components/layout/view-tabs';
import {
  filterValues,
  pageHref,
  parseBookFilters,
  type RawSearchParams,
} from '@/lib/search-params';

export const metadata = { title: 'Libro operativo' };
export const dynamic = 'force-dynamic';

const TABS = [
  { label: 'Todo', href: '/libro' },
  { label: 'Registros', href: '/libro?clase=entry' },
  { label: 'Incidencias', href: '/libro?clase=entry&tipo=INCIDENCIA' },
  { label: 'Tareas', href: '/libro?clase=task' },
  { label: 'Seguimientos', href: '/libro?clase=followup' },
  { label: 'Alertas', href: '/libro?clase=alert' },
];

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const filters = parseBookFilters(params);

  const [result, options, shifts] = await Promise.all([
    getBookItems(filters),
    getFormOptions(),
    getShiftOptions(),
  ]);

  // La pestaña activa se deduce de los mismos parámetros que ya filtran.
  const clase = typeof params.clase === 'string' ? params.clase : undefined;
  const tipo = typeof params.tipo === 'string' ? params.tipo : undefined;
  const activeTab =
    clase === 'entry' && tipo === 'INCIDENCIA'
      ? '/libro?clase=entry&tipo=INCIDENCIA'
      : clase
        ? `/libro?clase=${clase}`
        : '/libro';

  /*
    Vistas especializadas. No se duplican acá: cada una aporta acciones que el
    listado cronológico no tiene (reconocer una alerta, cerrar un seguimiento
    con su resultado, el avance de la lista de una tarea).
  */
  const SPECIALIZED: Record<string, { href: string; label: string }> = {
    task: { href: '/tareas', label: 'Abrir vista de tareas' },
    followup: { href: '/seguimientos', label: 'Abrir vista de seguimientos' },
    alert: { href: '/alertas', label: 'Abrir vista de alertas' },
  };
  const specialized =
    clase === 'entry' && tipo === 'INCIDENCIA'
      ? { href: '/incidencias', label: 'Abrir vista de incidencias' }
      : clase
        ? SPECIALIZED[clase]
        : undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Libro operativo</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Todo lo que ocurre en la operación, en una sola línea temporal. Las
          pestañas acotan la clase; los filtros, el resto.
        </p>
      </header>

      {/*
        Cada pestaña es un filtro de esta misma vista, no otro módulo: cambia
        el parámetro `clase` de la URL. Las clases que tienen acciones propias
        —alertas y seguimientos— ofrecen además el enlace a su pantalla
        especializada, que sigue existiendo como vista secundaria.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs label="Clase de registro" activeHref={activeTab} tabs={TABS} />
        {specialized ? (
          <Link
            href={specialized.href}
            className="text-xs font-medium text-petrol-600 underline-offset-2 hover:underline"
          >
            {specialized.label}
          </Link>
        ) : null}
      </div>

      <Filters
        action="/libro"
        fields={[
          'q',
          'clase',
          'tipo',
          'estado',
          'prioridad',
          'area',
          'responsable',
          'turno',
          'habitacion',
          'reserva',
          'desde',
          'hasta',
        ]}
        values={filterValues(params)}
        options={{ departments: options.departments, users: options.users, shifts }}
      />

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <p className="text-xs text-slate-500">
            Página {result.page} · {result.items.length} registro(s) en esta página
          </p>
          {user.permissions.includes('entry.restore') ? (
            <Link
              href={
                filters.includeDeleted
                  ? pageHref('/libro', { ...params, eliminados: undefined }, 1)
                  : pageHref('/libro', { ...params, eliminados: '1' }, 1)
              }
              className="text-xs font-medium text-petrol-600 hover:underline"
            >
              {filters.includeDeleted ? 'Ocultar eliminados' : 'Incluir eliminados'}
            </Link>
          ) : null}
        </div>

        {result.items.length === 0 ? (
          <EmptyState
            message="No hay registros que coincidan con los filtros."
            hint="Prueba con menos filtros o registra una nueva novedad desde las acciones rápidas."
          />
        ) : (
          <BookList items={result.items} />
        )}

        {result.page > 1 || result.hasMore ? (
          <nav
            className="flex items-center justify-between border-t border-slate-200 px-4 py-3"
            aria-label="Paginación"
          >
            {result.page > 1 ? (
              <Link
                href={pageHref('/libro', params, result.page - 1)}
                className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 hover:underline"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Anterior
              </Link>
            ) : (
              <span />
            )}
            {result.hasMore ? (
              <Link
                href={pageHref('/libro', params, result.page + 1)}
                className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 hover:underline"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
