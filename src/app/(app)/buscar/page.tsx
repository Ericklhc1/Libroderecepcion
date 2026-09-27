import Link from 'next/link';
import { Search } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { searchOperationalRecords } from '@/server/services/global-search';
import { Card, EmptyState } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Buscar' };
export const dynamic = 'force-dynamic';

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const results = q ? await searchOperationalRecords(user, q) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Búsqueda global</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Un solo buscador para números de registro, habitaciones, huéspedes, responsables y texto operativo.
        </p>
      </header>

      <form action="/buscar" className="card flex items-center gap-2 p-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="Ej.: #1252, 617, Jaime, multa, garantía, caja…"
            className="input-base w-full pl-9"
            aria-label="Buscar en todo el Libro"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-petrol-700 px-4 py-2 text-sm font-semibold text-white hover:bg-petrol-800"
        >
          Buscar
        </button>
      </form>

      {!q ? (
        <Card>
          <EmptyState
            message="Escribe un número o una referencia operativa."
            hint="No necesitas elegir un módulo ni recordar prefijos."
          />
        </Card>
      ) : results.length === 0 ? (
        <Card>
          <EmptyState
            message={`No encontré registros para “${q}”.`}
            hint="Prueba con el #ID, habitación, huésped, responsable, título o una palabra de la descripción."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {results.map((result) => (
              <li key={`${result.entityType}-${result.entityId}`}>
                <Link href={result.href} className="block px-4 py-3 hover:bg-slate-50">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular text-petrol-700">#{result.humanId}</span>
                    <Chip>{result.kind}</Chip>
                    {result.status ? (
                      <span className="text-xs font-medium text-slate-500">
                        {result.status.toLocaleLowerCase('es-CL').replaceAll('_', ' ')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-medium text-petrol-900">{result.title}</p>
                  {result.summary ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{result.summary}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {result.roomNumber ? <span>Hab. {result.roomNumber}</span> : null}
                    {result.guestName ? <span>{result.guestName}</span> : null}
                    {result.responsible ? <span>Responsable: {result.responsible}</span> : null}
                    {result.category ? <span>{result.category.replaceAll('_', ' ')}</span> : null}
                    <span>{formatDateTime(result.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
