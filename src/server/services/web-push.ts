import 'server-only';

import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importJWK } from 'jose';
import { prisma } from '@/lib/prisma';
import { openSecret, sealSecret } from '@/lib/secret-box';

const PRIVATE_KEY_SETTING = '__secret.push.vapidPrivateJwk';
const PUBLIC_KEY_SETTING = 'push.vapidPublicKey';
const PRIVATE_KEY_PURPOSE = 'web-push-vapid-private';
const VAPID_SUBJECT = 'mailto:recepcion@hoteleshw.com';
const PUSH_TIMEOUT_MS = 12_000;
const MAX_PAYLOAD_ITEMS = 20;

type VapidPrivateJwk = {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d: string;
};

type VapidPair = {
  publicKey: string;
  privateJwk: VapidPrivateJwk;
};

function decodePrivateJwk(value: string | null): VapidPrivateJwk | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<VapidPrivateJwk>;
    if (
      parsed.kty !== 'EC' ||
      parsed.crv !== 'P-256' ||
      !parsed.x ||
      !parsed.y ||
      !parsed.d
    ) {
      return null;
    }
    return parsed as VapidPrivateJwk;
  } catch {
    return null;
  }
}

function applicationServerKey(jwk: { x: string; y: string }): string {
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (x.length !== 32 || y.length !== 32) {
    throw new Error('La llave pública VAPID no tiene el formato P-256 esperado.');
  }
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url');
}

function generateVapidPair(): VapidPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const privateJwk = privateKey.export({ format: 'jwk' }) as VapidPrivateJwk;
  const publicJwk = publicKey.export({ format: 'jwk' }) as {
    kty?: string;
    crv?: string;
    x?: string;
    y?: string;
  };
  if (
    privateJwk.kty !== 'EC' ||
    privateJwk.crv !== 'P-256' ||
    !privateJwk.x ||
    !privateJwk.y ||
    !privateJwk.d ||
    publicJwk.kty !== 'EC' ||
    publicJwk.crv !== 'P-256' ||
    !publicJwk.x ||
    !publicJwk.y
  ) {
    throw new Error('No se pudo generar el par VAPID P-256.');
  }

  return {
    privateJwk,
    publicKey: applicationServerKey({
      x: publicJwk.x,
      y: publicJwk.y,
    }),
  };
}

export async function getOrCreateVapidPair(): Promise<VapidPair> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe<Array<{ locked: number }>>(
      "SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext('aroh-web-push-vapid'))",
    );

    const rows = await tx.systemSetting.findMany({
      where: { key: { in: [PRIVATE_KEY_SETTING, PUBLIC_KEY_SETTING] } },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const sealedPrivate =
      typeof values.get(PRIVATE_KEY_SETTING) === 'string'
        ? (values.get(PRIVATE_KEY_SETTING) as string)
        : null;
    const storedPublic =
      typeof values.get(PUBLIC_KEY_SETTING) === 'string'
        ? (values.get(PUBLIC_KEY_SETTING) as string)
        : null;
    const privateJwk = decodePrivateJwk(
      openSecret(sealedPrivate, PRIVATE_KEY_PURPOSE),
    );

    if (privateJwk && storedPublic) {
      const expected = applicationServerKey(privateJwk);
      if (expected !== storedPublic) {
        throw new Error(
          'La configuración Web Push tiene un par VAPID inconsistente. No se rotó automáticamente para no invalidar dispositivos.',
        );
      }
      return { privateJwk, publicKey: storedPublic };
    }

    if (sealedPrivate || storedPublic) {
      throw new Error(
        'La configuración Web Push está incompleta o ya no puede descifrarse. Requiere reparación administrativa.',
      );
    }

    const created = generateVapidPair();
    await tx.systemSetting.createMany({
      data: [
        {
          key: PRIVATE_KEY_SETTING,
          value: sealSecret(
            JSON.stringify(created.privateJwk),
            PRIVATE_KEY_PURPOSE,
          ),
          category: 'secreto',
          description:
            'Llave privada VAPID cifrada para Web Push. No listar ni devolver al cliente.',
        },
        {
          key: PUBLIC_KEY_SETTING,
          value: created.publicKey,
          category: 'notificaciones',
          description:
            'Llave pública VAPID usada por los dispositivos al suscribirse a Web Push.',
        },
      ],
    });
    return created;
  });
}

export async function getWebPushPublicKey(): Promise<string> {
  return (await getOrCreateVapidPair()).publicKey;
}

