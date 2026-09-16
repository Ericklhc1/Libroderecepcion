import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import {
  executeReceptionConfirmation,
  runReceptionAssistant,
  type AssistantMessage,
} from '@/server/ai/reception-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(6000),
});

const requestSchema = z
  .object({
    messages: z.array(messageSchema).min(1).max(18).optional(),
    confirmationToken: z.string().min(20).max(20_000).optional(),
  })
  .refine((value) => Boolean(value.messages?.length || value.confirmationToken), {
    message: 'Falta el mensaje o la confirmación.',
  });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' }, { status: 401 });
  }

  try {
    const body = requestSchema.parse(await request.json());

    if (body.confirmationToken) {
      const result = await executeReceptionConfirmation(user, body.confirmationToken);
      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const result = await runReceptionAssistant(user, body.messages as AssistantMessage[]);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join(' ')
        : error instanceof Error
          ? error.message
          : 'No se pudo procesar la solicitud.';

    console.error('[asistente-recepcion]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
