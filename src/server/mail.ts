import 'server-only';
import { env } from '@/lib/env';

/**
 * Envío de correo.
 *
 * Se usa para una sola cosa por ahora: entregar las credenciales de un usuario
 * nuevo al correo de recepción. El transporte se configura por variables de
 * entorno; si no está configurado, la función lo dice en lugar de fallar en
 * silencio, y quien creó al usuario ve la clave en pantalla para entregarla a
 * mano. Nunca se guarda una contraseña en claro en la base de datos.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type MailResult =
  | { sent: true; to: string }
  | { sent: false; reason: string };

export function isMailConfigured(): boolean {
  const config = env();
  return Boolean(config.SMTP_HOST && config.SMTP_PORT && config.MAIL_FROM);
}

/** Casilla a la que se envían las credenciales de los usuarios nuevos. */
export function credentialsRecipient(): string {
  return env().CREDENTIALS_MAIL_TO;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!isMailConfigured()) {
    return {
      sent: false,
      reason:
        'El envío de correo no está configurado en este servidor (faltan SMTP_HOST, SMTP_PORT y MAIL_FROM).',
    };
  }

  try {
    const config = env();
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      // El puerto 465 usa TLS directo; el 587 negocia STARTTLS.
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' }
        : undefined,
    });

    await transport.sendMail({
      from: config.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
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
