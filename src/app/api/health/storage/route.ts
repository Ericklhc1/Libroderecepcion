import { NextResponse } from 'next/server';
import {
  getR2AccountIdDiagnostics,
  getR2ConfigStatus,
  getR2CredentialRelationshipDiagnostics,
  probeR2Connectivity,
  probeR2EndpointCandidates,
} from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = getR2ConfigStatus();
  const accountIdDiagnostics = getR2AccountIdDiagnostics();
  const credentialDiagnostics = getR2CredentialRelationshipDiagnostics();
  const [connectivity, endpointDiagnostics] = status.configured
    ? await Promise.all([
        probeR2Connectivity(),
        probeR2EndpointCandidates(),
      ])
    : [
        { reachable: false, httpStatus: null, failureType: 'NOT_CONFIGURED' },
        [],
      ];

  const authenticatedJurisdictions = endpointDiagnostics
    .filter((item) => item.authenticated)
    .map((item) => item.jurisdiction);

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
      accountIdDiagnostics,
      credentialDiagnostics,
      endpointDiagnostics,
      authenticatedJurisdictions,
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
