import Link from 'next/link';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

type CardHeaderProps = {
  title: string;
  count?: number | null;
  action?: ReactNode;
  href?: string;
  hrefLabel?: string;
};

function HeaderTitle({ title, count }: Pick<CardHeaderProps, 'title' | 'count'>) {
  return (
    <h2 className="card-title">
      {title}
      {typeof count === 'number' ? (
        <span className="ml-2 rounded-md bg-petrol-50 px-1.5 py-0.5 text-xs tabular text-petrol-700">
          {count}
        </span>
      ) : null}
    </h2>
  );
}

function HeaderActions({
  action,
  href,
  hrefLabel = 'Ver todo',
}: Pick<CardHeaderProps, 'action' | 'href' | 'hrefLabel'>) {
  return (
    <div className="flex items-center gap-2">
      {action}
      {href ? (
        <Link
          href={href}
          className="text-xs font-medium text-petrol-600 underline-offset-2 hover:underline"
        >
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  className,
  id,
  collapsible = false,
  defaultOpen = false,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  /** Convierte una tarjeta con CardHeader directo en una sección desplegable semántica. */
  collapsible?: boolean;
  /** Sólo aplica cuando collapsible=true. Las secciones largas nacen cerradas por defecto. */
  defaultOpen?: boolean;
}) {
  if (!collapsible) {
    return (
      <section id={id} className={cn('card scroll-mt-32', className)}>
        {children}
      </section>
    );
  }

  const items = Children.toArray(children);
  const headerIndex = items.findIndex(
    (child) => isValidElement(child) && child.type === CardHeader,
  );
  if (headerIndex < 0) {
    return (
      <section id={id} className={cn('card scroll-mt-32', className)}>
        {children}
      </section>
    );
  }

  const header = items[headerIndex] as ReactElement<CardHeaderProps>;
  const body = items.filter((_, index) => index !== headerIndex);
  const { title, count, action, href, hrefLabel } = header.props;

  return (
    <details
      id={id}
      open={defaultOpen}
      data-collapsible-card
      className={cn('card group scroll-mt-32 overflow-hidden', className)}
    >
      <summary className="card-header cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <HeaderTitle title={title} count={count} />
        <span className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="hidden sm:inline">Mostrar / ocultar</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
      </summary>
      {action || href ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-100 px-4 py-2">
          <HeaderActions action={action} href={href} hrefLabel={hrefLabel} />
        </div>
      ) : null}
      {body}
    </details>
  );
}

export function CardHeader({
  title,
  count,
  action,
  href,
  hrefLabel = 'Ver todo',
}: CardHeaderProps) {
  return (
    <header className="card-header">
      <HeaderTitle title={title} count={count} />
      <HeaderActions action={action} href={href} hrefLabel={hrefLabel} />
    </header>
  );
}


export function CardScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div className={cn('min-w-0 overflow-x-auto', className)}>
      {children}
    </div>
  );
}

export function EmptyState({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-slate-500">{message}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'alert' | 'good';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-white px-4 py-3 shadow-card',
        tone === 'alert'
          ? 'border-red-200'
          : tone === 'good'
            ? 'border-emerald-200'
            : 'border-slate-200',
      )}
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular',
          tone === 'alert'
            ? 'text-red-700'
            : tone === 'good'
              ? 'text-emerald-700'
              : 'text-petrol-800',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
