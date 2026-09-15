/**
 * Espera del tablero de habitaciones.
 *
 * El tablero son 89 tarjetas en rejilla: el esqueleto reproduce esa forma para
 * que al llegar los datos nada salte de sitio.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-4" role="status" aria-label="Cargando">
      <span className="sr-only">Cargando el tablero de habitaciones…</span>
      <header className="space-y-2">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
      </header>
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        aria-hidden="true"
      >
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="card space-y-3 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5">
                <div className="h-6 w-12 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-14 animate-pulse rounded bg-slate-200" />
              </div>
              <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200" />
            </div>
            <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
            <div className="space-y-1.5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
