import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Card({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('card scroll-mt-32', className)}>
      {children}
    </section>
  );
}


export function DisclosureCard({
  title,
  description,
  count,
  action,
  children,
  className,
  contentClassName,
  defaultOpen = false,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  count?: number | null;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
  id?: string;
}) {
  return (
    <details
      id={id}
      data-disclosure-card
      className={cn('group card scroll-mt-32 overflow-hidden', className)}
      open={defaultOpen || undefined}
    >
      <summary
        data-disclosure-summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-petrol-900">{title}</h2>
            {typeof count === 'number' ? (
              <span className="rounded-md bg-petrol-50 px-1.5 py-0.5 text-xs tabular text-petrol-700">
                {count}
              </span>
            ) : null}
          </div>
          {description ? <p className="mt-0.5 text-xs leading-5 text-slate-600">{description}</p> : null}
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {action}
          <ChevronDown
            className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className={cn('border-t border-slate-100', contentClassName)}>{children}</div>
    </details>
  );
}

export function CardHeader({
  title,
  count,
  action,
  href,
  hrefLabel = 'Ver todo',
}: {
  title: string;
  count?: number | null;
  action?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <header className="card-header">
      <h2 className="card-title">
        {title}
        {typeof count === 'number' ? (
          <span className="ml-2 rounded-md bg-petrol-50 px-1.5 py-0.5 text-xs tabular text-petrol-700">
            {count}
          </span>
        ) : null}
      </h2>
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
    </header>
  );
}


export function CardScroll({
  children,
  className,
}: {
  children: React.ReactNode;
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
