import { NextResponse } from 'next/server';
import { getR2ConfigStatus, probeR2Connectivity } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = getR2ConfigStatus();
  const connectivity = status.configured
    ? await probeR2Connectivity()
    : { reachable: false, httpStatus: null, failureType: 'NOT_CONFIGURED' };

  return NextResponse.json(
    {
      ok: status.configured && connectivity.reachable,
      provider: 'cloudflare-r2',
      configured: status.configured,
      missing: status.missing,
      present: status.present,
      resolvedFrom: status.resolvedFrom,
      detectedKeys: status.detectedKeys,
      connectivity,
      configurationWarnings:
        status.resolvedFrom.R2_ACCOUNT_ID &&
        status.resolvedFrom.R2_ACCOUNT_ID !== 'R2_ACCOUNT_ID'
          ? [`R2_ACCOUNT_ID se resuelve actualmente desde ${status.resolvedFrom.R2_ACCOUNT_ID}.`]
          : [],
      vercelEnv: status.vercelEnv,
      vercelTargetEnv: status.vercelTargetEnv,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
