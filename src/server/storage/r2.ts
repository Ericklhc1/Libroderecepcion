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
    'R2_ACCOUND_ID',
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
  options?: { host?: string; signal?: AbortSignal },
): Promise<Response> {
  const current = config();
  if (!current) throw new Error('R2 no está configurado.');

  const host = options?.host ?? `${current.accountId}.r2.cloudflarestorage.com`;
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
    signal: options?.signal,
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

export type R2ConnectivityProbe = {
  reachable: boolean;
  httpStatus: number | null;
  failureType: string | null;
};

/**
 * Sondeo no destructivo del endpoint S3 de R2.
 *
 * Un HEAD a una clave reservada de salud valida DNS/TLS, firma y permiso de
 * lectura sin crear objetos. 200 (si alguien creó la clave) y 404 (caso
 * normal) prueban conectividad válida. Cualquier otro estado queda visible sin
 * copiar cuerpo de respuesta, credenciales ni detalles del proveedor.
 */
export async function probeR2Connectivity(
  requester: (key: string) => Promise<Response> = headR2Object,
): Promise<R2ConnectivityProbe> {
  try {
    const response = await requester('__health__/connectivity-probe');
    return {
      reachable: response.ok || response.status === 404,
      httpStatus: response.status,
      failureType: null,
    };
  } catch (error) {
    return {
      reachable: false,
      httpStatus: null,
      failureType: error instanceof Error ? error.name : typeof error,
    };
  }
}

export type R2Jurisdiction = 'default' | 'us' | 'eu' | 'fedramp';

export type R2EndpointDiagnostic = {
  jurisdiction: R2Jurisdiction;
  reachable: boolean;
  authenticated: boolean;
  httpStatus: number | null;
  failureType: string | null;
  failureCode: string | null;
};

function r2Host(accountId: string, jurisdiction: R2Jurisdiction): string {
  const suffix = jurisdiction === 'default' ? '' : `.${jurisdiction}`;
  return `${accountId}${suffix}.r2.cloudflarestorage.com`;
}

function safeFailureCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return null;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code.slice(0, 120) : null;
}

/**
 * Diagnóstico de la forma del Account ID sin devolver su valor.
 *
 * Cloudflare muestra normalmente Account IDs de 32 caracteres hexadecimales.
 * Esto es una comprobación de forma esperada para detectar copias accidentales;
 * no sustituye una validación contra la API del proveedor.
 */
export function getR2AccountIdDiagnostics() {
  const accountId = resolveAccountId().value;
  return {
    present: Boolean(accountId),
    length: accountId.length,
    expectedShape: /^[a-f0-9]{32}$/i.test(accountId),
  };
}

/**
 * Prueba no destructiva de los cuatro hosts S3 que Cloudflare documenta para
 * R2. Se firma el mismo HEAD contra una clave inexistente y se ejecutan los
 * candidatos en paralelo con plazo corto.
 *
 * - reachable: hubo respuesta HTTP (DNS/TLS funcionaron).
 * - authenticated: 2xx o 404; la firma llegó a un endpoint que aceptó la
 *   identidad y sólo indicó que la clave de salud no existe.
 * - 4xx/5xx siguen siendo útiles: prueban transporte aunque no autentiquen.
 *
 * Nunca devuelve host, Account ID, firma, credencial ni cuerpo de respuesta.
 */
export async function probeR2EndpointCandidates(
  requester?: (
    jurisdiction: R2Jurisdiction,
    host: string,
  ) => Promise<Response>,
): Promise<R2EndpointDiagnostic[]> {
  const current = config();
  if (!current) return [];

  const jurisdictions: R2Jurisdiction[] = ['default', 'us', 'eu', 'fedramp'];
  const request =
    requester ??
    ((jurisdiction: R2Jurisdiction, host: string) =>
      signedRequest(
        'HEAD',
        '__health__/jurisdiction-probe',
        undefined,
        undefined,
        {
          host,
          signal: AbortSignal.timeout(6_000),
        },
      ));

  return Promise.all(
    jurisdictions.map(async (jurisdiction) => {
      const host = r2Host(current.accountId, jurisdiction);
      try {
        const response = await request(jurisdiction, host);
        return {
          jurisdiction,
          reachable: true,
          authenticated: response.ok || response.status === 404,
          httpStatus: response.status,
          failureType: null,
          failureCode: null,
        };
      } catch (error) {
        return {
          jurisdiction,
          reachable: false,
          authenticated: false,
          httpStatus: null,
          failureType: error instanceof Error ? error.name : typeof error,
          failureCode: safeFailureCode(error),
        };
      }
    }),
  );
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
