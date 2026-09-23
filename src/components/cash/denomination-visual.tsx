import { cn } from '@/lib/cn';

export type CashMedium = 'BILLETE' | 'MONEDA';

function currencyPrefix(currency: string) {
  return currency === 'CLP' ? '$' : currency === 'USD' ? 'US$' : `${currency} `;
}

function formattedValue(currency: string, value: number) {
  return `${currencyPrefix(currency)}${value.toLocaleString('es-CL', {
    maximumFractionDigits: 2,
  })}`;
}

export function DenominationVisual({
  currency,
  value,
  medium,
  compact = false,
}: {
  currency: string;
  value: number;
  medium: CashMedium;
  compact?: boolean;
}) {
  const amount = formattedValue(currency, value);

  if (medium === 'MONEDA') {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'relative inline-flex shrink-0 items-center justify-center rounded-full border-2 border-gold-400 bg-gold-50 font-bold tabular text-petrol-900 shadow-sm',
            compact ? 'h-8 w-8 text-[0.55rem]' : 'h-10 w-10 text-[0.62rem]',
          )}
          aria-hidden="true"
        >
          <span className="absolute inset-[3px] rounded-full border border-gold-300" />
          <span className="relative">{value >= 1000 ? `${value / 1000}K` : value}</span>
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-slate-500">Moneda</span>
          <span className="block truncate text-sm font-semibold tabular text-petrol-900">
            {amount}
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-petrol-300 bg-petrol-50 font-bold tabular text-petrol-900 shadow-sm',
          compact ? 'h-8 w-14 text-[0.55rem]' : 'h-10 w-[4.5rem] text-[0.62rem]',
        )}
        aria-hidden="true"
      >
        <span className="absolute inset-1 rounded border border-petrol-200" />
        <span className="absolute left-1.5 h-2 w-2 rounded-full border border-petrol-300" />
        <span className="absolute right-1.5 h-2 w-2 rounded-full border border-petrol-300" />
        <span className="relative">
          {currency === 'CLP' && value >= 1000
            ? `$${value / 1000}K`
            : currency === 'USD'
              ? `$${value}`
              : amount}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-500">Billete</span>
        <span className="block truncate text-sm font-semibold tabular text-petrol-900">
          {amount}
        </span>
      </span>
    </span>
  );
}
