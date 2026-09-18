import { Sparkles } from 'lucide-react';
import { AI_ATTRIBUTION } from '@/domain/legal';

export function AiAttribution({
  className = '',
}: {
  className?: string;
}) {
  return (
    <p
      className={`flex items-center justify-center gap-1 text-center text-[0.58rem] leading-4 text-slate-400 ${className}`}
      aria-label={AI_ATTRIBUTION}
    >
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{AI_ATTRIBUTION}</span>
    </p>
  );
}
