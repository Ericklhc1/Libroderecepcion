import Link from 'next/link';
import { BedDouble, Search, Star } from 'lucide-react';
import { ReservationStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
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

const PAGE_SIZE = 25;

const RESERVATION_TONE = {
  PENDIENTE: 'pendiente',
  CONFIRMADA: 'curso',
  EN_CASA: 'resuelto',
  SALIDA: 'neutro',
  NO_SHOW: 'atencion',
  CANCELADA: 'neutro',
} as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function positivePage(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageHref(
  params: { q: string; habitacion: string; estado: string; rp: number; gp: number },
  patch: Partial<{ rp: number; gp: number }>,
) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.habitacion) search.set('habitacion', params.habitacion);
  if (params.estado) search.set('estado', params.estado);
  const rp = patch.rp ?? params.rp;
  const gp = patch.gp ?? params.gp;
  if (rp > 1) search.set('rp', String(rp));
  if (gp > 1) search.set('gp', String(gp));
  const query = search.toString();
  return query ? `/huespedes?${query}` : '/huespedes';
}

function Pager({
  current,
  total,
  href,
}: {
  current: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
      <span className="text-slate-500">Página {current} de {pages} · {total} registro(s)</span>
      <div className="flex gap-2">
        {current > 1 ? <Link href={href(current - 1)} className="rounded-lg px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">Anterior</Link> : null}
        {current < pages ? <Link href={href(current + 1)} className="rounded-lg px-3 py-1.5 font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">Siguiente</Link> : null}
      </div>
    </div>
  );
}

