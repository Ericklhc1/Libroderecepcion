import { NextResponse } from 'next/server';
import { getMaintenanceState } from '@/server/services/system-maintenance';
import { MAINTENANCE_MESSAGE } from '@/domain/system-maintenance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Public read-only availability; no account, revision or operational information. */
export async function GET() {
  const state = await getMaintenanceState().catch(() => ({ enabled: true, message: MAINTENANCE_MESSAGE }));
  return NextResponse.json({ enabled: state.enabled, message: state.enabled ? state.message : null }, { headers: { 'Cache-Control': 'no-store' } });
}
