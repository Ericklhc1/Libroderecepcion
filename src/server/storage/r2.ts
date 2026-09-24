import 'server-only';

import { createHash, createHmac, randomUUID } from 'node:crypto';

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function normalizeEnvKey(key: string): string {
  return key.trim().toUpperCase();
}

function resolveEnv(
  aliases: string[],
): { value: string; source: string | null } {
  const wanted = new Set(aliases.map(normalizeEnvKey));

  for (const [rawKey, rawValue] of Object.entries(process.env)) {
    if (!wanted.has(normalizeEnvKey(rawKey))) continue;
    const value = rawValue?.trim() ?? '';
    if (value) return { value, source: rawKey };
  }

  return { value: '', source: null };
}

function resolveAccountId(): { value: string; source: string | null } {
  const direct = resolveEnv([
    'R2_ACCOUNT_ID',
    'CLOUDFLARE_ACCOUNT_ID',
    'CF_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCOUNT_ID',
  ]);
  if (direct.value) return direct;

  const endpoint = resolveEnv([
    'R2_ENDPOINT',
    'CLOUDFLARE_R2_ENDPOINT',
    'CLOUDFLARE_ENDPOINT',
  ]);
  if (!endpoint.value) return { value: '', source: null };

  try {
    const url = new URL(endpoint.value);
    const match = url.hostname.match(/^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i);
    if (match?.[1]) {
      return { value: match[1], source: endpoint.source };
    }
  } catch {
    // El diagnóstico sólo intenta recuperar una configuración válida.
  }

  return { value: '', source: null };
}

function resolvedConfigParts() {
  return {
    accountId: resolveAccountId(),
    accessKeyId: resolveEnv([
      'R2_ACCESS_KEY_ID',
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
      'CF_R2_ACCESS_KEY_ID',
    ]),
    secretAccessKey: resolveEnv([
      'R2_SECRET_ACCESS_KEY',
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
      'CF_R2_SECRET_ACCESS_KEY',
    ]),
    bucket: resolveEnv([
      'R2_BUCKET',
      'CLOUDFLARE_R2_BUCKET',
      'R2_BUCKET_NAME',
    ]),
  };
}

function config(): R2Config | null {
  const parts = resolvedConfigParts();
  if (
    !parts.accountId.value ||
    !parts.accessKeyId.value ||
    !parts.secretAccessKey.value ||
    !parts.bucket.value
  ) {
    return null;
  }

  return {
    accountId: parts.accountId.value,
    accessKeyId: parts.accessKeyId.value,
    secretAccessKey: parts.secretAccessKey.value,
    bucket: parts.bucket.value,
  };
}

export function getR2ConfigStatus() {
  const parts = resolvedConfigParts();
  const values = {
    R2_ACCOUNT_ID: parts.accountId.value,
    R2_ACCESS_KEY_ID: parts.accessKeyId.value,
    R2_SECRET_ACCESS_KEY: parts.secretAccessKey.value,
    R2_BUCKET: parts.bucket.value,
  };

  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const detectedKeys = Object.keys(process.env)
    .filter((key) => {
      const normalized = normalizeEnvKey(key);
      return (
        normalized.startsWith('R2') ||
        normalized.startsWith('CLOUDFLARE_R2') ||
        normalized === 'CLOUDFLARE_ACCOUNT_ID' ||
        normalized === 'CF_ACCOUNT_ID'
      );
    })
    .sort();

  return {
    configured: missing.length === 0,
    missing,
    present: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, Boolean(value)]),
    ) as Record<keyof typeof values, boolean>,
    resolvedFrom: {
      R2_ACCOUNT_ID: parts.accountId.source,
      R2_ACCESS_KEY_ID: parts.accessKeyId.source,
      R2_SECRET_ACCESS_KEY: parts.secretAccessKey.source,
      R2_BUCKET: parts.bucket.source,
    },
    detectedKeys,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelTargetEnv: process.env.VERCEL_TARGET_ENV ?? null,
  };
}

export function isR2Configured(): boolean {
  return getR2ConfigStatus().configured;
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(now = new Date()): { full: string; day: string } {
  const full = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return { full, day: full.slice(0, 8) };
}

function encodeAws(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, key: string): string {
  return '/' + [bucket, ...key.split('/')].map(encodeAws).join('/');
}

function signingKey(secret: string, day: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

async function signedRequest(
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  const current = config();
  if (!current) throw new Error('R2 no está configurado.');

  const host = `${current.accountId}.r2.cloudflarestorage.com`;
  const path = canonicalPath(current.bucket, key);
  const url = `https://${host}${path}`;
  const { full, day } = amzDate();
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const headerPairs: Array<[string, string]> = [
    ['host', host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', full],
  ];
  if (contentType) headerPairs.push(['content-type', contentType]);
  headerPairs.sort(([a], [b]) => a.localeCompare(b));

  const canonicalHeaders = headerPairs
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join('');
  const signedHeaders = headerPairs.map(([name]) => name).join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac('sha256', signingKey(current.secretAccessKey, day))
    .update(stringToSign)
    .digest('hex');

  const headers = new Headers();
  for (const [name, value] of headerPairs) headers.set(name, value);
  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${current.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  return fetch(url, {
    method,
    headers,
    body: method === 'PUT' && body ? new Uint8Array(body) : undefined,
    cache: 'no-store',
  });
}

export function createR2PresignedPutUrl(
  key: string,
  contentType: string,
  expiresSeconds = 300,
): { url: string; expiresAt: string } {
  const current = config();
  if (!current) throw new Error('R2 no está configurado.');

  const host = `${current.accountId}.r2.cloudflarestorage.com`;
  const path = canonicalPath(current.bucket, key);
  const now = new Date();
  const { full, day } = amzDate(now);
  const scope = `${day}/auto/s3/aws4_request`;
  const expires = Math.min(Math.max(Math.trunc(expiresSeconds), 60), 900);

  const query = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${current.accessKeyId}/${scope}`],
    ['X-Amz-Date', full],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ]);
  const canonicalQuery = Array.from(query.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${encodeAws(name)}=${encodeAws(value)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    path,
    canonicalQuery,
    `content-type:${contentType.trim().toLocaleLowerCase('en-US')}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(current.secretAccessKey, day))
    .update(stringToSign)
    .digest('hex');

  return {
    url: `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + expires * 1000).toISOString(),
  };
}

export async function putR2Object(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const response = await signedRequest('PUT', key, bytes, contentType);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`R2 PUT falló (${response.status}) ${detail.slice(0, 300)}`);
  }
}

export async function headR2Object(key: string): Promise<Response> {
  return signedRequest('HEAD', key);
}

export async function getR2Object(key: string): Promise<Response> {
  return signedRequest('GET', key);
}

export async function deleteR2Object(key: string): Promise<void> {
  const response = await signedRequest('DELETE', key);
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 DELETE falló (${response.status}).`);
  }
}

export function makeChatStorageKey(
  conversationId: string,
  fileName: string,
  kind: 'attachment' | 'sticker' = 'attachment',
): string {
  const ext = fileName.toLocaleLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? 'bin';
  return `chat/${conversationId}/${kind}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
}
