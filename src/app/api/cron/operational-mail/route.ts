import { maintenanceCronResponse } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { flushOperationalMailOutbox } from '@/server/services/operational-mail';
import { isAuthorizedCronRequest } from '@/server/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }
  const maintenance = await maintenanceCronResponse();
  if (maintenance) return maintenance;

  const result = await flushOperationalMailOutbox(40);
  return NextResponse.json(
    { ok: true, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
