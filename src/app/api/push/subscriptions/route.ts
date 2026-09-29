import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import {
  registerWebPushSubscription,
  removeWebPushSubscription,
} from '@/server/services/web-push';
import { isSameOriginMutation } from '@/server/security/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  endpoint: z.string().url().max(4096),
  expirationTime: z.number().nullable().optional(),
});

async function authorizedUser() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return null;
  if (!(await hasAcceptedCurrentTerms(user.id))) return null;
  return user;
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Origen no autorizado.' }, { status: 403 });
  }
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const input = schema.parse(await request.json());
    await registerWebPushSubscription({
      userId: user.id,
      endpoint: input.endpoint,
      expirationTime: input.expirationTime,
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[web-push] no se pudo registrar el dispositivo', {
      failureType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: 'No se pudo registrar este dispositivo para notificaciones push.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Origen no autorizado.' }, { status: 403 });
  }
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const input = schema.pick({ endpoint: true }).parse(await request.json());
    await removeWebPushSubscription(user.id, input.endpoint);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'No se pudo retirar este dispositivo.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
