import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.GITHUB_SHA ??
    null;

  const provider = process.env.VERCEL
    ? 'vercel'
    : process.env.NETLIFY
      ? 'netlify'
      : 'unknown';

  return NextResponse.json(
    {
      ok: true,
      provider,
      commit,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
