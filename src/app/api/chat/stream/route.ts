import { NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guard';
import {
  getChatGlobalVersion,
  touchChatPresence,
} from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

/**
 * Firma corta del Chat para sincronización incremental.
 *
 * La versión anterior sostenía una función SSE de cuatro minutos por pestaña.
 * Esta ruta termina después de una comprobación, reduciendo drásticamente la
 * memoria provisionada mientras conserva la actualización incremental.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await touchChatPresence(user);
    const version = await getChatGlobalVersion(user);
    return NextResponse.json(
      { version, at: new Date().toISOString() },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: 'Sesión no disponible.' },
      { status: 401, headers },
    );
  }
}
