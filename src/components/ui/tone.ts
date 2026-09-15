import type { Tone } from '@/domain/labels';

/**
 * Semáforo visual. Cada tono trae clases completas (no concatenadas) para que
 * Tailwind las incluya, y un símbolo textual que acompaña al color: la
 * información nunca depende sólo del color.
 */
export const TONE_STYLES: Record<
  Tone,
  { badge: string; dot: string; bar: string; text: string; symbol: string; meaning: string }
> = {
  critico: {
    badge: 'bg-red-50 text-red-800 ring-1 ring-red-200',
    dot: 'bg-red-600',
    bar: 'bg-red-600',
    text: 'text-red-700',
    symbol: '▲',
    meaning: 'Crítico o vencido',
  },
  atencion: {
    badge: 'bg-orange-50 text-orange-800 ring-1 ring-orange-200',
    dot: 'bg-orange-500',
    bar: 'bg-orange-500',
    text: 'text-orange-700',
    symbol: '◆',
    meaning: 'Requiere atención',
  },
  pendiente: {
    badge: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    dot: 'bg-amber-400',
    bar: 'bg-amber-400',
    text: 'text-amber-700',
    symbol: '●',
    meaning: 'Pendiente',
  },
  curso: {
    badge: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
    dot: 'bg-sky-500',
    bar: 'bg-sky-500',
    text: 'text-sky-700',
    symbol: '▶',
    meaning: 'En curso',
  },
  resuelto: {
    badge: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
    dot: 'bg-emerald-600',
    bar: 'bg-emerald-600',
    text: 'text-emerald-700',
    symbol: '✓',
    meaning: 'Resuelto',
  },
  neutro: {
    badge: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
    dot: 'bg-slate-400',
    bar: 'bg-slate-400',
    text: 'text-slate-600',
    symbol: '—',
    meaning: 'Cerrado o informativo',
  },
};
