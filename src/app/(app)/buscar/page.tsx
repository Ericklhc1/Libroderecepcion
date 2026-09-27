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
        <h1 className="text-xl font-semibold text-petrol-900">Buscar en todo el Libro</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Escribe un #ID, habitación, huésped, persona o palabras del registro.
        </p>
      </header>

      <form action="/buscar" className="card p-3">
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Ej.: #1252 · 617 · Jaime · multa · garantía caja"
            aria-label="Búsqueda global"
            className="input-base w-full pl-9"
          />
        </label>
      </form>

      <Card>
        {!q ? (
          <EmptyState
            message="Escribe algo para buscar."
            hint="No necesitas elegir un módulo ni recordar prefijos."
          />
        ) : results.length === 0 ? (
          <EmptyState
            message={`No encontré registros para «${q}».`}
            hint="Prueba con el #ID, habitación, huésped, responsable o menos palabras."
          />
        ) : (
          <>
            <div className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              {results.length} resultado(s) · coincidencia exacta por #ID primero
            </div>
            <ul className="divide-y divide-slate-100">
              {results.map((result) => {
                const body = (
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular text-petrol-800">
                        #{result.humanId}
                      </span>
                      <Chip>{result.kindLabel}</Chip>
                      {result.status ? <span className="text-xs text-slate-500">{result.status.toLocaleLowerCase('es-CL').replaceAll('_', ' ')}</span> : null}
                    </div>
                    <p className="mt-1 font-medium text-petrol-900">{result.title}</p>
                    {result.summary ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{result.summary}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      {result.room ? <span>Hab. {result.room}</span> : null}
                      {result.guest ? <span>{result.guest}</span> : null}
                      {result.person ? <span>{result.person}</span> : null}
                      {result.category ? <span>{result.category.toLocaleLowerCase('es-CL').replaceAll('_', ' ')}</span> : null}
                      <span>{formatDateTime(result.createdAt)}</span>
                    </div>
                  </div>
                );

                return (
                  <li key={`${result.entity}-${result.humanId}`}>
                    {result.href ? (
                      <Link href={result.href} className="block hover:bg-slate-50">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
