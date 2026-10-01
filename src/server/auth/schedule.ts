import 'server-only';
import { redirect } from 'next/navigation';
import { requirePageUser } from './guard';
import { scheduleAllowed } from '@/domain/schedule';

export async function requireSchedulePageUser() {
  const user = await requirePageUser({ allowAreaOperation:true });
  if (!scheduleAllowed(user)) redirect('/sin-permisos');
  return user;
}
