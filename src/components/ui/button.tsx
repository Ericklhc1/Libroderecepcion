'use client';

import { useFormStatus } from 'react-dom';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-petrol-700 text-white hover:bg-petrol-800 disabled:bg-petrol-300 shadow-sm',
  secondary:
    'bg-white text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-petrol-700 hover:bg-petrol-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 shadow-sm',
  gold: 'bg-gold-500 text-petrol-950 hover:bg-gold-400 disabled:bg-gold-200 shadow-sm font-semibold',
};

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Botón de envío que se deshabilita mientras la acción de servidor está en
 * curso: evita dobles envíos (por ejemplo, recibir dos veces una entrega).
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: Variant;
  size?: Size;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending || props.disabled}
      className={className}
      {...props}
    >
      {pending ? (pendingLabel ?? 'Guardando…') : children}
    </Button>
  );
}
