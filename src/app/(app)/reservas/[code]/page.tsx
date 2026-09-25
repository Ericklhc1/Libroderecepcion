import { redirect } from 'next/navigation';

export const metadata = { title: 'Reserva PMS retirada' };
export const dynamic = 'force-dynamic';

export default function RetiredReservationDetailPage() {
  redirect('/libro?clase=entry');
}
