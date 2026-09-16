import Link from 'next/link';
import { ArrowLeft, Dumbbell } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { findGymReservation, gymPrices } from '@/server/services/live-cash';
import { Card, EmptyState } from '@/components/ui/card';
import { GymPassForm } from '@/components/cash/gym-pass-form';

export const metadata = { title: 'Pase de gimnasio' };
export const dynamic = 'force-dynamic';

export default async function GymPassPage({
  searchParams,
}: {
  searchParams: Promise<{ habitacion?: string; reserva?: string }>;
}) {
  await requirePagePermission('room.manage');
  const query = await searchParams;
  const [reservation, prices] = await Promise.all([
    findGymReservation({
      roomNumber: query.habitacion ?? null,
      reservationCode: query.reserva ?? null,
    }),
    gymPrices(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href={query.habitacion ? `/habitaciones/${query.habitacion}` : '/caja'}
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver
      </Link>

      <header>
        <div className="flex items-center gap-2">
          <Dumbbell className="h-6 w-6 text-petrol-700" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-petrol-900">Pase de gimnasio</h1>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          El folio se genera automáticamente con seis dígitos y queda ligado a reserva,
          habitación, huésped, recepcionista y fecha.
        </p>
      </header>

      {!reservation || !reservation.roomNumber || !reservation.guest?.fullName ? (
        <Card>
          <EmptyState message="No pude encontrar una reserva con huésped y habitación para emitir el pase. Abre la opción desde una habitación ocupada." />
        </Card>
      ) : (
        <Card>
          <div className="p-4">
            <GymPassForm
              reservation={{
                id: reservation.id,
                code: reservation.code,
                roomNumber: reservation.roomNumber,
                guestName: reservation.guest.fullName,
              }}
              prices={prices}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
