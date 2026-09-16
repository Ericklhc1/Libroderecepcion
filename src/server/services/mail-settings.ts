import 'server-only';
// `AuditAction` entra como valor; `MailInboundProtocol` sólo se usa como tipo.
import { AuditAction } from '@prisma/client';
import type { MailInboundProtocol } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { openSecret, sealSecret } from '@/lib/secret-box';
import { RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  INBOUND_SECRET_PURPOSE,
  SMTP_SECRET_PURPOSE,
  resolveMailConfig,
  sendMail,
} from '@/server/mail';
import {
  canSend,
  mailConfigProblems,
  mailConfigWarnings,
  type MailConfigDraft,
} from '@/domain/mail-config';

/**
 * Configuración del correo, editable desde la consola del administrador.
 *
 * **La base manda cuando está configurada; el entorno es el respaldo.**
 * Podría ser al revés, y al revés es peor: si una variable de entorno olvidada
 * ganara, el administrador escribiría el servidor correcto, guardaría, vería
 * «guardado» y los correos seguirían saliendo por el servidor viejo sin que
 * nada en la pantalla lo explicara. Así, lo que se ve es lo que se usa.
 *
 * Mientras nadie configure nada, el entorno sigue mandando y el sistema se
 * comporta **exactamente** como antes de esta pantalla.
 *
 * La clave **nunca sale hacia el navegador**. Ni cifrada: se informa si hay una
 * guardada y se ofrece reemplazarla. Un formulario que devuelve el secreto lo
 * deja en el código de la página y en el historial del navegador.
 */

const SINGLETON = 'default';
/*
  Los propósitos de cifrado los define el transporte y se reutilizan acá: si
  cada archivo escribiera el suyo, una letra de diferencia dejaría la clave
  guardada ilegible sin ningún error visible.
*/
const SMTP_PURPOSE = SMTP_SECRET_PURPOSE;
const INBOUND_PURPOSE = INBOUND_SECRET_PURPOSE;

export type MailConfigView = {
  smtpHost: string;
  smtpPort: number | null;
  smtpUser: string;
  mailFrom: string;
  credentialsMailTo: string;
  inboundProtocol: MailInboundProtocol | null;
  inboundHost: string;
  inboundPort: number | null;
  inboundUser: string;
  /** Si hay clave guardada. **Nunca el valor.** */
  hasSmtpPassword: boolean;
  hasInboundPassword: boolean;
  /** La clave está guardada pero ya no se puede descifrar (`AUTH_SECRET` cambió). */
  smtpPasswordUnreadable: boolean;
  inboundPasswordUnreadable: boolean;
  /** De dónde sale lo que el sistema está usando de verdad. */
  source: 'base' | 'entorno' | 'sin-configurar';
  canSend: boolean;
  /** El entorno tiene SMTP y la base también: la base gana y conviene decirlo. */
  envIsShadowed: boolean;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestDetail: string | null;
  lastTestTo: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
};

async function readRow() {
  return prisma.mailSettings.findUnique({
    where: { id: SINGLETON },
    include: { updatedBy: { select: { name: true } } },
  });
}

/** Lo que se muestra en la consola. Sin secretos. */
export async function getMailConfigView(): Promise<MailConfigView> {
  const config = env();
  const row = await readRow();
  const resolved = await resolveMailConfig();

  const envCanSend = canSend({
    smtpHost: config.SMTP_HOST,
    smtpPort: config.SMTP_PORT,
    mailFrom: config.MAIL_FROM,
  });

  return {
    smtpHost: row?.smtpHost ?? '',
    smtpPort: row?.smtpPort ?? null,
    smtpUser: row?.smtpUser ?? '',
    mailFrom: row?.mailFrom ?? '',
    credentialsMailTo: row?.credentialsMailTo ?? config.CREDENTIALS_MAIL_TO,
    inboundProtocol: row?.inboundProtocol ?? null,
    inboundHost: row?.inboundHost ?? '',
    inboundPort: row?.inboundPort ?? null,
    inboundUser: row?.inboundUser ?? '',
    hasSmtpPassword: Boolean(row?.smtpPasswordEnc),
    hasInboundPassword: Boolean(row?.inboundPasswordEnc),
    smtpPasswordUnreadable:
      Boolean(row?.smtpPasswordEnc) && openSecret(row?.smtpPasswordEnc, SMTP_PURPOSE) === null,
    inboundPasswordUnreadable:
      Boolean(row?.inboundPasswordEnc) &&
      openSecret(row?.inboundPasswordEnc, INBOUND_PURPOSE) === null,
    source: resolved?.source ?? 'sin-configurar',
    canSend: resolved !== null,
    envIsShadowed: envCanSend && resolved?.source === 'base',
    lastTestAt: row?.lastTestAt ?? null,
    lastTestOk: row?.lastTestOk ?? null,
    lastTestDetail: row?.lastTestDetail ?? null,
    lastTestTo: row?.lastTestTo ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedByName: row?.updatedBy?.name ?? null,
  };
}

export type SaveMailConfigResult = {
  warnings: ReturnType<typeof mailConfigWarnings>;
  canSend: boolean;
};

/**
 * Guarda la configuración.
 *
 * Una clave vacía **conserva la guardada**, no la borra: es lo que permite
 * corregir el puerto sin volver a pedirle la contraseña a quien la tenga
 * apuntada. Para quitarla hay un campo explícito.
 */
