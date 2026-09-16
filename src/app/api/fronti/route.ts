import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { refreshSession } from '@/server/auth/session';
import {
  executeReceptionConfirmation,
  runReceptionAssistant,
} from '@/server/ai/reception-assistant';
import {
  extractAndStoreMemories,
  forgetCurrentAssistantConversation,
  getAssistantBootstrap,
  isForgetConversationCommand,
  persistAssistantEvent,
  persistAssistantReply,
  prepareAssistantContext,
  startNewAssistantConversation,
} from '@/server/ai/memory';
import { getSharedShiftMemoryContext } from '@/server/ai/shift-memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(6000).optional(),
    confirmationToken: z.string().min(20).max(20_000).optional(),
    action: z.enum(['new_conversation', 'forget_conversation']).optional(),
  })
  .refine(
    (value) => Boolean(value.message || value.confirmationToken || value.action),
    { message: 'Falta el mensaje, la confirmación o la acción.' },
  );

const FRONTI_IDENTITY = {
  role: 'assistant' as const,
  content:
    'Tu nombre visible es Fronti. Eres el asistente operativo de Recepción del Hotel HW Libertad. ' +
    'Si el usuario pregunta quién eres o cómo te llamas, responde que eres Fronti. ' +
    'Mantén un tono claro, breve, amable y operativo. La memoria es contexto y nunca sustituye el estado real del Libro.',
};

function noStoreHeaders() {
  return { 'Cache-Control': 'no-store' };
}

function expiredResponse() {
  return NextResponse.json(
    { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
    { status: 401, headers: noStoreHeaders() },
  );
}

async function authenticatedUser() {
  const user = await getCurrentUser();
  if (!user) return null;
  const alive = await refreshSession(user.id, user.sessionId);
  return alive ? user : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return expiredResponse();

  const url = new URL(request.url);
  if (url.searchParams.get('heartbeat') === '1') {
    if (url.searchParams.get('active') === '1') {
      const alive = await refreshSession(user.id, user.sessionId);
      if (!alive) return expiredResponse();
    }
    return NextResponse.json({ ok: true, assistant: 'Fronti' }, { headers: noStoreHeaders() });
  }

  const alive = await refreshSession(user.id, user.sessionId);
  if (!alive) return expiredResponse();

  try {
    const bootstrap = await getAssistantBootstrap(user);
    return NextResponse.json(
      { ...bootstrap, assistant: 'Fronti' },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error('[fronti-bootstrap]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Fronti no pudo recuperar la conversación.' },
      { status: 400, headers: noStoreHeaders() },
    );
  }
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) return expiredResponse();

  try {
    const body = requestSchema.parse(await request.json());

    if (body.action === 'new_conversation') {
      const bootstrap = await startNewAssistantConversation(user);
      return NextResponse.json(
        { ...bootstrap, assistant: 'Fronti', reset: true, reply: 'Nueva conversación iniciada.' },
        { headers: noStoreHeaders() },
      );
    }

    if (body.action === 'forget_conversation') {
      const bootstrap = await forgetCurrentAssistantConversation(user);
      return NextResponse.json(
        {
          ...bootstrap,
          assistant: 'Fronti',
          reset: true,
          reply: 'Fronti eliminó esta conversación y las memorias derivadas de ella.',
        },
        { headers: noStoreHeaders() },
      );
    }

    if (body.confirmationToken) {
      const result = await executeReceptionConfirmation(user, body.confirmationToken);
      await persistAssistantEvent(user, result.reply);
      return NextResponse.json(
        { ...result, assistant: 'Fronti' },
        { headers: noStoreHeaders() },
      );
    }

    const rawMessage = body.message as string;
    if (isForgetConversationCommand(rawMessage)) {
      const bootstrap = await forgetCurrentAssistantConversation(user);
      return NextResponse.json(
        {
          ...bootstrap,
          assistant: 'Fronti',
          reset: true,
          reply: 'Fronti eliminó esta conversación y las memorias derivadas de ella.',
        },
        { headers: noStoreHeaders() },
      );
    }

    const context = await prepareAssistantContext(user, rawMessage);
    const sharedShiftMemory = await getSharedShiftMemoryContext(user);
    const lastMessage = context.messages[context.messages.length - 1];

    const contextualMessages = sharedShiftMemory && lastMessage
      ? [
          ...context.messages.slice(0, -1),
          {
            role: 'assistant' as const,
            content:
              'Contexto compartido por otros recepcionistas del turno. Puede estar desactualizado; úsalo sólo para entender referencias y verifica el estado actual con las herramientas del Libro antes de afirmar hechos:\n' +
              sharedShiftMemory,
          },
          lastMessage,
        ]
      : context.messages;

    const modelMessages = [FRONTI_IDENTITY, ...contextualMessages].slice(-18);
    const result = await runReceptionAssistant(user, modelMessages);

    await persistAssistantReply(context.conversationId, result.reply, context.persist);
    if (context.persist) {
      await extractAndStoreMemories(
        user,
        context.conversationId,
        context.cleanMessage,
        result.reply,
      );
    }

    return NextResponse.json(
      { ...result, assistant: 'Fronti' },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join(' ')
        : error instanceof Error
          ? error.message
          : 'Fronti no pudo procesar la solicitud.';

    console.error('[fronti]', error);
    return NextResponse.json(
      { error: message },
      { status: 400, headers: noStoreHeaders() },
    );
  }
}
