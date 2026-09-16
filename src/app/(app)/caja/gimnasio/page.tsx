import { redirect } from 'next/navigation';
import { requirePagePermission } from '@/server/auth/guard';

export const metadata = { title: 'Pase de gimnasio' };
export const dynamic = 'force-dynamic';

export default async function GymPassPage() {
  await requirePagePermission('room.view');
  redirect('/habitaciones');
}