export async function saveMailConfig(
  user: CurrentUser,
  input: MailConfigDraft & { clearSmtpPassword?: boolean; clearInboundPassword?: boolean },
): Promise<SaveMailConfigResult> {
  const problems = mailConfigProblems(input);
  if (problems.length > 0) {
    throw new RuleError(problems.map((problem) => problem.message).join(' '));
  }

  const previous = await readRow();

  const smtpPassword = input.smtpPassword?.trim();
  const inboundPassword = input.inboundPassword?.trim();

  const smtpPasswordEnc = input.clearSmtpPassword
    ? null
    : smtpPassword
      ? sealSecret(smtpPassword, SMTP_PURPOSE)
      : (previous?.smtpPasswordEnc ?? null);

  const inboundPasswordEnc = input.clearInboundPassword
    ? null
    : inboundPassword
      ? sealSecret(inboundPassword, INBOUND_PURPOSE)
      : (previous?.inboundPasswordEnc ?? null);

  const data = {
    smtpHost: input.smtpHost?.trim() || null,
    smtpPort: input.smtpPort ?? null,
    smtpUser: input.smtpUser?.trim() || null,
    smtpPasswordEnc,
    mailFrom: input.mailFrom?.trim() || null,
    credentialsMailTo: input.credentialsMailTo?.trim() || null,
    inboundProtocol: input.inboundProtocol ?? null,
    inboundHost: input.inboundHost?.trim() || null,
    inboundPort: input.inboundPort ?? null,
    inboundUser: input.inboundUser?.trim() || null,
    inboundPasswordEnc,
    updatedById: user.id,
  };

  const saved = await prisma.mailSettings.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, ...data },
    update: data,
  });

  /*
    La auditoría guarda el ANTES y el DESPUÉS sin las claves. No se apoya en la
    redacción por nombre de campo de `recordAudit` —que busca `password`— porque
    acá los campos se llaman `…PasswordEnc`: se omiten a mano y se deja
    constancia sólo de si hay clave o no.
  */
  const trace = (row: typeof saved | null) => ({
    smtpHost: row?.smtpHost ?? null,
    smtpPort: row?.smtpPort ?? null,
    smtpUser: row?.smtpUser ?? null,
    mailFrom: row?.mailFrom ?? null,
    credentialsMailTo: row?.credentialsMailTo ?? null,
    inboundProtocol: row?.inboundProtocol ?? null,
    inboundHost: row?.inboundHost ?? null,
    inboundPort: row?.inboundPort ?? null,
    inboundUser: row?.inboundUser ?? null,
    claveSalida: row?.smtpPasswordEnc ? 'guardada (cifrada)' : 'sin clave',
    claveEntrada: row?.inboundPasswordEnc ? 'guardada (cifrada)' : 'sin clave',
  });

  await recordAudit({
    entity: 'MailSettings',
    entityId: saved.id,
    action: previous ? AuditAction.EDITAR : AuditAction.CREAR,
    user,
    summary:
      `Configuración de correo ${previous ? 'actualizada' : 'definida'}: ` +
      `salida ${saved.smtpHost ?? 'sin servidor'}:${saved.smtpPort ?? '—'}` +
      (saved.inboundHost
        ? `, entrada ${saved.inboundProtocol ?? '?'} ${saved.inboundHost}:${saved.inboundPort ?? '—'}`
        : ''),
    before: previous ? trace(previous as typeof saved) : undefined,
    after: trace(saved),
  });

  return { warnings: mailConfigWarnings(input), canSend: canSend(saved) };
}

export type MailTestResult = { ok: boolean; detail: string; to: string };

/**
 * Envía un correo de prueba y **guarda el resultado**.
 *
 * Es la razón de ser de la pantalla: sin esto, configurar el correo es escribir
 * datos y esperar a que algún día alguien note que no llegan. El error del
 * servidor se muestra tal cual —«authentication failed», «self signed
 * certificate»— porque es lo único que permite saber qué corregir.
 */
export async function sendMailTest(
  user: CurrentUser,
  input: { to: string },
): Promise<MailTestResult> {
  const to = input.to.trim();
  if (!to) throw new RuleError('Indica a qué dirección enviar la prueba.');

  const result = await sendMail({
    to,
    subject: 'Prueba de configuración · Libro Operativo de Recepción',
    text: [
      'Este es un envío de prueba del Libro Operativo de Recepción.',
      '',
      `Lo pidió ${user.name} desde la consola de administración.`,
      'Si lo estás leyendo, el correo de salida está bien configurado.',
    ].join('\n'),
  });

  const detail = result.sent
    ? `Enviado a ${to}.`
    : result.reason;

  await prisma.mailSettings.upsert({
    where: { id: SINGLETON },
    create: {
      id: SINGLETON,
      lastTestAt: new Date(),
      lastTestOk: result.sent,
      lastTestDetail: detail,
      lastTestTo: to,
      updatedById: user.id,
    },
    update: {
      lastTestAt: new Date(),
      lastTestOk: result.sent,
      lastTestDetail: detail,
      lastTestTo: to,
    },
  });

  await recordAudit({
    entity: 'MailSettings',
    entityId: SINGLETON,
    action: AuditAction.EDITAR,
    user,
    summary: `Prueba de correo a ${to}: ${result.sent ? 'enviada' : `falló — ${detail}`}`,
  });

  return { ok: result.sent, detail, to };
}
