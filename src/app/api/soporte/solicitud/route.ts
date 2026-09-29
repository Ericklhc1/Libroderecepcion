import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { sendMail, type MailAttachment } from '@/server/mail';
import { getSettingString } from '@/server/services/settings';

const attachmentSchema = z.object({
  name: z.string().min(1).max(180),
  type: z.string().min(1).max(120),
  dataUrl: z.string().min(20).max(5_000_000),
});

const bodySchema = z.object({
  kind: z.enum(['ERROR', 'FUNCION']),
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(6000),
  screenshot: attachmentSchema.nullable().optional(),
  attachment: attachmentSchema.nullable().optional(),
  context: z.object({
    pathname: z.string().max(500),
    search: z.string().max(1200),
    href: z.string().max(2000),
    userAgent: z.string().max(1200),
    language: z.string().max(80),
    timezone: z.string().max(120),
    viewport: z.string().max(40),
    screen: z.string().max(40),
    version: z.string().max(40),
    hotelName: z.string().max(160),
  }),
});

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 180) || 'adjunto';
}

function decodeAttachment(input: z.infer<typeof attachmentSchema>): MailAttachment {
  if (!ALLOWED_TYPES.has(input.type)) {
    throw new Error('El tipo de archivo adjunto no está permitido.');
  }

  const match = input.dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  const mediaType = match?.[1];
  const encoded = match?.[2];
  if (!mediaType || !encoded || mediaType !== input.type) {
    throw new Error('El archivo adjunto no tiene un formato válido.');
  }

  const content = Buffer.from(encoded, 'base64');
  if (content.length > 3 * 1024 * 1024) {
    throw new Error('El archivo adjunto supera 3 MB.');
  }

  return {
    filename: safeFilename(input.name),
    content,
    contentType: input.type,
  };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Tu sesión venció.' }, { status: 401 });
  }

  try {
    const payload = bodySchema.parse(await request.json());
    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, username: true },
    });
    const recipient = await getSettingString('support.recipient', 'eherrera@hoteleshw.com');

    const attachments: MailAttachment[] = [];
    if (payload.screenshot) attachments.push(decodeAttachment(payload.screenshot));
    if (payload.attachment) attachments.push(decodeAttachment(payload.attachment));

    const label = payload.kind === 'ERROR' ? 'Reporte de problema' : 'Solicitud de función';
    const route = payload.context.pathname + payload.context.search;

    const result = await sendMail({
      to: recipient,
      subject: `Central · ${label} · ${payload.subject}`,
      text: [
        label,
        '',
        `Asunto: ${payload.subject}`,
        `Fecha: ${new Date().toISOString()}`,
        '',
        'SOLICITANTE',
        `Nombre: ${user.name}`,
        `Usuario: ${account?.username ?? '—'}`,
        `Rol: ${user.roleName}`,
        `Correo: ${account?.email ?? 'sin correo registrado'}`,
        '',
        'CONTEXTO AUTOMÁTICO',
        `Alojamiento: ${payload.context.hotelName}`,
        `Versión: ${payload.context.version}`,
        `Ruta: ${route}`,
        `URL: ${payload.context.href}`,
        `Navegador: ${payload.context.userAgent}`,
        `Idioma: ${payload.context.language}`,
        `Zona horaria: ${payload.context.timezone}`,
        `Ventana: ${payload.context.viewport}`,
        `Pantalla: ${payload.context.screen}`,
        '',
        'DESCRIPCIÓN',
        payload.description,
        '',
        attachments.length > 0
          ? `Adjuntos: ${attachments.map((item) => item.filename).join(', ')}`
          : 'Adjuntos: ninguno',
      ].join('\n'),
      attachments,
    });

    if (!result.sent) {
      return NextResponse.json(
        { error: `No se pudo enviar la solicitud: ${result.reason}` },
        { status: 503 },
      );
    }

    return NextResponse.json({
      message:
        payload.kind === 'ERROR'
          ? 'Reporte enviado con el contexto técnico de esta pantalla.'
          : 'Solicitud enviada con el contexto técnico de esta pantalla.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Revisa el asunto, la descripción y los adjuntos.' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo procesar la solicitud.',
      },
      { status: 400 },
    );
  }
}
