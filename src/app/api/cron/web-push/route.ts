import { escalateUnreceivedWork } from '@/server/services/coordination';
import { escalateHousekeepingRequests } from '@/server/services/housekeeping';
import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/server/cron-auth';
import { dispatchDueAlarmsForAllUsers } from '@/server/services/operational-alarms';
import { flushWebPushSubscriptions } from '@/server/services/web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const now = new Date();
  const coordination = await escalateUnreceivedWork(now);
  const housekeeping = await escalateHousekeepingRequests(now);
  const alarms = await dispatchDueAlarmsForAllUsers(now);
  const push = await flushWebPushSubscriptions();

  return NextResponse.json(
    { ok: true, coordination, housekeeping, alarms, push },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
