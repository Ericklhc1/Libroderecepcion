import { cn } from '@/lib/cn';
import type { Tone } from '@/domain/labels';
import { TONE_STYLES } from './tone';

export function Badge({
  tone = 'neutro',
  children,
  className,
  withSymbol = true,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  withSymbol?: boolean;
  title?: string;
}) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        style.badge,
        className,
      )}
      title={title ?? style.meaning}
    >
      {withSymbol ? (
        <span aria-hidden="true" className="text-[0.65rem] leading-none">
          {style.symbol}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-petrol-50 px-2 py-0.5 text-xs font-medium text-petrol-700 ring-1 ring-petrol-100',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Punto de color + texto, para listas densas. */
export function ToneDot({ tone, label }: { tone: Tone; label: string }) {
  const style = TONE_STYLES[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
      {label}
    </span>
  );
}
