/**
 * Pantalla de espera de la navegación.
 *
 * Next la muestra en el instante en que se pulsa un enlace, sin esperar al
 * servidor. Sin esto, cada navegación dejaba la pantalla anterior congelada
 * mientras la página se armaba en el servidor, y la sensación era que el clic
 * no se había registrado. Es el mismo problema que resuelve el estado de
 * carga de los botones, aplicado a la navegación.
 *
 * Reproduce la forma de las pantallas —cabecera, tarjetas, filas— para que el
 * cambio no desplace el contenido cuando llegan los datos reales.
 */
function Block({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-4" role="status" aria-label="Cargando">
      <span className="sr-only">Cargando la pantalla…</span>

      <header className="space-y-2">
        <Block className="h-6 w-56" />
        <Block className="h-4 w-80" />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card px-4 py-3">
            <Block className="h-3 w-24" />
            <Block className="mt-2 h-7 w-12" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2" aria-hidden="true">
        {[0, 1].map((card) => (
          <div key={card} className="card">
            <div className="card-header">
              <Block className="h-4 w-40" />
            </div>
            <div className="divide-y divide-slate-100">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-start gap-3 px-4 py-3">
                  <Block className="h-4 w-10 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Block className="h-4 w-3/4" />
                    <Block className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
