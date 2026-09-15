import { formatDateTime } from '@/lib/format';
import type { HistoryEvent } from '@/server/services/history';

const KIND_STYLE: Record<HistoryEvent['kind'], string> = {
  auditoria: 'bg-petrol-600',
  comentario: 'bg-gold-500',
  seguimiento: 'bg-sky-500',
};

function renderDiff(before: unknown, after: unknown) {
  if (!before && !after) return null;
  const format = (value: unknown) =>
    value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
          .map(([key, val]) => `${key}: ${val === null ? '—' : String(val)}`)
          .join(' · ')
      : String(value ?? '—');

  return (
    <dl className="mt-1 space-y-0.5 text-xs text-slate-500">
      {before && Object.keys(before as object).length > 0 ? (
        <div>
          <dt className="inline font-medium">Antes: </dt>
          <dd className="inline">{format(before)}</dd>
        </div>
      ) : null}
      {after && Object.keys(after as object).length > 0 ? (
        <div>
          <dt className="inline font-medium">Después: </dt>
          <dd className="inline">{format(after)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Historial cronológico de un registro: creación, cambios, comentarios, cierre. */
export function HistoryTimeline({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) {
    return <p className="px-4 py-6 text-sm text-slate-500">Sin movimientos registrados todavía.</p>;
  }

  return (
    <ol className="relative space-y-4 py-4 pl-8 pr-4">
      <span className="absolute left-[15px] top-6 bottom-6 w-px bg-slate-200" aria-hidden="true" />
      {events.map((event) => (
        <li key={`${event.kind}-${event.id}`} className="relative">
          <span
            className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${KIND_STYLE[event.kind]}`}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-semibold text-petrol-700">
              {event.actionLabel}
            </span>
            <time className="text-xs tabular text-slate-400">{formatDateTime(event.at)}</time>
            <span className="text-xs text-slate-500">· {event.actorName}</span>
          </div>
          <p className="mt-0.5 text-sm text-petrol-900">{event.summary}</p>
          {event.detail ? (
            <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {event.detail}
            </p>
          ) : null}
          {event.reason ? (
            <p className="mt-1 text-xs text-slate-500">Motivo: {event.reason}</p>
          ) : null}
          {renderDiff(event.before, event.after)}
        </li>
      ))}
    </ol>
  );
}
