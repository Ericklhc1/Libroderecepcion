import { redirect } from 'next/navigation';

export const metadata = { title: 'Novedades / habitación' };

export default function LegacyReservationCenterPage() {
  redirect('/novedades/habitacion');
}
