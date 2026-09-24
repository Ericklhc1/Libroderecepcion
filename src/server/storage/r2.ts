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
  const iso = now.toISOString().replace(/[:-]|.d{3}/g, '');
  return { full: iso, day: iso.slice(0, 8) };
}

function canonicalPath(bucket: string, key: string): string {
  const segments = [bucket, ...key.split('/')].map((part) =>
    encodeURIComponent(part).replace(/%2F/gi, '/'),
  );
  return '/' + segments.join('/');
}

async function signedRequest(
  method: 'GET' | 'PUT' | 'DELETE',
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

  const canonicalHeaders = headerPairs.map(([name, value]) => `${name}:${value.trim()}\n`).join('');
  const signedHeaders = headerPairs.map(([name]) => name).join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const region = 'auto';
  const service = 's3';
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${current.secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

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
