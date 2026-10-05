import { maintenanceCronResponse } from '@/server/api/maintenance';
import { runOperationalAutomations } from '@/server/services/operational-automation';
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
  const maintenance = await maintenanceCronResponse();
  if (maintenance) return maintenance;

  const deadlineAt = Date.now() + 105_000;
  const now = new Date();
  let automations: Awaited<ReturnType<typeof runOperationalAutomations>> | { error:string };
  try { automations = await runOperationalAutomations(now, Math.min(deadlineAt, Date.now() + 30_000)); }
  catch (error) {
    console.error('[automatizaciones] barrido no confirmado', { type:error instanceof Error?error.name:'Unknown' });
    automations = { error:'Barrido no confirmado; se conservan los registros y se requiere revisión.' };
  }
  const usePolicyOverrides = !('error' in automations);
  const pauseAfterAutomation = await maintenanceCronResponse();
  if (pauseAfterAutomation) return pauseAfterAutomation;
  const coordination = await escalateUnreceivedWork(now, usePolicyOverrides);
  const pauseAfterCoordination = await maintenanceCronResponse();
  if (pauseAfterCoordination) return pauseAfterCoordination;
  const housekeeping = await escalateHousekeepingRequests(now, usePolicyOverrides);
  const pauseAfterHousekeeping = await maintenanceCronResponse();
  if (pauseAfterHousekeeping) return pauseAfterHousekeeping;
  const alarms = await dispatchDueAlarmsForAllUsers(now);
  const pauseAfterAlarms = await maintenanceCronResponse();
  if (pauseAfterAlarms) return pauseAfterAlarms;
  const push = await flushWebPushSubscriptions();

  return NextResponse.json(
    { ok: true, automations, coordination, housekeeping, alarms, push },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
