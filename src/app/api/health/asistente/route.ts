import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Estado mínimo para despliegue/monitorización. No expone claves, modelo,
 * usuarios, memoria ni datos operativos.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, openaiConfigured: Boolean(env().OPENAI_API_KEY) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
