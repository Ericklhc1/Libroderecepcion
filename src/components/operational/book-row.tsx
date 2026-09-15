import Link from 'next/link';
import { Clock, MessageSquare, Repeat, User } from 'lucide-react';
import { Badge, Chip } from '@/components/ui/badge';
import { TONE_STYLES } from '@/components/ui/tone';
import { formatDateTime, relativeTime } from '@/lib/format';
import type { BookItem } from '@/server/services/book';

/**
 * Fila del libro operativo. Muestra de un vistazo tipo, título, estado,
 * prioridad, área, responsable, creador, fecha, turno, vencimiento,
 * indicador de seguimiento y comentarios.
 */
export function BookRow({ item }: { item: BookItem }) {
  const tone = TONE_STYLES[item.tone];
  return (
    <li className="relative">
      <Link
        href={item.href}
        className="flex gap-3 border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50"
      >
        <span
          className={`mt-1 h-full w-1 shrink-0 self-stretch rounded-full ${tone.bar}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold tabular text-slate-400">{item.ref}</span>
            <Chip>{item.typeLabel}</Chip>
            <Badge tone={item.tone}>{item.statusLabel}</Badge>
            {item.priorityLabel && item.priorityTone ? (
              <Badge tone={item.priorityTone} withSymbol={false}>
                {item.priorityLabel}
              </Badge>
            ) : null}
            {item.overdue ? (
              <Badge tone="critico">Vencido</Badge>
            ) : null}
            {item.deleted ? <Badge tone="neutro">Eliminado</Badge> : null}
          </div>

          <p className="mt-1 font-medium text-petrol-900">{item.title}</p>
          {item.summary ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{item.summary}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatDateTime(item.date)}
            </span>
            {item.dueAt ? (
              <span className={item.overdue ? 'font-semibold text-red-700' : undefined}>
                Vence {relativeTime(item.dueAt)}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              {item.ownerName ? `Resp.: ${item.ownerName}` : 'Sin responsable'}
            </span>
            {item.creatorName ? <span>Registró: {item.creatorName}</span> : null}
            {item.departmentName ? <span>Área: {item.departmentName}</span> : null}
            {item.shiftLabel ? <span>Turno: {item.shiftLabel}</span> : null}
            {item.guestLabel ? <span>{item.guestLabel}</span> : null}
            {item.hasFollowUp ? (
              <span className="inline-flex items-center gap-1 text-petrol-600">
                <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                Con seguimiento
              </span>
            ) : null}
            {item.commentCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {item.commentCount}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function BookList({ items }: { items: BookItem[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <BookRow key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </ul>
  );
}
