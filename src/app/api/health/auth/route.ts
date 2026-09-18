import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const secret = process.env.AUTH_SECRET;
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL;

  return NextResponse.json(
    {
      ok: Boolean(databaseUrl) && typeof secret === 'string' && secret.length >= 32,
      databaseConfigured: Boolean(databaseUrl),
      authSecretConfigured: typeof secret === 'string',
      authSecretLengthValid: typeof secret === 'string' && secret.length >= 32,
      nodeEnv: process.env.NODE_ENV ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
