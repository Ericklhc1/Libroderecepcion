import 'server-only';
import { maintenanceBlocksBackground } from '@/server/services/system-maintenance';

import { OperationalMailStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/server/mail';

type Db = Prisma.TransactionClient | typeof prisma;

export const SUPERVISION_BACKUP_EMAIL = 'eherrera@hoteleshw.com';
export const RECEPTION_BACKUP_EMAIL = 'recepcion@hoteleshw.com';

export async function queueOperationalMail(
  client: Db,
  input: {
    eventKey: string;
    recipients: string[];
    subject: string;
    text: string;
  },
): Promise<string> {
  const recipients = Array.from(
    new Set(input.recipients.map((value) => value.trim().toLowerCase()).filter(Boolean)),
  );
  const row = await client.operationalMailOutbox.upsert({
    where: { eventKey: input.eventKey },
    update: {},
    create: {
      eventKey: input.eventKey,
      recipients,
      subject: input.subject.trim().slice(0, 180),
      text: input.text.trim(),
    },
    select: { id: true },
  });
  return row.id;
}

function retryAt(attempts: number): Date {
  const minutes = Math.min(60, Math.max(5, 5 * Math.max(1, attempts)));
  return new Date(Date.now() + minutes * 60_000);
}

async function deliverRow(id: string): Promise<boolean> {
  if (await maintenanceBlocksBackground()) return false;
  const row = await prisma.operationalMailOutbox.findUnique({ where: { id } });
  if (!row || row.status === OperationalMailStatus.ENVIADO) return true;
  if (row.status === OperationalMailStatus.ENVIANDO) return false;

  const claim = await prisma.operationalMailOutbox.updateMany({
    where: {
      id: row.id,
      status: { in: [OperationalMailStatus.PENDIENTE, OperationalMailStatus.ERROR] },
    },
    data: { status: OperationalMailStatus.ENVIANDO },
  });
  if (claim.count === 0) return false;

  const result = await sendMail({
    to: row.recipients.join(', '),
    subject: row.subject,
    text: row.text,
  });
  const attempts = row.attempts + 1;

  if (result.sent) {
    await prisma.operationalMailOutbox.update({
      where: { id: row.id },
      data: {
        status: OperationalMailStatus.ENVIADO,
        attempts,
        sentAt: new Date(),
        lastError: null,
        nextAttemptAt: null,
      },
    });
    return true;
  }

  await prisma.operationalMailOutbox.update({
    where: { id: row.id },
    data: {
      status: OperationalMailStatus.ERROR,
      attempts,
      lastError: result.reason.slice(0, 1000),
      nextAttemptAt: retryAt(attempts),
    },
  });
  return false;
}

/**
 * Intento inmediato y silencioso. Nunca hace fallar la operación del hotel.
 *
 * La entrega inmediata sigue siendo la primera capa. Aunque Vercel Pro permite
 * ejecutar el cron varias veces por hora, cada nuevo hecho operativo rescata
 * además unas pocas filas vencidas de la outbox: así el correo no depende de
 * esperar al siguiente intervalo y el cron queda como red de seguridad.
 */
export async function tryDeliverOperationalMail(eventKey: string): Promise<void> {
  if (await maintenanceBlocksBackground()) return;
  try {
    const row = await prisma.operationalMailOutbox.findUnique({
      where: { eventKey },
      select: { id: true },
    });
    if (row) await deliverRow(row.id);
    await flushOperationalMailOutbox(3);
  } catch (error) {
    console.error('[mail-outbox] fallo en intento inmediato', {
      eventKey,
      failureType: error instanceof Error ? error.name : typeof error,
    });
  }
}

export async function flushOperationalMailOutbox(limit = 30): Promise<{
  attempted: number;
  sent: number;
}> {
  if (await maintenanceBlocksBackground()) return { attempted: 0, sent: 0 };
  const now = new Date();
  await prisma.operationalMailOutbox.updateMany({
    where: {
      status: OperationalMailStatus.ENVIANDO,
      updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
    },
    data: {
      status: OperationalMailStatus.ERROR,
      lastError: 'Reintento automático: el intento anterior quedó interrumpido.',
      nextAttemptAt: now,
    },
  });

  const rows = await prisma.operationalMailOutbox.findMany({
    where: {
      status: { in: [OperationalMailStatus.PENDIENTE, OperationalMailStatus.ERROR] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  });

  let sent = 0;
  let attempted = 0;
  for (const row of rows) {
    if (await maintenanceBlocksBackground()) break;
    attempted += 1;
    if (await deliverRow(row.id)) sent += 1;
  }
  return { attempted, sent };
}

export function operationalMailTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}
