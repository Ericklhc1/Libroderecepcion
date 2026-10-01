import 'server-only';
import { redirect } from 'next/navigation';
import { requirePageUser, requireUser } from './guard';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { assertHousekeepingAccess } from '@/server/services/housekeeping';

export async function requireHousekeepingPageUser() {
  const user = await requirePageUser();
  if (!canAccessHousekeeping(user)) redirect('/sin-permisos');
  return user;
}

export async function requireHousekeepingUser() {
  const user = await requireUser();
  assertHousekeepingAccess(user, true);
  return user;
}
