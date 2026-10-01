import { scheduleAuditVisibility } from '@/server/services/schedule-access';
import Link from 'next/link';
import { housekeepingAuditVisibility } from '@/server/services/housekeeping';
import { ChevronLeft, ChevronRight, History, Printer } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getBookItems } from '@/server/services/book';
import { getFormOptions } from '@/server/services/options';
import { getShiftOptions } from '@/server/services/shift-options';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { BookList } from '@/components/operational/book-row';
import { Filters } from '@/components/operational/filters';
import { AUDIT_ACTION_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import {
  filterValues,
  pageHref,
  parseBookFilters,
  type RawSearchParams,
} from '@/lib/search-params';

export const metadata = { title: 'Historial' };
export const dynamic = 'force-dynamic';

/**
 * Historial y búsqueda global. A diferencia del libro operativo, aquí se
 * incluyen por defecto los registros cerrados: es el archivo del hotel.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const filters = parseBookFilters(params, { pageSize: 50 });
  const reportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single && key !== 'pagina') reportParams.set(key, single);
  }
  reportParams.set('vista', 'historial');

  const [result, options, shifts, auditLogs] = await Promise.all([
    getBookItems(filters),
    getFormOptions(),
    getShiftOptions(),
    user.permissions.includes('audit.view')
      ? prisma.auditLog.findMany({
          where: {
            AND: [housekeepingAuditVisibility(user), await scheduleAuditVisibility(user)],
            ...(filters.q ? { summary: { contains: filters.q, mode: 'insensitive' as const } } : {}),
          },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <History className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Historial y búsqueda
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Archivo de Novedades, tareas, seguimientos y alertas, incluidos los registros cerrados.
          </p>
        </div>
        <Link
          href={`/api/libro/reporte?${reportParams.toString()}`}
          target="_blank"
          className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Ver / imprimir informe
        </Link>
      </header>

      <Filters
        action="/historial"
        fields={[
          'q',
          'clase',
          'tipo',
          'estado',
          'prioridad',
          'area',
          'usuario',
          'responsable',
          'turno',
          'desde',
          'hasta',
        ]}
        values={filterValues(params)}
        options={{ departments: options.departments, users: options.users, shifts }}
      />

      <Card>
        <CardHeader
          title={filters.q ? `Resultados para “${filters.q}”` : 'Archivo cronológico'}
        />
        {result.items.length === 0 ? (
          <EmptyState message="Sin resultados para esta búsqueda." />
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
                href={pageHref('/historial', params, result.page - 1)}
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
                href={pageHref('/historial', params, result.page + 1)}
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

      {user.permissions.includes('audit.view') ? (
        <Card>
          <CardHeader
            title="Últimos movimientos de auditoría"
            href="/admin/auditoria"
            hrefLabel="Ver auditoría completa"
          />
          {auditLogs.length === 0 ? (
            <EmptyState message="Sin movimientos registrados." />
          ) : (
            <CardScroll>
              <ul className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5">
                  <time className="text-xs tabular text-slate-400">
                    {formatDateTime(log.createdAt)}
                  </time>
                  <Chip>{AUDIT_ACTION_LABEL[log.action]}</Chip>
                  <span className="text-sm text-petrol-900">{log.summary}</span>
                  <span className="text-xs text-slate-500">
                    · {log.user?.name ?? 'Sistema'}
                  </span>
                </li>
              ))}
              </ul>
            </CardScroll>
          )}
        </Card>
      ) : null}
    </div>
  );
}
