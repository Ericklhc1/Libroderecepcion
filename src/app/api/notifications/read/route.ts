import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  id: z.string().min(1).optional(),
  all: z.boolean().optional(),
});

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json(
      { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
      { status: 401, headers },
    );
  }

  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json(
      { error: 'Debes aceptar los términos vigentes antes de continuar.' },
      { status: 403, headers },
    );
  }

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400, headers });
  }

  if (!parsed.id && !parsed.all) {
    return NextResponse.json(
      { error: 'Indica una notificación o solicita marcar todas.' },
      { status: 400, headers },
    );
  }

  await prisma.notification.updateMany({
    where: {
      userId: user.id,
      readAt: null,
      ...(parsed.id ? { id: parsed.id } : {}),
    },
    data: { readAt: new Date() },
  });

  const snapshot = await getNotificationFeedForUser(user.id);
  return NextResponse.json(snapshot, { headers });
}
