import 'server-only';

import { MailOutboxStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/server/mail';

type Client = PrismaClient | Prisma.TransactionClient;

export const SUPERVISOR_BACKUP_MAIL = 'eherrera@hoteleshw.com';
export const RECEPTION_BACKUP_MAIL = 'recepcion@hoteleshw.com';

export async function queueOperationalMail(
  client: Client,
  input: {
    eventKey: string;
    to: string | string[];
    subject: string;
    body: string;
  },
): Promise<string> {
  const to = Array.isArray(input.to) ? input.to.join(', ') : input.to;
  const row = await client.operationalMailOutbox.upsert({
    where: { eventKey: input.eventKey },
    create: {
      eventKey: input.eventKey,
      to,
      subject: input.subject.slice(0, 180),
      body: input.body,
      status: MailOutboxStatus.PENDIENTE,
    },
    update: {},
    select: { id: true },
  });
  return row.id;
}

function nextRetry(attempt: number): Date {
  const minutes = Math.min(360, Math.max(5, 5 * 2 ** Math.max(0, attempt - 1)));
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Envía sin comprometer la transacción operativa original.
 *
 * La fila de outbox ya existe cuando entra aquí: si SMTP falla, queda ERROR y
 * el cron la vuelve a intentar. Nunca se lanza el error hacia la operación que
 * originó el correo.
 */
export async function flushOperationalMailOutbox(
  input: { ids?: string[]; limit?: number } = {},
): Promise<{ sent: number; failed: number; pending: number }> {
  const now = new Date();
  const rows = await prisma.operationalMailOutbox.findMany({
    where: {
      ...(input.ids?.length ? { id: { in: input.ids } } : {}),
      status: { in: [MailOutboxStatus.PENDIENTE, MailOutboxStatus.ERROR] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      attempts: { lt: 10 },
    },
    orderBy: { createdAt: 'asc' },
    take: input.limit ?? 25,
  });

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const attempt = row.attempts + 1;
    const result = await sendMail({
      to: row.to,
      subject: row.subject,
      text: row.body,
    });

    if (result.sent) {
      await prisma.operationalMailOutbox.update({
        where: { id: row.id },
        data: {
          status: MailOutboxStatus.ENVIADO,
          attempts: attempt,
          lastAttemptAt: new Date(),
          nextAttemptAt: null,
          sentAt: new Date(),
          lastError: null,
        },
      });
      sent += 1;
    } else {
      await prisma.operationalMailOutbox.update({
        where: { id: row.id },
        data: {
          status: MailOutboxStatus.ERROR,
          attempts: attempt,
          lastAttemptAt: new Date(),
          nextAttemptAt: nextRetry(attempt),
          lastError: result.reason.slice(0, 1000),
        },
      });
      failed += 1;
    }
  }

  const pending = await prisma.operationalMailOutbox.count({
    where: { status: { in: [MailOutboxStatus.PENDIENTE, MailOutboxStatus.ERROR] } },
  });
  return { sent, failed, pending };
}

/** Best effort inmediatamente después del commit; el cron cubre cualquier fallo. */
export async function flushQueuedMail(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await flushOperationalMailOutbox({ ids, limit: ids.length });
  } catch (error) {
    console.error('[correo-operativo] el envío inmediato falló; queda en outbox', error);
  }
}
