import 'server-only';

import { createHash, createHmac, randomUUID } from 'node:crypto';

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2Configured(): boolean {
  return Boolean(config());
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
