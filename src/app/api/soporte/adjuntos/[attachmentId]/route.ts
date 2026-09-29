import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/server/auth/guard';
import { AppError } from '@/server/errors';
import { createR2PresignedGetUrl, isR2Configured } from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorStatus(error: AppError): number {
  if (error.code === 'UNAUTHENTICATED') return 401;
  if (error.code === 'FORBIDDEN') return 403;
  if (error.code === 'NOT_FOUND') return 404;
  return 400;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  try {
    await requirePermission('support.view');
    const { attachmentId } = await params;
    const attachment = await prisma.supportRequestAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, storageKey: true },
    });

    if (!attachment) {
      return NextResponse.json({ error: 'El adjunto no existe.' }, { status: 404 });
    }
    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'El almacenamiento de adjuntos no está disponible.' },
        { status: 503 },
      );
    }

    const signed = createR2PresignedGetUrl(attachment.storageKey, 300);
    return NextResponse.redirect(signed.url, { status: 302 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
    }
    return NextResponse.json({ error: 'No se pudo abrir el adjunto.' }, { status: 500 });
  }
}