function safeExpiration(value: number | null | undefined): Date | null {
  if (!value || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function registerWebPushSubscription(input: {
  userId: string;
  endpoint: string;
  expirationTime?: number | null;
  userAgent?: string | null;
}): Promise<void> {
  const endpoint = input.endpoint.trim();
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || endpoint.length > 4096) {
    throw new Error('El endpoint Web Push no es válido.');
  }
  const now = new Date();

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: input.userId,
      endpoint,
      expiresAt: safeExpiration(input.expirationTime),
      userAgent: input.userAgent?.slice(0, 500) || null,
      lastTriggeredAt: now,
      lastDeliveredAt: now,
    },
    update: {
      userId: input.userId,
      expiresAt: safeExpiration(input.expirationTime),
      userAgent: input.userAgent?.slice(0, 500) || null,
      disabledAt: null,
      failureCount: 0,
      lastTriggeredAt: now,
      lastDeliveredAt: now,
    },
  });
}

export async function removeWebPushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
}

async function vapidAuthorization(endpoint: string, pair: VapidPair): Promise<string> {
  const audience = new URL(endpoint).origin;
  const key = await importJWK(pair.privateJwk, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(audience)
    .setSubject(VAPID_SUBJECT)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
    .sign(key);

  return `vapid t=${token}, k=${pair.publicKey}`;
}

async function sendPushSignal(
  endpoint: string,
  pair: VapidPair,
): Promise<{ ok: boolean; gone: boolean; status: number | null }> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(endpoint, pair),
        TTL: '120',
        Urgency: 'high',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn('[web-push] el servicio push no respondió', {
      failureType: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false, gone: false, status: null };
  }

  return {
    ok: response.ok,
    gone: response.status === 404 || response.status === 410,
    status: response.status,
  };
}

export async function dispatchWebPushForUsers(
  userIds: string[],
): Promise<{ attempted: number; sent: number; removed: number; failed: number }> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: { in: uniqueIds },
      disabledAt: null,
      user: { active: true, deletedAt: null },
    },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      createdAt: true,
      lastTriggeredAt: true,
      failureCount: true,
    },
  });
  if (subscriptions.length === 0) {
    return { attempted: 0, sent: 0, removed: 0, failed: 0 };
  }

  const latestRows = await prisma.notification.groupBy({
    by: ['userId'],
    where: {
      userId: { in: uniqueIds },
      readAt: null,
      isDemo: false,
    },
    _max: { createdAt: true },
  });
  const latestByUser = new Map(
    latestRows
      .filter((row) => row._max.createdAt)
      .map((row) => [row.userId, row._max.createdAt as Date]),
  );

  let pair: VapidPair;
  try {
    pair = await getOrCreateVapidPair();
  } catch (error) {
    console.error('[web-push] VAPID no está disponible', error);
    return {
      attempted: subscriptions.length,
      sent: 0,
      removed: 0,
      failed: subscriptions.length,
    };
  }

  let attempted = 0;
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const latest = latestByUser.get(subscription.userId);
    const cursor = subscription.lastTriggeredAt ?? subscription.createdAt;
    if (!latest || latest <= cursor) continue;

    attempted += 1;
    const result = await sendPushSignal(subscription.endpoint, pair);

    if (result.ok) {
      sent += 1;
      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: {
          lastTriggeredAt: latest,
          lastSuccessAt: new Date(),
          failureCount: 0,
        },
      });
      continue;
    }

    if (result.gone) {
      removed += 1;
      await prisma.pushSubscription.delete({ where: { id: subscription.id } });
      continue;
    }

    failed += 1;
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: {
        failureCount: { increment: 1 },
      },
    });
    console.warn('[web-push] entrega rechazada o temporalmente fallida', {
      status: result.status,
      subscriptionId: subscription.id,
    });
  }

  return { attempted, sent, removed, failed };
}

export async function flushWebPushSubscriptions(): Promise<{
  users: number;
  attempted: number;
  sent: number;
  removed: number;
  failed: number;
}> {
  const rows = await prisma.pushSubscription.findMany({
    where: { disabledAt: null, user: { active: true, deletedAt: null } },
    distinct: ['userId'],
    select: { userId: true },
  });
  const result = await dispatchWebPushForUsers(rows.map((row) => row.userId));
  return { users: rows.length, ...result };
}

export async function getWebPushPayload(input: {
  userId: string;
  endpoint: string;
}): Promise<{
  unread: number;
  newCount: number;
  items: Array<{
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    createdAt: string;
  }>;
}> {
  const subscription = await prisma.pushSubscription.findFirst({
    where: {
      endpoint: input.endpoint,
      userId: input.userId,
      disabledAt: null,
    },
    select: { id: true, createdAt: true, lastDeliveredAt: true },
  });
  if (!subscription) {
    return { unread: 0, newCount: 0, items: [] };
  }

  const cursor = subscription.lastDeliveredAt ?? subscription.createdAt;
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: input.userId,
        isDemo: false,
        readAt: null,
        createdAt: { gt: cursor },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_PAYLOAD_ITEMS,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        link: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId: input.userId, readAt: null },
    }),
  ]);

  const last = rows.at(-1);
  if (last) {
    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { lastDeliveredAt: last.createdAt },
    });
  }

  const visible = rows.slice(-3).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    unread,
    newCount: rows.length,
    items: visible,
  };
}
