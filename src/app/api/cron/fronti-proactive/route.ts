import { runOperationalAutomations } from '@/server/services/operational-automation';
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

  const automations = await runOperationalAutomations();
  const alertSync = await runAlertEngine();
  const result = await runFrontiProactiveSweep({
    trigger: 'vercel-cron',
    deadlineAt: Date.now() + 100_000,
  });
  return NextResponse.json(
    { ok: true, alertSync, automations, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
