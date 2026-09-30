import { redirect } from 'next/navigation';

export const metadata = { title: 'Ruta retirada' };
export const dynamic = 'force-dynamic';

export default function RetiredReservationCenterPage() {
  redirect('/libro?clase=entry');
}
