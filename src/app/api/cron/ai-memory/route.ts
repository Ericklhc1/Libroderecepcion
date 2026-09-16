import { NextResponse } from 'next/server';
import { cleanupExpiredAiMemory } from '@/server/ai/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El cron sólo elimina filas cuyo expires_at ya venció. No acepta parámetros
 * ni puede tocar memoria vigente, de modo que una invocación externa no puede
 * borrar contexto que aún esté dentro de los 30 días.
 */
export async function GET(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? '';
  if (!userAgent.startsWith('vercel-cron/')) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const deleted = await cleanupExpiredAiMemory();
  return NextResponse.json(
    { ok: true, deleted },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
