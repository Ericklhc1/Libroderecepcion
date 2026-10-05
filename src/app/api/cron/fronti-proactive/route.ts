import { maintenanceCronResponse } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/server/cron-auth';
import { runAlertEngine } from '@/server/services/alert-engine';
import { runFrontiProactiveSweep } from '@/server/ai/fronti-proactive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }
  const maintenance = await maintenanceCronResponse();
  if (maintenance) return maintenance;

  const alertSync = await runAlertEngine();
  const result = await runFrontiProactiveSweep({
    trigger: 'vercel-cron',
    deadlineAt: Date.now() + 100_000,
  });
  return NextResponse.json(
    { ok: true, alertSync, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
