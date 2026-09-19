import Link from 'next/link';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';

export function ListFilterBar({
  children,
  searchValue = '',
  searchPlaceholder = 'Buscar…',
  clearHref,
  className,
}: {
  children?: React.ReactNode;
  searchValue?: string;
  searchPlaceholder?: string;
  clearHref: string;
  className?: string;
}) {
  return (
    <form
      method="get"
      className={cn(
        'flex flex-wrap items-end gap-2 rounded-xl bg-white p-2 ring-1 ring-slate-200',
        className,
      )}
    >
      <label className="min-w-[14rem] flex-1">
        <span className="sr-only">Buscar</span>
        <span className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            name="q"
            defaultValue={searchValue}
            placeholder={searchPlaceholder}
            className="input-base w-full pl-9"
          />
        </span>
      </label>
      {children}
      <button
        type="submit"
        className="rounded-lg bg-petrol-700 px-3 py-2 text-sm font-medium text-white hover:bg-petrol-800"
      >
        Aplicar
      </button>
      <Link
        href={clearHref}
        className="rounded-lg px-3 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
      >
        Limpiar
      </Link>
    </form>
  );
}
