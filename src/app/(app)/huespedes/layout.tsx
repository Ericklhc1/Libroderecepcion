import type { ReactNode } from 'react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { ReservationReports } from '@/components/operational/reservation-reports';

export const maxDuration = 60;

export default async function GuestsLayout({ children }: { children: ReactNode }) {
  const user = await requirePageAnyPermission(['guest.view', 'guest.manage']);
  const canImport = user.permissions.includes('pms.import');

  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-6xl">
        <ReservationReports canImport={canImport} />
      </div>
      {children}
    </div>
  );
}
