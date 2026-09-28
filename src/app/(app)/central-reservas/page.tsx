import Link from 'next/link';
import { CalendarClock, CheckCircle2, ClipboardList, Search, ShieldAlert } from 'lucide-react';
import { GuaranteeStatus, ReservationStatus } from '@prisma/client';
import { requirePagePermission } from '@/server/auth/guard';
import { getReservationCenterSnapshot } from '@/server/services/reservation-center';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import {
  GUARANTEE_STATUS_LABEL,
  GUARANTEE_STATUS_TONE,
  RESERVATION_STATUS_LABEL,
} from '@/domain/labels';

export const metadata = { title: 'Central de Reservas' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function needsAttention(reservation: {
  requiresAction: boolean;
  guaranteeStatus: GuaranteeStatus;
  balanceDue: { toString(): string } | null;
}): boolean {
  return (
    reservation.requiresAction ||
    reservation.guaranteeStatus === GuaranteeStatus.PENDIENTE ||
    reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA ||
    Number(reservation.balanceDue ?? 0) > 0
  );
}

export default async function CentralReservationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePagePermission('reservation.center.view');
  const params = await searchParams;
  const q = one(params.q).trim().toLowerCase();
  const view = one(params.vista);
  const snapshot = await getReservationCenterSnapshot();

  const counts = {
    attention: snapshot.reservations.filter(needsAttention).length,
    next24: snapshot.reservations.filter(
      (reservation) =>
        reservation.checkIn &&
        reservation.checkIn >= snapshot.now &&
        reservation.checkIn <= snapshot.horizons.in24Hours &&
        [ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA].includes(reservation.status),
    ).length,
    next72: snapshot.reservations.filter(
      (reservation) =>
        reservation.checkIn &&
        reservation.checkIn >= snapshot.now &&
        reservation.checkIn <= snapshot.horizons.in72Hours &&
        [ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA].includes(reservation.status),
    ).length,
    recent: snapshot.reservations.filter(
      (reservation) => reservation.updatedAt >= snapshot.horizons.oneDayAgo,
    ).length,
  };

  const reservations = snapshot.reservations.filter((reservation) => {
    const text = [
      reservation.code,
      reservation.guest?.fullName,
      reservation.roomNumber,
      reservation.channel,
      reservation.actionNote,
      reservation.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (q && !text.includes(q)) return false;

    if (view === 'accion' && !needsAttention(reservation)) return false;
    if (
      view === '24h' &&
      !(
        reservation.checkIn &&
        reservation.checkIn >= snapshot.now &&
        reservation.checkIn <= snapshot.horizons.in24Hours
      )
    ) return false;
    if (
      view === '72h' &&
      !(
        reservation.checkIn &&
        reservation.checkIn >= snapshot.now &&
        reservation.checkIn <= snapshot.horizons.in72Hours
      )
    ) return false;
    if (view === 'recientes' && reservation.updatedAt < snapshot.horizons.oneDayAgo) return false;
    return true;
  });

  const filterHref = (value: string) => {
    const search = new URLSearchParams();
    if (value) search.set('vista', value);
    if (q) search.set('q', q);
    const suffix = search.toString();
    return suffix ? `/central-reservas?${suffix}` : '/central-reservas';
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-petrol-600">
          Preparación antes de la operación
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-petrol-900">Central de Reservas</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Pendientes, garantías, saldos, cambios y llegadas próximas. Esta bandeja organiza señales
          del Libro; no reemplaza al PMS ni crea una segunda fuente de reserva.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Requieren acción', counts.attention, 'accion', ShieldAlert],
          ['Llegadas ≤ 24 h', counts.next24, '24h', CalendarClock],
          ['Llegadas ≤ 72 h', counts.next72, '72h', ClipboardList],
          ['Cambios últimas 24 h', counts.recent, 'recientes', CheckCircle2],
        ].map(([label, count, value, Icon]) => (
          <Link key={String(value)} href={filterHref(String(value))}>
            <Card className={view === value ? 'ring-2 ring-petrol-500' : ''}>
              <div className="flex items-center justify-between p-4">
                <div><p className="text-xs text-slate-500">{String(label)}</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{String(count)}</p></div>
                <Icon className="h-5 w-5 text-petrol-600" aria-hidden="true" />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 p-3">
        {view ? <input type="hidden" name="vista" value={view} /> : null}
        <label className="min-w-[18rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Buscar</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              className="input-base w-full pl-9"
              name="q"
              defaultValue={q}
              placeholder="Código, huésped, habitación, canal o pendiente…"
            />
          </span>
        </label>
        <button type="submit" className="rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-petrol-800">Filtrar</button>
        <Link href="/central-reservas" className="rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">Limpiar</Link>
      </form>

      <Card>
        <CardHeader title="Reservas a trabajar" count={reservations.length} />
        {reservations.length === 0 ? (
          <EmptyState message="No hay reservas que coincidan con este filtro." />
        ) : (
          <CardScroll maxHeight="max-h-[42rem]">
            <ul className="divide-y divide-slate-100">
              {reservations.map((reservation) => (
                <li key={reservation.id} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/huespedes/reservas/${reservation.id}`} className="font-semibold text-petrol-900 hover:underline">
                          {reservation.code}
                        </Link>
                        <Badge tone={GUARANTEE_STATUS_TONE[reservation.guaranteeStatus]}>
                          {GUARANTEE_STATUS_LABEL[reservation.guaranteeStatus]}
                        </Badge>
                        <Chip>{RESERVATION_STATUS_LABEL[reservation.status]}</Chip>
                        {reservation.guest?.vip ? <Chip>VIP</Chip> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {reservation.guest?.fullName ?? 'Sin huésped asociado'}
                        {reservation.roomNumber ? ` · Hab. ${reservation.roomNumber}` : ''}
                        {reservation.channel ? ` · ${reservation.channel}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Llegada {formatDateTime(reservation.checkIn)} · salida {formatDateTime(reservation.checkOut)}
                      </p>
                      {reservation.actionNote ? <p className="mt-1 text-sm font-medium text-orange-800">{reservation.actionNote}</p> : null}
                      {reservation.balanceDue && Number(reservation.balanceDue) > 0 ? <p className="mt-1 text-xs font-medium text-red-700">Saldo pendiente: {reservation.balanceDue.toString()}</p> : null}
                    </div>
                    <Link href={`/huespedes/reservas/${reservation.id}`} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">
                      Abrir / gestionar
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </CardScroll>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Tareas de reservas" count={snapshot.tasks.length} href="/tareas" hrefLabel="Ver todas" />
          {snapshot.tasks.length === 0 ? <EmptyState message="Sin tareas abiertas vinculadas." /> : (
            <CardScroll><ul className="divide-y divide-slate-100">{snapshot.tasks.slice(0, 12).map((task) => (
              <li key={task.id} className="px-4 py-3 text-sm"><Link href={`/tareas/${task.id}`} className="font-medium text-petrol-900 hover:underline">#{task.humanId} · {task.title}</Link><p className="mt-1 text-xs text-slate-500">{task.reservation?.code ?? 'Reserva'} · {task.assignee?.name ?? 'Sin responsable'} · {task.status.replaceAll('_', ' ')}</p></li>
            ))}</ul></CardScroll>
          )}
        </Card>
        <Card>
          <CardHeader title="Alertas de reservas" count={snapshot.alerts.length} href="/alertas" hrefLabel="Abrir alertas" />
          {snapshot.alerts.length === 0 ? <EmptyState message="Sin alertas abiertas vinculadas." /> : (
            <CardScroll><ul className="divide-y divide-slate-100">{snapshot.alerts.slice(0, 12).map((alert) => (
              <li key={alert.id} className="px-4 py-3 text-sm"><p className="font-medium text-petrol-900">#{alert.humanId} · {alert.title}</p><p className="mt-1 text-xs text-slate-500">{alert.reservation?.code ?? 'Reserva'} · {alert.level.replaceAll('_', ' ')}</p></li>
            ))}</ul></CardScroll>
          )}
        </Card>
        <Card>
          <CardHeader title="Seguimientos de reservas" count={snapshot.followUps.length} href="/seguimientos" hrefLabel="Ver todos" />
          {snapshot.followUps.length === 0 ? <EmptyState message="Sin seguimientos abiertos vinculados." /> : (
            <CardScroll><ul className="divide-y divide-slate-100">{snapshot.followUps.slice(0, 12).map((followUp) => (
              <li key={followUp.id} className="px-4 py-3 text-sm"><p className="font-medium text-petrol-900">#{followUp.humanId} · {followUp.nextAction ?? followUp.action}</p><p className="mt-1 text-xs text-slate-500">{followUp.owner.name} · {followUp.status.replaceAll('_', ' ')} · {formatDateTime(followUp.scheduledAt)}</p></li>
            ))}</ul></CardScroll>
          )}
        </Card>
      </div>
    </div>
  );
}
