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
  const alarms = await dispatchDueAlarmsForAllUsers(now);
  const push = await flushWebPushSubscriptions();

  return NextResponse.json(
    { ok: true, alarms, push },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
