import { NextResponse } from 'next/server';
import { flushOperationalMailOutbox } from '@/server/services/operational-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? '';
  if (!userAgent.startsWith('vercel-cron/')) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const result = await flushOperationalMailOutbox(40);
  return NextResponse.json(
    { ok: true, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
