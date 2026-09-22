import { redirect } from 'next/navigation';
import { requirePagePermission } from '@/server/auth/guard';

export const metadata = { title: 'Folios de gimnasio' };
export const dynamic = 'force-dynamic';

export default async function GymPassPage() {
  await requirePagePermission('cash.view');
  redirect('/caja?seccion=gimnasio');
}
