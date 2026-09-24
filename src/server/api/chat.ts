import 'server-only';

import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';

const headers = { 'Cache-Control': 'no-store' };

export function chatJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers });
}

export function chatApiError(error: unknown) {
  if (error instanceof AppError) {
    const status =
      error.code === 'UNAUTHENTICATED'
        ? 401
        : error.code === 'FORBIDDEN'
          ? 403
          : error.code === 'NOT_FOUND'
            ? 404
            : error.code === 'VALIDATION'
              ? 422
              : 400;
    return chatJson({ error: error.message, code: error.code }, status);
  }
  console.error('[chat-api] error no controlado', error);
  return chatJson({ error: 'No se pudo completar la operación de chat.' }, 500);
}
