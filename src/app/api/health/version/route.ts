import { NextResponse } from 'next/server';
import packageJson from '../../../../../package.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    null;

  return NextResponse.json(
    {
      ok: true,
      provider: process.env.VERCEL ? 'vercel' : 'unknown',
      version: packageJson.version,
      commit,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
