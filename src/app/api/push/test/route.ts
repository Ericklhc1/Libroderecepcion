import { withMaintenance } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { NotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { notify } from '@/server/notifications';
import { isSameOriginMutation } from '@/server/security/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function POSTHandler(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Origen no autorizado.' }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  }
  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json({ error: 'Términos pendientes.' }, { status: 403 });
  }

  const since = new Date(Date.now() - 30_000);
  const recent = await prisma.notification.findFirst({
    where: {
      userId: user.id,
      entity: 'PushSelfTest',
      entityId: user.id,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  if (recent) {
    return NextResponse.json(
      { error: 'Espera unos segundos antes de repetir la prueba.' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  await notify({
    userId: user.id,
    type: NotificationType.ACTUALIZACION_OPERATIVA,
    title: 'AROH · Push del sistema funcionando',
    body: 'Esta es una prueba real de Web Push para este dispositivo.',
    link: '/notificaciones',
    entity: 'PushSelfTest',
    entityId: user.id,
  });

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const POST = withMaintenance(POSTHandler);
