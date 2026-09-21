import Link from 'next/link';
import { FileUp, Folder, FolderOpen, Search } from 'lucide-react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { listReservationFolders } from '@/server/services/reservation-folders';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Badge, Chip } from '@/components/ui/badge';
import { ReservationDialog } from '@/app/(app)/huespedes/guest-forms';
import { formatDate } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Contexto PMS' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  CHECK_IN: 'Cola de check-in',
  IN_HOUSE: 'In house',
  CHECK_OUT: 'Salida',
};

const STATUS_TONE = {
  CHECK_IN: 'pendiente',
  IN_HOUSE: 'curso',
  CHECK_OUT: 'atencion',
} as const;

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageAnyPermission(['room.view', 'guest.view', 'guest.manage']);
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const estado = typeof params.estado === 'string' ? params.estado : '';
  const canManage = hasPermission(user, 'guest.manage');
  const canImport = hasPermission(user, 'pms.import');

  const [folders, guests] = await Promise.all([
    listReservationFolders(),
    canManage
      ? prisma.guestReference.findMany({
          where: { deletedAt: null },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true, roomNumber: true },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const guestOptions = guests.map((guest) => ({
    value: guest.id,
    label: `${guest.fullName}${guest.roomNumber ? ` · hab. ${guest.roomNumber}` : ''}`,
  }));

  const reservationMatches = (reservation: (typeof folders.unassigned)[number]) => {
    const searchText = [
      reservation.fnsId,
      reservation.guestName,
      reservation.status,
      reservation.checkIn?.toISOString(),
      reservation.checkOut?.toISOString(),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return (!q || searchText.includes(q)) && (!estado || reservation.status === estado);
  };

  const visibleUnassigned = folders.unassigned.filter(reservationMatches);
  const visibleRooms = folders.rooms
    .map((room) => {
      const roomMatches =
        !q ||
        [room.roomNumber, room.floor ? `piso ${room.floor}` : '']
          .join(' ')
          .toLowerCase()
          .includes(q);
      const reservations = room.reservations.filter((reservation) => {
        const searchText = [
          reservation.fnsId,
          reservation.guestName,
          reservation.status,
          room.roomNumber,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return (!q || roomMatches || searchText.includes(q)) && (!estado || reservation.status === estado);
      });
      return { ...room, reservations };
    })
    .filter((room) => room.reservations.length > 0 || (!estado && q && room.roomNumber.toLowerCase().includes(q)));

  const activeIds = visibleRooms.reduce((total, room) => total + room.reservations.length, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-petrol-900">
            <FolderOpen className="h-6 w-6 text-gold-600" aria-hidden="true" />
            Contexto PMS
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Consulta opcional de la evidencia del PMS. Cuando exista un ID FNS, úsalo para cruzar habitación, estadía y huésped; Novedades, Caja y Llaves siguen operables sin convertir la reserva en requisito.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          {canImport ? (
            <Link
              href="/huespedes/importar"
              className="inline-flex items-center gap-2 rounded-lg bg-petrol-800 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-700"
            >
              <FileUp className="h-4 w-4" aria-hidden="true" />
              Cargar informes PMS
            </Link>
          ) : null}
          {canManage ? (
            <ReservationDialog
              guests={guestOptions}
              trigger="Nueva reserva"
              title="Registrar reserva"
            />
          ) : null}
        </div>
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar habitación, ID FNS, huésped…"
        clearHref="/reservas"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
          <select name="estado" defaultValue={estado} className="input-base w-full">
            <option value="">Todos</option>
            <option value="CHECK_IN">Cola de check-in</option>
            <option value="IN_HOUSE">In house</option>
            <option value="CHECK_OUT">Salida</option>
          </select>
        </label>
      </ListFilterBar>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><div className="p-4"><p className="text-xs text-slate-500">Habitaciones visibles</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{visibleRooms.length}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">ID FNS visibles</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{activeIds}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">Sin habitación visibles</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{visibleUnassigned.length}</p></div></Card>
      </div>

      {visibleUnassigned.length > 0 ? (
        <Card className="border-gold-300">
          <CardHeader title="Reservas sin habitación asignada" count={visibleUnassigned.length} />
          <CardScroll>
            <div className="divide-y divide-slate-100">
            {visibleUnassigned.map((reservation) => (
              <Link
                key={reservation.reservationRefId}
                href={`/reservas/${encodeURIComponent(reservation.fnsId)}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="font-semibold tabular text-petrol-900">ID FNS {reservation.fnsId}</p>
                  <p className="text-sm text-slate-600">{reservation.guestName ?? 'Sin huésped asociado'}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>{reservation.status.replaceAll('_', ' ')}</p>
                  <p>{reservation.checkIn ? formatDate(reservation.checkIn) : 'Sin llegada'} → {reservation.checkOut ? formatDate(reservation.checkOut) : 'Sin salida'}</p>
                </div>
              </Link>
            ))}
            </div>
          </CardScroll>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Carpetas de habitaciones"
          count={visibleRooms.length}
          action={<span className="inline-flex items-center gap-1 text-xs text-slate-500"><Search className="h-3.5 w-3.5" />Cada ID abre su dossier transversal</span>}
        />
        <CardScroll maxHeight="max-h-[52rem]">
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleRooms.map((room) => (
            <section key={room.roomId} className="flex h-[20rem] flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-gold-600" aria-hidden="true" />
                  <Link href={`/habitaciones/${room.roomNumber}`} className="font-semibold tabular text-petrol-900 hover:underline">
                    Hab. {room.roomNumber}
                  </Link>
                </div>
                {room.floor ? <Chip>Piso {room.floor}</Chip> : null}
              </div>

              {room.reservations.length === 0 ? (
                <div className="px-3 py-5">
                  <EmptyState message="Sin ID activo." />
                </div>
              ) : (
                <CardScroll className="flex-1" maxHeight="max-h-[16rem]">
                  <ul className="divide-y divide-slate-100">
                  {room.reservations.map((stay) => (
                    <li key={stay.fnsId}>
                      <Link
                        href={`/reservas/${encodeURIComponent(stay.fnsId)}`}
                        className="block px-3 py-3 hover:bg-slate-50"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold tabular text-petrol-900">ID {stay.fnsId}</span>
                          <Badge tone={STATUS_TONE[stay.status as keyof typeof STATUS_TONE] ?? 'neutro'}>
                            {STATUS_LABEL[stay.status] ?? stay.status}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-700">{stay.guestName ?? 'Sin huésped'}</p>
                        <p className="mt-1 text-[0.7rem] text-slate-500">
                          {stay.records.entries} novedad(es) · {stay.records.cashMovements} mov. Caja · {stay.records.guarantees} garantía(s) · {stay.records.fines} multa(s)
                        </p>
                      </Link>
                    </li>
                  ))}
                  </ul>
                </CardScroll>
              )}
            </section>
          ))}
          </div>
        </CardScroll>
      </Card>
    </div>
  );
}
