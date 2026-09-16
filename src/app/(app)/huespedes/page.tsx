import { BedDouble, Star } from 'lucide-react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import {
  GUARANTEE_STATUS_LABEL,
  GUARANTEE_STATUS_TONE,
  RESERVATION_STATUS_LABEL,
} from '@/domain/labels';
import { formatDateTime, formatMoney, toDateTimeInput } from '@/lib/format';
import { GuestDialog, ReservationDialog } from './guest-forms';
import { GuaranteeDialog, GuaranteeStateDialog } from './guarantee-forms';
import {
  GUARANTEE_KIND_LABELS,
  GUARANTEE_STATE_LABELS,
  GUARANTEE_STATE_TONE,
  type GuaranteeKindValue,
  type GuaranteeStateValue,
} from '@/domain/guarantees';

export const metadata = { title: 'Huéspedes y reservas' };
export const dynamic = 'force-dynamic';

const RESERVATION_TONE = {
  PENDIENTE: 'pendiente',
  CONFIRMADA: 'curso',
  EN_CASA: 'resuelto',
  SALIDA: 'neutro',
  NO_SHOW: 'atencion',
  CANCELADA: 'neutro',
} as const;

export default async function GuestsPage() {
  /*
    Basta el permiso de CONSULTA para entrar. Antes se exigía `guest.manage`,
    que además permite editar: un rol de sólo lectura no podía ni mirar.
  */
  const user = await requirePageAnyPermission(['guest.view', 'guest.manage']);
  const canEdit = hasPermission(user, 'guest.manage');

  const [guests, reservations] = await Promise.all([
    prisma.guestReference.findMany({
      where: { deletedAt: null },
      orderBy: [{ vip: 'desc' }, { fullName: 'asc' }],
      include: { _count: { select: { entries: true, reservations: true } } },
      take: 200,
    }),
    prisma.reservationReference.findMany({
      where: { deletedAt: null },
      orderBy: [{ requiresAction: 'desc' }, { checkIn: 'desc' }],
      include: {
        guest: { select: { id: true, fullName: true, vip: true } },
        // Las garantías viajan con la reserva: no hay consulta adicional.
        guarantees: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            kind: true,
            state: true,
            amount: true,
            currency: true,
            appliedAmount: true,
            penaltyAmount: true,
          },
        },
      },
      take: 200,
    }),
  ]);

  const guestOptions = guests.map((guest) => ({
    value: guest.id,
    label: `${guest.fullName}${guest.roomNumber ? ` · hab. ${guest.roomNumber}` : ''}`,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <BedDouble className="h-5 w-5 text-petrol-600" aria-hidden="true" />
          Huéspedes y reservas
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Referencias ligeras para asociar registros operativos. No reemplazan al PMS: quedan
          preparadas para sincronizarse con él más adelante.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Reservas"
          count={reservations.length}
          action={
            canEdit ? (
              <ReservationDialog
                guests={guestOptions}
                trigger="Nueva reserva"
                title="Registrar reserva"
              />
            ) : null
          }
        />
        {reservations.length === 0 ? (
          <EmptyState message="Sin reservas registradas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Reserva</th>
                  <th className="px-4 py-2 font-semibold">Huésped</th>
                  <th className="px-4 py-2 font-semibold">Estadía</th>
                  <th className="px-4 py-2 font-semibold">Estado</th>
                  <th className="px-4 py-2 font-semibold">Garantía</th>
                  <th className="px-4 py-2 font-semibold">Saldo</th>
                  <th className="px-4 py-2 font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reservations.map((reservation) => (
                  <tr key={reservation.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-petrol-900">{reservation.code}</p>
                      <p className="text-xs text-slate-500">
                        {reservation.channel ?? 'Sin canal'}
                        {reservation.roomNumber ? ` · hab. ${reservation.roomNumber}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {reservation.guest ? (
                        <span className="inline-flex items-center gap-1 text-petrol-900">
                          {reservation.guest.vip ? (
                            <Star className="h-3.5 w-3.5 text-gold-500" aria-hidden="true" />
                          ) : null}
                          {reservation.guest.fullName}
                        </span>
                      ) : (
                        <span className="text-slate-400">Sin asociar</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      <p>Llegada: {formatDateTime(reservation.checkIn)}</p>
                      <p>Salida: {formatDateTime(reservation.checkOut)}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={RESERVATION_TONE[reservation.status]}>
                        {RESERVATION_STATUS_LABEL[reservation.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={GUARANTEE_STATUS_TONE[reservation.guaranteeStatus]}>
                        {GUARANTEE_STATUS_LABEL[reservation.guaranteeStatus]}
                      </Badge>
                      {/*
                        El resumen de arriba se conserva porque lo leen el motor
                        de alertas y la entrega de turno. Debajo van las
                        garantías concretas, que son la fuente.
                      */}
                      <ul className="mt-1.5 space-y-1.5">
                        {reservation.guarantees.map((guarantee) => (
                          <li key={guarantee.id} className="text-xs">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                tone={GUARANTEE_STATE_TONE[guarantee.state as GuaranteeStateValue]}
                              >
                                {GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue]}
                              </Badge>
                              <span className="tabular font-medium text-petrol-900">
                                {guarantee.currency} {guarantee.amount.toString()}
                              </span>
                              <span className="text-slate-500">
                                {GUARANTEE_KIND_LABELS[guarantee.kind as GuaranteeKindValue]}
                              </span>
                            </span>
                            {guarantee.appliedAmount || guarantee.penaltyAmount ? (
                              <span className="mt-0.5 block text-slate-500">
                                {guarantee.appliedAmount
                                  ? `aplicado ${guarantee.appliedAmount.toString()}`
                                  : ''}
                                {guarantee.appliedAmount && guarantee.penaltyAmount ? ' · ' : ''}
                                {guarantee.penaltyAmount
                                  ? `multa ${guarantee.penaltyAmount.toString()}`
                                  : ''}
                              </span>
                            ) : null}
                            {canEdit ? (
                            <GuaranteeStateDialog
                              guaranteeId={guarantee.id}
                              state={guarantee.state as GuaranteeStateValue}
                              amount={guarantee.amount.toString()}
                              currency={guarantee.currency}
                            />
                            ) : null}
                          </li>
                        ))}
                        {canEdit ? (
                          <li>
                            <GuaranteeDialog
                              reservationId={reservation.id}
                              reservationCode={reservation.code}
                            />
                          </li>
                        ) : null}
                      </ul>
                    </td>
                    <td className="px-4 py-2.5 tabular">
                      {reservation.balanceDue && Number(reservation.balanceDue) > 0 ? (
                        <span className="font-semibold text-red-700">
                          {formatMoney(Number(reservation.balanceDue))}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {reservation.requiresAction ? (
                        <p className="mb-1 text-xs text-orange-800">
                          {reservation.actionNote ?? 'Requiere acción'}
                        </p>
                      ) : null}
                      {canEdit ? (
                      <ReservationDialog
                        guests={guestOptions}
                        trigger="Editar"
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
                          balanceDue: reservation.balanceDue
                            ? String(Number(reservation.balanceDue))
                            : '',
                          requiresAction: reservation.requiresAction,
                          actionNote: reservation.actionNote,
                          notes: reservation.notes,
                        }}
                      />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Huéspedes"
          count={guests.length}
          action={canEdit ? <GuestDialog trigger="Nuevo huésped" title="Registrar huésped" /> : null}
        />
        {guests.length === 0 ? (
          <EmptyState message="Sin huéspedes registrados." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {guests.map((guest) => (
              <li key={guest.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-petrol-900">{guest.fullName}</p>
                    {guest.vip ? <Badge tone="atencion">VIP</Badge> : null}
                    {guest.roomNumber ? <Chip>Hab. {guest.roomNumber}</Chip> : null}
                    {guest.language ? <Chip>{guest.language}</Chip> : null}
                  </div>
                  {guest.notes ? (
                    <p className="mt-0.5 text-sm text-slate-600">{guest.notes}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {guest._count.entries} registro(s) asociado(s) ·{' '}
                    {guest._count.reservations} reserva(s)
                    {guest.email ? ` · ${guest.email}` : ''}
                    {guest.phone ? ` · ${guest.phone}` : ''}
                  </p>
                </div>
                {canEdit ? (
                <GuestDialog
                  trigger="Editar"
                  title={`Editar ${guest.fullName}`}
                  defaults={{
                    id: guest.id,
                    fullName: guest.fullName,
                    roomNumber: guest.roomNumber,
                    documentId: guest.documentId,
                    email: guest.email,
                    phone: guest.phone,
                    language: guest.language,
                    vip: guest.vip,
                    notes: guest.notes,
                  }}
                />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
