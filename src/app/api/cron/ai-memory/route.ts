import { NextResponse } from 'next/server';
import { enforceFrontiRetentionPolicy } from '@/server/ai/retention-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El cron aplica la política vigente de Fronti. Si el Administrador reduce la
 * retención, también elimina registros creados con una configuración anterior.
 */
export async function GET(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? '';
  if (!userAgent.startsWith('vercel-cron/')) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const deleted = await enforceFrontiRetentionPolicy();
  return NextResponse.json(
    { ok: true, deleted },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
