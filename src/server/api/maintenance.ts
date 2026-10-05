import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentUserFresh } from '@/server/auth/current-user';
import { MAINTENANCE_MESSAGE } from '@/domain/system-maintenance';
import { getMaintenanceState, maintenanceBlocksBackground } from '@/server/services/system-maintenance';

export function maintenanceResponse(message = MAINTENANCE_MESSAGE) {
  return NextResponse.json({ ok: false, code: 'MAINTENANCE', error: message }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
}

/** Gate before handler parsing, writes and catch blocks, including state-changing GETs. */
export function withMaintenance<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      const state = await getMaintenanceState();
      if (state.enabled) {
        const user = await getCurrentUserFresh();
        if (!user?.isSystemAdmin) return maintenanceResponse(state.message);
      }
    } catch { return maintenanceResponse(); }
    return handler(...args);
  };
}

/** Invoke after the existing cron authentication. Retain every queue for resumption. */
export async function maintenanceCronResponse() {
  return await maintenanceBlocksBackground()
    ? NextResponse.json({ ok: true, skipped: 'maintenance' }, { headers: { 'Cache-Control': 'no-store' } })
    : null;
}
