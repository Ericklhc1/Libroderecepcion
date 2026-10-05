import { withMaintenance } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import {
  createR2PresignedPutUrl,
  isR2Configured,
  makeSupportStorageKey,
} from '@/server/storage/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

const schema = z.object({
  name: z.string().trim().min(1).max(180),
  type: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(3 * 1024 * 1024),
  kind: z.enum(['CAPTURA', 'ARCHIVO']),
});

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 180) || 'adjunto';
}

async function POSTHandler(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Tu sesión venció.' }, { status: 401 });
  }

  try {
    const payload = schema.parse(await request.json());
    if (!ALLOWED_TYPES.has(payload.type)) {
      return NextResponse.json({ error: 'El tipo de archivo no está permitido.' }, { status: 400 });
    }
    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'El almacenamiento interno de adjuntos no está configurado.' },
        { status: 503 },
      );
    }

    const fileName = safeFilename(payload.name);
    const storageKey = makeSupportStorageKey(
      user.id,
      fileName,
      payload.kind === 'CAPTURA' ? 'captura' : 'archivo',
    );
    const signed = createR2PresignedPutUrl(storageKey, payload.type, 300);

    return NextResponse.json({
      storageKey,
      fileName,
      mimeType: payload.type,
      size: payload.size,
      kind: payload.kind,
      uploadUrl: signed.url,
      expiresAt: signed.expiresAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Revisa el archivo adjunto.' }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo preparar el adjunto.' },
      { status: 400 },
    );
  }
}

export const POST = withMaintenance(POSTHandler);
