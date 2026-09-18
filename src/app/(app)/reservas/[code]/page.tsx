import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Banknote, BedDouble, Bell, BookOpen, KeyRound, MessageSquare, ShieldCheck } from 'lucide-react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import {
  getReservationOperationalContextByCode,
  reservationModuleSignals,
} from '@/server/services/reservation-context';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { formatDate, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STAY_LABEL: Record<string, string> = {
  CHECK_IN: 'Cola de check-in',
  IN_HOUSE: 'In house',
  CHECK_OUT: 'Salida',
};

export default async function ReservationFolderPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requirePageAnyPermission(['room.view', 'guest.view', 'guest.manage']);
  const { code } = await params;
  const reservation = await getReservationOperationalContextByCode(decodeURIComponent(code));
  if (!reservation) notFound();

  const signals = reservationModuleSignals(reservation);
  const activeRooms = [
    ...new Set(
      reservation.stays
        .filter((stay) => stay.stage !== 'FINALIZADO' && stay.room?.number)
        .map((stay) => stay.room!.number),
    ),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="no-print">
        <Link href="/reservas" className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver a Reservas
        </Link>
      </div>

      <header className="rounded-xl bg-petrol-950 px-5 py-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-300">Carpeta de reserva</p>
            <h1 className="mt-1 text-2xl font-semibold tabular">ID FNS {reservation.code}</h1>
            <p className="mt-1 text-sm text-slate-200">
              {reservation.guest?.fullName ?? 'Sin huésped asociado'}
              {activeRooms.length ? ` · ${activeRooms.map((room) => `Hab. ${room}`).join(', ')}` : ' · Sin habitación asignada'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip>{reservation.status.replaceAll('_', ' ')}</Chip>
            <Chip>{reservation.channel ?? 'Sin canal'}</Chip>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div><p className="text-xs text-slate-400">Llegada</p><p className="font-medium">{reservation.checkIn ? formatDateTime(reservation.checkIn) : '—'}</p></div>
          <div><p className="text-xs text-slate-400">Salida</p><p className="font-medium">{reservation.checkOut ? formatDateTime(reservation.checkOut) : '—'}</p></div>
          <div><p className="text-xs text-slate-400">Garantía</p><p className="font-medium">{reservation.guaranteeStatus.replaceAll('_', ' ')}</p></div>
          <div><p className="text-xs text-slate-400">Saldo pendiente</p><p className="font-medium tabular">{reservation.balanceDue ? reservation.balanceDue.toString() : '—'}</p></div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ['Estadías', signals.pms],
          ['Caja', signals.cash],
          ['Garantías', signals.guarantees],
          ['Novedades', signals.book],
          ['Alertas', signals.alerts],
          ['Llaves', signals.keys],
          ['Multas', signals.fines],
          ['Comentarios', signals.comments],
        ].map(([label, value]) => (
          <Card key={label as string}><div className="p-3 text-center"><p className="text-lg font-semibold tabular text-petrol-900">{value}</p><p className="text-[0.68rem] text-slate-500">{label}</p></div></Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Habitaciones y estados de estadía" count={reservation.stays.length} />
          {reservation.stays.length === 0 ? <EmptyState message="Sin estadías asociadas." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.stays.map((stay) => (
                <li key={stay.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 font-medium text-petrol-900">
                        <BedDouble className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                        {stay.room ? `Habitación ${stay.room.number}` : 'Sin habitación'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {STAY_LABEL[stay.status] ?? stay.status} · {stay.stage.toLowerCase().replaceAll('_', ' ')}
                        {stay.businessDate ? ` · informe ${formatDate(stay.businessDate)}` : ''}
                      </p>
                    </div>
                    {stay.room ? (
                      <Link href={`/habitaciones/${stay.room.number}`} className="text-xs font-medium text-petrol-600 hover:underline">Abrir habitación</Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Garantías" count={reservation.guarantees.length} />
          {reservation.guarantees.length === 0 ? <EmptyState message="Sin garantías." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.guarantees.map((guarantee) => (
                <li key={guarantee.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="flex items-center gap-2 font-medium text-petrol-900"><ShieldCheck className="h-4 w-4" />{guarantee.kind.replaceAll('_', ' ')}</p>
                    <p className="text-xs text-slate-500">{guarantee.state.replaceAll('_', ' ')} · {formatDateTime(guarantee.createdAt)}</p>
                  </div>
                  <p className="font-semibold tabular text-petrol-900">{guarantee.currency} {guarantee.amount.toString()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Caja vinculada al ID FNS" count={reservation.cashMovements.length} href="/caja" hrefLabel="Abrir Caja" />
          {reservation.cashMovements.length === 0 ? <EmptyState message="Sin movimientos de Caja asociados." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.cashMovements.map((movement) => (
                <li key={movement.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="flex items-center gap-2 font-medium text-petrol-900"><Banknote className="h-4 w-4" />{movement.reference ?? movement.kind}</p>
                    <p className="text-xs text-slate-500">{movement.createdBy.name} · {formatDateTime(movement.createdAt)}</p>
                  </div>
                  <p className={`font-semibold tabular ${movement.direction === 'ENTRADA' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {movement.direction === 'ENTRADA' ? '+' : '−'}{movement.currency} {movement.amount.toString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Llaves vinculadas" count={signals.keys} href="/llaves" hrefLabel="Abrir control de llaves" />
          {signals.keys === 0 ? <EmptyState message="Sin llaves vinculadas a las estadías de este ID." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.stays.flatMap((stay) => stay.keys.map((key) => ({ key, stay }))).map(({ key, stay }) => (
                <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="flex items-center gap-2 font-medium text-petrol-900"><KeyRound className="h-4 w-4" />{key.code}</p>
                    <p className="text-xs text-slate-500">{stay.room ? `Hab. ${stay.room.number}` : 'Sin habitación'} · {key.type.toLowerCase()}</p>
                  </div>
                  <Badge tone={key.status === 'DISPONIBLE' ? 'resuelto' : 'pendiente'}>{key.status.replaceAll('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Novedades, incidencias y comentarios" count={reservation.entries.length} href="/libro" hrefLabel="Abrir Libro" />
        {reservation.entries.length === 0 ? <EmptyState message="Este ID aún no tiene novedades ni incidencias." /> : (
          <ul className="divide-y divide-slate-100">
            {reservation.entries.map((entry) => (
              <li key={entry.id} className="px-4 py-3">
                <Link href={`/libro/${entry.id}`} className="block">
                  <div className="flex flex-wrap items-center gap-2">
                    <BookOpen className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                    <span className="font-medium text-petrol-900">{entry.title}</span>
                    <Badge tone="neutro">{entry.type.replaceAll('_', ' ')}</Badge>
                    <Badge tone="pendiente">{entry.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{entry.description}</p>
                  <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>{entry.createdBy.name} · {formatDateTime(entry.occurredAt)}</span>
                    {entry.room ? <span>Hab. {entry.room.number}</span> : null}
                    {entry.comments.length ? <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{entry.comments.length} comentario(s)</span> : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {reservation.alerts.length > 0 ? (
        <Card>
          <CardHeader title="Alertas del ID FNS" count={reservation.alerts.length} />
          <ul className="divide-y divide-slate-100">
            {reservation.alerts.map((alert) => (
              <li key={alert.id} className="px-4 py-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-petrol-900"><Bell className="h-4 w-4" />{alert.title}</p>
                {alert.message ? <p className="mt-1 text-slate-600">{alert.message}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
