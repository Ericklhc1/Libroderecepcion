import { withMaintenance } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getWebPushPayload } from '@/server/services/web-push';
import { isSameOriginMutation } from '@/server/security/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  endpoint: z.string().url().max(4096),
});

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

  try {
    const input = schema.parse(await request.json());
    const payload = await getWebPushPayload({
      userId: user.id,
      endpoint: input.endpoint,
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'No se pudo recuperar la notificación.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const POST = withMaintenance(POSTHandler);
