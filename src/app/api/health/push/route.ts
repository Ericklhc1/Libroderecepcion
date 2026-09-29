import { NextResponse } from 'next/server';
import { getWebPushPublicKey } from '@/server/services/web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const publicKey = await getWebPushPublicKey();
    return NextResponse.json(
      {
        ok: true,
        provider: 'standards-web-push',
        vapidConfigured: publicKey.length > 0,
        delivery: 'push-api + service-worker',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[web-push-health]', error);
    return NextResponse.json(
      {
        ok: false,
        provider: 'standards-web-push',
        vapidConfigured: false,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
