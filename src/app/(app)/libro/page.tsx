import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getBookItems, type BookFilters } from '@/server/services/book';
import { getFormOptions } from '@/server/services/options';
import { getShiftOptions } from '@/server/services/shift-options';
import { Card, CardScroll, EmptyState } from '@/components/ui/card';
import { BookList } from '@/components/operational/book-row';
import { Filters } from '@/components/operational/filters';
import { ViewTabs } from '@/components/layout/view-tabs';
import {
  filterValues,
  pageHref,
  parseBookFilters,
  type RawSearchParams,
} from '@/lib/search-params';
import { isReceptionDeskRole } from '@/lib/permissions';

export const metadata = { title: 'Novedades' };
export const dynamic = 'force-dynamic';

const TABS = [
  { label: 'Novedades', href: '/libro?clase=entry' },
  { label: 'Incidencias', href: '/libro?clase=entry&tipo=INCIDENCIA' },
  { label: 'Mis tareas', href: '/libro?clase=task' },
];

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const clase = typeof params.clase === 'string' ? params.clase : 'entry';
  const tipo = typeof params.tipo === 'string' ? params.tipo : undefined;
  const parsedFilters = parseBookFilters(params);
  const receptionDesk = isReceptionDeskRole(user.roleKey);

  const filters: BookFilters = {
    ...parsedFilters,
    ...(clase === 'entry'
      ? {
          kinds: ['entry'],
          receptionEntriesOnly: true,
          onlyOpen: true,
        }
      : {}),
    ...(receptionDesk && clase === 'task'
      ? { ownerId: user.id, onlyOpen: true }
      : {}),
    ...(receptionDesk && clase === 'followup'
      ? { ownerId: user.id, onlyOpen: true }
      : {}),
    hideClosureValidation: receptionDesk,
  };

  const [result, options, shifts] = await Promise.all([
    getBookItems(filters),
    getFormOptions(),
    getShiftOptions(),
  ]);
  const activeTab =
    clase === 'entry' && tipo === 'INCIDENCIA'
      ? '/libro?clase=entry&tipo=INCIDENCIA'
      : `/libro?clase=${clase}`;

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
  const isEntryView = clase === 'entry';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-petrol-900">
          {isEntryView ? 'Novedades' : 'Libro operativo'}
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {isEntryView
            ? 'Sólo aparecen novedades e incidencias creadas por Recepción que siguen en gestión. Lo resuelto pasa al Historial.'
            : clase === 'task'
              ? 'Tus tareas operativas abiertas.'
              : 'Vista especializada del Libro.'}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewTabs label="Vista operativa" activeHref={activeTab} tabs={TABS} />
        <div className="flex items-center gap-3">
          <Link
            href="/historial"
            className="text-xs font-medium text-petrol-600 underline-offset-2 hover:underline"
          >
            Ver historial
          </Link>
        {specialized ? (
          <Link
            href={specialized.href}
            className="text-xs font-medium text-petrol-600 underline-offset-2 hover:underline"
          >
            {specialized.label}
          </Link>
        ) : null}
        </div>
      </div>

      <Filters
        action="/libro"
        fields={[
          'q',
          'tipo',
          'estado',
          'prioridad',
          'area',
          'responsable',
          'turno',
          'desde',
          'hasta',
        ]}
        values={filterValues(params)}
        extraHidden={{ clase }}
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
          <CardScroll>
            <BookList items={result.items} />
          </CardScroll>
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