export default async function GuestsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageAnyPermission(['guest.view', 'guest.manage']);
  const canEdit = hasPermission(user, 'guest.manage');
  const params = await searchParams;
  const q = one(params.q).trim();
  const habitacion = one(params.habitacion).trim();
  const rawStatus = one(params.estado).trim();
  const status = Object.values(ReservationStatus).includes(rawStatus as ReservationStatus)
    ? (rawStatus as ReservationStatus)
    : null;
  const rp = positivePage(one(params.rp));
  const gp = positivePage(one(params.gp));

  const reservationWhere: Prisma.ReservationReferenceWhereInput = {
    deletedAt: null,
    ...(habitacion ? { roomNumber: { contains: habitacion, mode: 'insensitive' } } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { roomNumber: { contains: q, mode: 'insensitive' } },
            { channel: { contains: q, mode: 'insensitive' } },
            { actionNote: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
            { guest: { fullName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const guestWhere: Prisma.GuestReferenceWhereInput = {
    deletedAt: null,
    ...(habitacion ? { roomNumber: { contains: habitacion, mode: 'insensitive' } } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { roomNumber: { contains: q, mode: 'insensitive' } },
            { documentId: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
            { reservations: { some: { code: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [guests, reservations, guestTotal, reservationTotal, guestOptionsSource] = await Promise.all([
    prisma.guestReference.findMany({
      where: guestWhere,
      orderBy: [{ vip: 'desc' }, { fullName: 'asc' }],
      include: { _count: { select: { entries: true, reservations: true } } },
      skip: (gp - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.reservationReference.findMany({
      where: reservationWhere,
      orderBy: [{ requiresAction: 'desc' }, { checkIn: 'desc' }],
      include: {
        guest: { select: { id: true, fullName: true, vip: true } },
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
      skip: (rp - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.guestReference.count({ where: guestWhere }),
    prisma.reservationReference.count({ where: reservationWhere }),
    canEdit
      ? prisma.guestReference.findMany({
          where: { deletedAt: null },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true, roomNumber: true },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const guestOptions = guestOptionsSource.map((guest) => ({
    value: guest.id,
    label: `${guest.fullName}${guest.roomNumber ? ` · hab. ${guest.roomNumber}` : ''}`,
  }));
  const currentParams = { q, habitacion, estado: status ?? '', rp, gp };

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

      <form method="get" className="card flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-[220px] flex-1">
          <span className="label-base">Buscar localmente</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input name="q" defaultValue={q} className="input-base pl-9" placeholder="Reserva, huésped, canal, documento, teléfono…" />
          </span>
        </label>
        <label className="w-32">
          <span className="label-base">Habitación</span>
          <input name="habitacion" defaultValue={habitacion} className="input-base" placeholder="415" />
        </label>
        <label>
          <span className="label-base">Estado reserva</span>
          <select name="estado" defaultValue={status ?? ''} className="input-base">
            <option value="">Todos</option>
            {Object.values(ReservationStatus).map((value) => <option key={value} value={value}>{RESERVATION_STATUS_LABEL[value]}</option>)}
          </select>
        </label>
        <button className="rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-petrol-800" type="submit">Filtrar</button>
        {(q || habitacion || status) ? <Link href="/huespedes" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Limpiar</Link> : null}
      </form>

      <Card>
        <CardHeader
          title="Reservas"
          count={reservationTotal}
          action={
            canEdit ? (
              <ReservationDialog guests={guestOptions} trigger="Nueva reserva" title="Registrar reserva" />
            ) : null
          }
        />
        {reservations.length === 0 ? (
          <EmptyState message="Sin reservas que coincidan con los filtros." />
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
                      <Link href={`/huespedes/reservas/${reservation.id}`} className="font-medium text-petrol-700 hover:underline">{reservation.code}</Link>
                      <p className="text-xs text-slate-500">
                        {reservation.channel ?? 'Sin canal'}
                        {reservation.roomNumber ? ` · hab. ${reservation.roomNumber}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {reservation.guest ? (
                        <span className="inline-flex items-center gap-1 text-petrol-900">
                          {reservation.guest.vip ? <Star className="h-3.5 w-3.5 text-gold-500" aria-hidden="true" /> : null}
                          {reservation.guest.fullName}
                        </span>
                      ) : <span className="text-slate-400">Sin asociar</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      <p>Llegada: {formatDateTime(reservation.checkIn)}</p>
                      <p>Salida: {formatDateTime(reservation.checkOut)}</p>
                    </td>
                    <td className="px-4 py-2.5"><Badge tone={RESERVATION_TONE[reservation.status]}>{RESERVATION_STATUS_LABEL[reservation.status]}</Badge></td>
                    <td className="px-4 py-2.5">
                      <Badge tone={GUARANTEE_STATUS_TONE[reservation.guaranteeStatus]}>{GUARANTEE_STATUS_LABEL[reservation.guaranteeStatus]}</Badge>
                      <ul className="mt-1.5 space-y-1.5">
                        {reservation.guarantees.map((guarantee) => (
                          <li key={guarantee.id} className="text-xs">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={GUARANTEE_STATE_TONE[guarantee.state as GuaranteeStateValue]}>{GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue]}</Badge>
                              <span className="tabular font-medium text-petrol-900">{guarantee.currency} {guarantee.amount.toString()}</span>
                              <span className="text-slate-500">{GUARANTEE_KIND_LABELS[guarantee.kind as GuaranteeKindValue]}</span>
                            </span>
                            {guarantee.appliedAmount || guarantee.penaltyAmount ? (
                              <span className="mt-0.5 block text-slate-500">
                                {guarantee.appliedAmount ? `aplicado ${guarantee.appliedAmount.toString()}` : ''}
                                {guarantee.appliedAmount && guarantee.penaltyAmount ? ' · ' : ''}
                                {guarantee.penaltyAmount ? `multa ${guarantee.penaltyAmount.toString()}` : ''}
                              </span>
                            ) : null}
                            {canEdit ? <GuaranteeStateDialog guaranteeId={guarantee.id} state={guarantee.state as GuaranteeStateValue} amount={guarantee.amount.toString()} currency={guarantee.currency} /> : null}
                          </li>
                        ))}
                        {canEdit ? <li><GuaranteeDialog reservationId={reservation.id} reservationCode={reservation.code} /></li> : null}
                      </ul>
                    </td>
                    <td className="px-4 py-2.5 tabular">
                      {reservation.balanceDue && Number(reservation.balanceDue) > 0 ? <span className="font-semibold text-red-700">{formatMoney(Number(reservation.balanceDue))}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {reservation.requiresAction ? <p className="mb-1 text-xs text-orange-800">{reservation.actionNote ?? 'Requiere acción'}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/huespedes/reservas/${reservation.id}`} className="rounded-md px-2 py-1 text-xs font-semibold text-petrol-700 ring-1 ring-petrol-200 hover:bg-petrol-50">Ficha</Link>
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
                              balanceDue: reservation.balanceDue ? String(Number(reservation.balanceDue)) : '',
                              requiresAction: reservation.requiresAction,
                              actionNote: reservation.actionNote,
                              notes: reservation.notes,
                            }}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager current={rp} total={reservationTotal} href={(page) => pageHref(currentParams, { rp: page })} />
      </Card>

      <Card>
        <CardHeader title="Huéspedes" count={guestTotal} action={canEdit ? <GuestDialog trigger="Nuevo huésped" title="Registrar huésped" /> : null} />
        {guests.length === 0 ? (
          <EmptyState message="Sin huéspedes que coincidan con los filtros." />
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
                  {guest.notes ? <p className="mt-0.5 text-sm text-slate-600">{guest.notes}</p> : null}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {guest._count.entries} registro(s) asociado(s) · {guest._count.reservations} reserva(s)
                    {guest.email ? ` · ${guest.email}` : ''}{guest.phone ? ` · ${guest.phone}` : ''}
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
        <Pager current={gp} total={guestTotal} href={(page) => pageHref(currentParams, { gp: page })} />
      </Card>
    </div>
  );
}
