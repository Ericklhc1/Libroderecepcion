import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { sendMail, type MailAttachment } from '@/server/mail';
import { getSettingString } from '@/server/services/settings';
import { getReceptionOperationGate } from '@/server/services/reception-operation-gate';

const attachmentSchema = z.object({
  name: z.string().min(1).max(180),
  type: z.string().min(1).max(120),
  dataUrl: z.string().min(20).max(5_000_000),
});

const storedAttachmentSchema = z.object({
  kind: z.enum(['CAPTURA', 'ARCHIVO']),
  storageKey: z.string().min(1).max(1000),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().positive().max(3 * 1024 * 1024),
});

const bodySchema = z.object({
  correlationId: z.string().uuid(),
  kind: z.enum(['ERROR', 'FUNCION']),
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(6000),
  screenshot: attachmentSchema.nullable().optional(),
  attachment: attachmentSchema.nullable().optional(),
  storedAttachments: z.array(storedAttachmentSchema).max(2).default([]),
  context: z.object({
    pathname: z.string().max(500),
    search: z.string().max(1200),
    href: z.string().max(2000),
    userAgent: z.string().max(1200),
    platform: z.string().max(200),
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
    const [recipient, operationGate] = await Promise.all([
      getSettingString('support.recipient', 'eherrera@hoteleshw.com'),
      getReceptionOperationGate(user),
    ]);

    const attachments: MailAttachment[] = [];
    if (payload.screenshot) attachments.push(decodeAttachment(payload.screenshot));
    if (payload.attachment) attachments.push(decodeAttachment(payload.attachment));

    const storedAttachments = payload.storedAttachments.map((item) => {
      if (!ALLOWED_TYPES.has(item.mimeType)) {
        throw new Error('El tipo de archivo archivado no está permitido.');
      }
      if (
        !item.storageKey.startsWith(`support/${user.id}/`) ||
        item.storageKey.includes('..')
      ) {
        throw new Error('La referencia del archivo archivado no es válida.');
      }
      return {
        kind: item.kind,
        storageKey: item.storageKey,
        fileName: safeFilename(item.fileName),
        mimeType: item.mimeType,
        size: item.size,
      };
    });
    if (new Set(storedAttachments.map((item) => item.storageKey)).size !== storedAttachments.length) {
      throw new Error('Hay referencias de adjuntos duplicadas.');
    }

    const allAttachmentNames = Array.from(
      new Set([
        ...storedAttachments.map((item) => item.fileName),
        ...attachments.map((item) => item.filename),
      ]),
    );
    const storedAttachmentNames = storedAttachments.map((item) => item.fileName);
    const emailAttachmentNames = attachments.map((item) => item.filename);

    const label = payload.kind === 'ERROR' ? 'Reporte de problema' : 'Solicitud de función';
    const route = payload.context.pathname + payload.context.search;

    // La bandeja interna es la fuente de verdad. SMTP sólo avisa.
    const supportRequest = await prisma.supportRequest.create({
      data: {
        correlationId: payload.correlationId,
        kind: payload.kind,
        subject: payload.subject,
        description: payload.description,
        requestedById: user.id,
        requesterName: user.name,
        requesterUser: account?.username ?? '—',
        requesterRole: user.roleName,
        requesterEmail: account?.email ?? null,
        context: {
          ...payload.context,
          route,
          operationMode: operationGate.mode,
          shiftId: operationGate.shiftId ?? null,
          handoverId: operationGate.handoverId ?? null,
        },
        attachmentNames: allAttachmentNames,
        attachments:
          storedAttachments.length > 0
            ? {
                create: storedAttachments,
              }
            : undefined,
        emailRecipient: recipient,
      },
    });

    let mailSent = false;
    let mailError: string | null = null;
    try {
      const result = await sendMail({
        to: recipient,
        subject: `AROH · ${label} · ${payload.subject}`,
        text: [
          label,
          '',
          `Asunto: ${payload.subject}`,
          `Referencia: ${payload.correlationId}`,
          `Fecha: ${supportRequest.createdAt.toISOString()}`,
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
          `Plataforma: ${payload.context.platform}`,
          `Idioma: ${payload.context.language}`,
          `Zona horaria: ${payload.context.timezone}`,
          `Ventana: ${payload.context.viewport}`,
          `Pantalla: ${payload.context.screen}`,
          `Estado de turno: ${operationGate.mode}`,
          `Turno activo: ${operationGate.shiftId ?? '—'}`,
          `Entrega relacionada: ${operationGate.handoverId ?? '—'}`,
          '',
          'DESCRIPCIÓN',
          payload.description,
          '',
          allAttachmentNames.length > 0
            ? `Adjuntos declarados: ${allAttachmentNames.join(', ')}`
            : 'Adjuntos declarados: ninguno',
          storedAttachmentNames.length > 0
            ? `Disponibles en bandeja: ${storedAttachmentNames.join(', ')}`
            : 'Disponibles en bandeja: ninguno',
          emailAttachmentNames.length > 0
            ? `Incluidos como respaldo en este correo: ${emailAttachmentNames.join(', ')}`
            : 'Incluidos como respaldo en este correo: ninguno',
          '',
          'Bandeja interna: /admin/soporte',
        ].join('\n'),
        attachments,
      });
      mailSent = result.sent;
      mailError = result.sent ? null : result.reason;
    } catch (error) {
      mailError = error instanceof Error ? error.message : 'Error de correo no identificado.';
    }

    await prisma.supportRequest.update({
      where: { id: supportRequest.id },
      data: {
        emailSent: mailSent,
        emailError: mailError,
      },
    });

    return NextResponse.json({
      message:
        payload.kind === 'ERROR'
          ? `Reporte registrado. Referencia: ${payload.correlationId}`
          : `Solicitud registrada. Referencia: ${payload.correlationId}`,
      mailSent,
      storedAttachmentCount: storedAttachments.length,
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
