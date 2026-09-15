import Link from 'next/link';
import { cn } from '@/lib/cn';

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn('card', className)}>{children}</section>;
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
        'rounded-xl border bg-white px-4 py-3 shadow-card',
        tone === 'alert'
          ? 'border-red-200'
          : tone === 'good'
            ? 'border-emerald-200'
            : 'border-slate-200',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
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
