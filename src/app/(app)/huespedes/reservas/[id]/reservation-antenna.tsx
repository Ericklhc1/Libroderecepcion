import Link from 'next/link';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import {
  reservationModuleSignals,
  type ReservationOperationalContext,
} from '@/server/services/reservation-context';

function money(value: { toString(): string } | null, currency: string | null) {
  if (value === null) return '—';
  return `${currency ?? ''} ${value.toString()}`.trim();
}

/**
 * La "antena" de la reserva: enseña qué módulos conocen el mismo código y,
 * debajo, la fotografía mínima que vino del PMS. No crea datos ni los resume
 * en otra tabla: sólo presenta las fuentes que ya existen.
 */
export function ReservationAntenna({ reservation }: { reservation: ReservationOperationalContext }) {
  const signals = reservationModuleSignals(reservation);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Contexto conectado" />
        <div className="flex flex-wrap gap-2 px-4 pb-4 text-xs">
          <Chip>PMS {signals.pms}</Chip>
          <Chip>Garantías {signals.guarantees}</Chip>
          <Chip>Caja {signals.cash}</Chip>
          <Chip>Multas {signals.fines}</Chip>
          <Chip>Libro {signals.book}</Chip>
          <Chip>Tareas {signals.tasks}</Chip>
          <Chip>Seguimientos {signals.followUps}</Chip>
          <Chip>Alertas {signals.alerts}</Chip>
          <Chip>Llaves {signals.keys}</Chip>
          <Chip>Gimnasio {signals.gym}</Chip>
          <Chip>Comentarios {signals.comments}</Chip>
        </div>
      </Card>

      <Card>
        <CardHeader title="Informe de actividad · datos PMS" count={reservation.stays.length} />
        {reservation.stays.length === 0 ? (
          <EmptyState message="Esta reserva todavía no tiene una estadía importada desde el PMS." />
        ) : (
          <div className="divide-y divide-slate-100">
            {reservation.stays.map((stay) => (
              <div key={stay.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-petrol-900">
                        {stay.room ? `Habitación ${stay.room.number}` : 'Sin habitación'}
                      </p>
                      <Badge tone={stay.stage === 'FINALIZADO' ? 'neutro' : stay.stage === 'CONFIRMADO' ? 'resuelto' : 'pendiente'}>
                        {stay.status.replaceAll('_', ' ')}
                      </Badge>
                      <Chip>{stay.sourceReport}</Chip>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">
                      {stay.guestNames.join(', ') || reservation.guest?.fullName || 'Sin huésped'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {stay.guestCount ?? '—'} huésped(es) · llegada {formatDateTime(stay.arrivalDate)} · salida {formatDateTime(stay.departureDate)}
                    </p>
                  </div>
                  {stay.room ? (
                    <Link href={`/habitaciones/${stay.room.number}`} className="text-xs font-medium text-petrol-600 hover:underline">
                      Abrir habitación
                    </Link>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Total PMS</p>
                    <p className="mt-0.5 font-semibold tabular text-petrol-900">{money(stay.totalAmount, stay.currency)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Pendiente PMS</p>
                    <p className="mt-0.5 font-semibold tabular text-petrol-900">{money(stay.pendingAmount, stay.currency)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Forma de pago</p>
                    <p className="mt-0.5 font-medium text-petrol-900">{stay.paymentTypeRaw ?? stay.paymentType ?? '—'}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Estado PMS</p>
                    <p className="mt-0.5 font-medium text-petrol-900">{stay.pmsStatus ?? '—'}</p>
                  </div>
                </div>

                {stay.note ? <p className="mt-2 text-xs text-slate-600">Nota de estadía: {stay.note}</p> : null}
                {stay.keys.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {stay.keys.map((key) => <Chip key={key.id}>Llave {key.code} · {key.status.replaceAll('_', ' ')}</Chip>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Libro, tareas, seguimientos y comentarios" count={reservation.entries.length} />
        {reservation.entries.length === 0 ? (
          <EmptyState message="No hay registros del Libro vinculados a esta reserva." />
        ) : (
          <div className="divide-y divide-slate-100">
            {reservation.entries.map((entry) => (
              <div key={entry.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-petrol-900">#{entry.seq} · {entry.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.type} · {entry.status} · {entry.room ? `Hab. ${entry.room.number} · ` : ''}{formatDateTime(entry.occurredAt)}
                    </p>
                  </div>
                  <Link href={`/libro/${entry.id}`} className="text-xs font-medium text-petrol-600 hover:underline">Abrir registro</Link>
                </div>
                <p className="mt-2 text-slate-700">{entry.description}</p>

                {entry.tasks.length || entry.followUps.length ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {entry.tasks.map((task) => (
                      <Chip key={task.id}>Tarea #{task.seq} · {task.status}{task.assignee ? ` · ${task.assignee.name}` : ''}</Chip>
                    ))}
                    {entry.followUps.map((followUp) => (
                      <Chip key={followUp.id}>Seguimiento · {followUp.status} · {followUp.owner.name}</Chip>
                    ))}
                  </div>
                ) : null}

                {entry.comments.length ? (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600">Comentarios del registro</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {entry.comments.map((comment) => (
                        <li key={comment.id} className="text-xs text-slate-700">
                          <span className="font-medium">{comment.author.name}:</span> {comment.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {reservation.alerts.length ? (
        <Card>
          <CardHeader title="Alertas de la reserva" count={reservation.alerts.length} />
          <ul className="divide-y divide-slate-100">
            {reservation.alerts.map((alert) => (
              <li key={alert.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={alert.status === 'RESUELTA' ? 'resuelto' : alert.level === 'CRITICA' ? 'atencion' : 'pendiente'}>{alert.status}</Badge>
                  <p className="font-medium text-petrol-900">{alert.title}</p>
                </div>
                {alert.message ? <p className="mt-1 text-slate-700">{alert.message}</p> : null}
                {alert.comments.map((comment) => (
                  <p key={comment.id} className="mt-1 text-xs text-slate-600"><span className="font-medium">{comment.author.name}:</span> {comment.body}</p>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
