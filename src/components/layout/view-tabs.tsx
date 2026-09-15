import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ViewTab = {
  label: string;
  href: string;
  /** Cuenta opcional junto a la etiqueta. */
  count?: number;
};

/**
 * Pestañas de vista secundaria.
 *
 * Reemplazan a los módulos separados del menú: una clase del libro (tarea,
 * incidencia, seguimiento, alerta) es un filtro de la misma línea temporal,
 * no un destino aparte. Son enlaces, de modo que la vista elegida queda en la
 * URL y se puede compartir o recargar.
 */
export function ViewTabs({
  tabs,
  activeHref,
  label,
}: {
  tabs: ViewTab[];
  activeHref: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors active:bg-petrol-100',
                  active
                    ? 'bg-petrol-700 text-white'
                    : 'bg-white text-petrol-700 ring-1 ring-slate-200 hover:bg-slate-50',
                )}
              >
                {tab.label}
                {typeof tab.count === 'number' && tab.count > 0 ? (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[0.65rem] font-semibold tabular',
                      active ? 'bg-petrol-900 text-gold-200' : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
