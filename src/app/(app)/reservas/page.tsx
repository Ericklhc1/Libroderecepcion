import Link from 'next/link';
import { FileUp, Folder, FolderOpen, Search } from 'lucide-react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { listReservationFolders } from '@/server/services/reservation-folders';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { ReservationDialog } from '@/app/(app)/huespedes/guest-forms';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Reservas' };
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

export default async function ReservationsPage() {
  const user = await requirePageAnyPermission(['room.view', 'guest.view', 'guest.manage']);
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

  const activeIds = folders.rooms.reduce((total, room) => total + room.stays.length, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-petrol-900">
            <FolderOpen className="h-6 w-6 text-gold-600" aria-hidden="true" />
            Reservas
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            La reserva es la carpeta principal. Cada habitación contiene sus ID FNS activos y cada ID concentra estadía, Caja, garantías, novedades, incidencias, comentarios, llaves e historial.
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><div className="p-4"><p className="text-xs text-slate-500">Habitaciones</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{folders.rooms.length}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">ID FNS activos</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{activeIds}</p></div></Card>
        <Card><div className="p-4"><p className="text-xs text-slate-500">Sin habitación asignada</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{folders.unassigned.length}</p></div></Card>
      </div>

      {folders.unassigned.length > 0 ? (
        <Card className="border-gold-300">
          <CardHeader title="Reservas sin habitación asignada" count={folders.unassigned.length} />
          <div className="divide-y divide-slate-100">
            {folders.unassigned.map((reservation) => (
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
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Carpetas de habitaciones"
          count={folders.rooms.length}
          action={<span className="inline-flex items-center gap-1 text-xs text-slate-500"><Search className="h-3.5 w-3.5" />Cada ID abre su dossier transversal</span>}
        />
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {folders.rooms.map((room) => (
            <section key={room.roomId} className="rounded-xl bg-white ring-1 ring-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-gold-600" aria-hidden="true" />
                  <Link href={`/habitaciones/${room.roomNumber}`} className="font-semibold tabular text-petrol-900 hover:underline">
                    Hab. {room.roomNumber}
                  </Link>
                </div>
                {room.floor ? <Chip>Piso {room.floor}</Chip> : null}
              </div>

              {room.stays.length === 0 ? (
                <div className="px-3 py-5">
                  <EmptyState message="Sin ID activo." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {room.stays.map((stay) => (
                    <li key={stay.stayId}>
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
              )}
            </section>
          ))}
        </div>
      </Card>
    </div>
  );
}
