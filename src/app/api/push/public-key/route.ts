import { withMaintenance } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getWebPushPublicKey } from '@/server/services/web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GETHandler() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  }
  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json({ error: 'Debes aceptar los términos vigentes.' }, { status: 403 });
  }

  try {
    const publicKey = await getWebPushPublicKey();
    return NextResponse.json(
      { publicKey },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[web-push] no se pudo obtener la llave pública', error);
    return NextResponse.json(
      { error: 'Web Push no está disponible temporalmente.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const GET = withMaintenance(GETHandler);
