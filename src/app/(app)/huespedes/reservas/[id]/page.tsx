import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BedDouble, Banknote, ShieldCheck } from 'lucide-react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { getReservationProfile } from '@/server/services/reservation-core';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { formatDateTime, toDateTimeInput } from '@/lib/format';
import { ReservationDialog } from '../../guest-forms';
import { GuaranteeDialog, GuaranteeStateDialog } from '../../guarantee-forms';
import {
  GUARANTEE_STATUS_LABEL,
  GUARANTEE_STATUS_TONE,
  RESERVATION_STATUS_LABEL,
} from '@/domain/labels';
import {
  GUARANTEE_KIND_LABELS,
  GUARANTEE_STATE_LABELS,
  GUARANTEE_STATE_TONE,
  type GuaranteeKindValue,
  type GuaranteeStateValue,
} from '@/domain/guarantees';

export const dynamic = 'force-dynamic';

export default async function ReservationProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAnyPermission(['guest.view', 'guest.manage']);
  const { id } = await params;
  const [reservation, guests] = await Promise.all([
    getReservationProfile(id),
    prisma.guestReference.findMany({
      where: { deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, roomNumber: true },
      take: 500,
    }),
  ]);
  if (!reservation) notFound();

  const canEdit = hasPermission(user, 'guest.manage');
  const guestOptions = guests.map((guest) => ({
    value: guest.id,
    label: `${guest.fullName}${guest.roomNumber ? ` · hab. ${guest.roomNumber}` : ''}`,
  }));
  const linkedRooms = [...new Set(reservation.stays.map((stay) => stay.room?.number).filter(Boolean))] as string[];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="no-print">
        <Link href="/huespedes" className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Reservas y huéspedes
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-petrol-900">Reserva {reservation.code}</h1>
            <Badge tone={GUARANTEE_STATUS_TONE[reservation.guaranteeStatus]}>
              {GUARANTEE_STATUS_LABEL[reservation.guaranteeStatus]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {reservation.guest?.fullName ?? 'Sin huésped asociado'}
            {linkedRooms.length ? ` · ${linkedRooms.map((room) => `Hab. ${room}`).join(', ')}` : ''}
          </p>
        </div>
        {canEdit ? (
          <ReservationDialog
            guests={guestOptions}
            trigger="Editar reserva"
            title={`Editar reserva ${reservation.code}`}
            defaults={{
              id: reservation.id,
              code: reservation.code,
              guestId: reservation.guestId,
              roomNumber: reservation.roomNumber,
              checkIn: toDateTimeInput(reservation.checkIn),
              checkOut: toDateTimeInput(reservation.checkOut),
              channel: reservation.channel,
              status: reservation.status,
              guaranteeStatus: reservation.guaranteeStatus,
              balanceDue: reservation.balanceDue ? String(Number(reservation.balanceDue)) : '',
              requiresAction: reservation.requiresAction,
              actionNote: reservation.actionNote,
              notes: reservation.notes,
            }}
          />
        ) : null}
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card><div className="p-4"><p className="text-xs text-slate-500">Estado</p><p className="mt-1 font-semibold text-petrol-900">{RESERVATION_STATUS_LABEL[reservation.status]}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">Llegada</p><p className="mt-1 font-semibold text-petrol-900">{formatDateTime(reservation.checkIn)}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">Salida</p><p className="mt-1 font-semibold text-petrol-900">{formatDateTime(reservation.checkOut)}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">Canal</p><p className="mt-1 font-semibold text-petrol-900">{reservation.channel ?? '—'}</p></div></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Garantías"
            count={reservation.guarantees.length}
            action={canEdit ? <GuaranteeDialog reservationId={reservation.id} reservationCode={reservation.code} /> : null}
          />
          {reservation.guarantees.length === 0 ? <EmptyState message="Sin garantías registradas." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.guarantees.map((guarantee) => (
                <li key={guarantee.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={GUARANTEE_STATE_TONE[guarantee.state as GuaranteeStateValue]}>{GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue]}</Badge>
                        <Chip>{GUARANTEE_KIND_LABELS[guarantee.kind as GuaranteeKindValue]}</Chip>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Ingresada por {guarantee.createdBy.name} · {formatDateTime(guarantee.createdAt)}</p>
                      {guarantee.returnedAt ? <p className="text-xs text-slate-500">Devuelta {formatDateTime(guarantee.returnedAt)}{guarantee.returnedBy ? ` · ${guarantee.returnedBy.name}` : ''}</p> : null}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular text-petrol-900">{guarantee.currency} {guarantee.amount.toString()}</p>
                      {canEdit ? <GuaranteeStateDialog guaranteeId={guarantee.id} state={guarantee.state as GuaranteeStateValue} amount={guarantee.amount.toString()} currency={guarantee.currency} /> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Estadías y habitaciones" count={reservation.stays.length} />
          {reservation.stays.length === 0 ? <EmptyState message="Aún no hay estadías enlazadas a esta reserva." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.stays.map((stay) => (
                <li key={stay.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-petrol-900">{stay.room ? `Habitación ${stay.room.number}` : 'Sin habitación'}</p>
                      <p className="text-xs text-slate-500">{stay.guestNames.join(', ') || 'Sin huésped'} · {stay.status.replaceAll('_', ' ')}</p>
                    </div>
                    {stay.room ? <Link href={`/habitaciones/${stay.room.number}`} className="inline-flex items-center gap-1 text-xs font-medium text-petrol-600 hover:underline"><BedDouble className="h-3.5 w-3.5" />Ver habitación</Link> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Caja vinculada" count={reservation.cashMovements.length} />
          {reservation.cashMovements.length === 0 ? <EmptyState message="Sin movimientos de caja asociados." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.cashMovements.map((movement) => (
                <li key={movement.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div><p className="font-medium text-petrol-900">{movement.reference ?? movement.kind}</p><p className="text-xs text-slate-500">{movement.createdBy.name} · {formatDateTime(movement.createdAt)}</p></div>
                  <p className={`font-semibold tabular ${movement.direction === 'ENTRADA' ? 'text-emerald-700' : 'text-red-700'}`}>{movement.direction === 'ENTRADA' ? '+' : '−'}{movement.currency} {movement.amount.toString()}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Multas" count={reservation.fines.length} />
          {reservation.fines.length === 0 ? <EmptyState message="Sin multas asociadas." /> : (
            <ul className="divide-y divide-slate-100">
              {reservation.fines.map((fine) => (
                <li key={fine.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium text-petrol-900">{fine.room ? `Hab. ${fine.room.number}` : 'Sin habitación'} · {fine.reason}</p><p className="text-xs text-slate-500">{fine.createdBy.name} · {formatDateTime(fine.createdAt)}</p></div><p className="font-semibold tabular text-petrol-900">{fine.amount ? `${fine.currency} ${fine.amount.toString()}` : 'Sin monto'}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {reservation.requiresAction ? <Card><div className="p-4"><div className="flex items-center gap-2 text-orange-800"><ShieldCheck className="h-4 w-4" /><p className="font-semibold">Requiere acción</p></div><p className="mt-1 text-sm text-slate-700">{reservation.actionNote ?? 'Recepción debe revisar esta reserva.'}</p></div></Card> : null}

      {reservation.balanceDue && Number(reservation.balanceDue) > 0 ? <p className="flex items-center gap-2 text-sm font-medium text-red-700"><Banknote className="h-4 w-4" />Saldo pendiente registrado: {reservation.balanceDue.toString()}</p> : null}
    </div>
  );
}
