import { NextResponse } from 'next/server';
import { getR2ConfigStatus } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = getR2ConfigStatus();
  return NextResponse.json(
    {
      ok: true,
      provider: 'cloudflare-r2',
      configured: status.configured,
      missing: status.missing,
      present: status.present,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
