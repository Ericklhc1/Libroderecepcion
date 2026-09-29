import { NextResponse } from 'next/server';
import { runProactiveSupervisionAnalysis } from '@/server/ai/proactive-supervision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? '';
  if (!userAgent.startsWith('vercel-cron/')) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const result = await runProactiveSupervisionAnalysis();
  return NextResponse.json(
    { ok: true, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
