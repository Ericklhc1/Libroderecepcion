import 'server-only';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { openSecret } from '@/lib/secret-box';
import { canSend, smtpIsImplicitTls } from '@/domain/mail-config';

/**
 * Envío de correo.
 *
 * La configuración sale de la base si está, y del entorno si no. La
 * precedencia se decide acá y sólo acá, así que la consola de administración y
 * el envío real no pueden discrepar sobre qué servidor se está usando.
 *
 * `html` es opcional a propósito: los correos históricos de credenciales
 * siguen funcionando en texto plano, mientras que los registros operativos
 * pueden enviarse como ficha legible sin crear un segundo transporte.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type MailResult =
  | { sent: true; to: string }
  | { sent: false; reason: string };

/** Configuración efectiva. Uso interno: lleva la clave en claro. */
export type ResolvedMailConfig = {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
  credentialsTo: string;
  source: 'base' | 'entorno';
};

const SINGLETON = 'default';
export const SMTP_SECRET_PURPOSE = 'mail/smtp';
export const INBOUND_SECRET_PURPOSE = 'mail/inbound';

export async function resolveMailConfig(): Promise<ResolvedMailConfig | null> {
  const config = env();
  const row = await prisma.mailSettings
    .findUnique({ where: { id: SINGLETON } })
    .catch(() => null);

  if (row && canSend(row)) {
    return {
      host: row.smtpHost!.trim(),
      port: row.smtpPort!,
      user: row.smtpUser?.trim() || null,
      password: openSecret(row.smtpPasswordEnc, SMTP_SECRET_PURPOSE),
      from: row.mailFrom!.trim(),
      credentialsTo: row.credentialsMailTo?.trim() || config.CREDENTIALS_MAIL_TO,
      source: 'base',
    };
  }

  if (
    canSend({
      smtpHost: config.SMTP_HOST,
      smtpPort: config.SMTP_PORT,
      mailFrom: config.MAIL_FROM,
    })
  ) {
    return {
      host: config.SMTP_HOST!,
      port: config.SMTP_PORT!,
      user: config.SMTP_USER ?? null,
      password: config.SMTP_PASSWORD ?? null,
      from: config.MAIL_FROM!,
      credentialsTo: row?.credentialsMailTo?.trim() || config.CREDENTIALS_MAIL_TO,
      source: 'entorno',
    };
  }

  return null;
}

export async function isMailConfigured(): Promise<boolean> {
  return (await resolveMailConfig()) !== null;
}

/** Casilla a la que se envían las credenciales de los usuarios nuevos. */
export async function credentialsRecipient(): Promise<string> {
  const resolved = await resolveMailConfig();
  if (resolved) return resolved.credentialsTo;

  const row = await prisma.mailSettings
    .findUnique({ where: { id: SINGLETON }, select: { credentialsMailTo: true } })
    .catch(() => null);
  return row?.credentialsMailTo?.trim() || env().CREDENTIALS_MAIL_TO;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const config = await resolveMailConfig();
  if (!config) {
    return {
      sent: false,
      reason:
        'El envío de correo no está configurado. Un Administrador de sistema puede configurarlo en Administración › Correo.',
    };
  }

  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: smtpIsImplicitTls(config.port),
      auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    });

    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true, to: message.to };
  } catch (error) {
    return {
      sent: false,
      reason:
        error instanceof Error
          ? `El servidor de correo rechazó el envío: ${error.message}`
          : 'El servidor de correo rechazó el envío.',
    };
  }
}