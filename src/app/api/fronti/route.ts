import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { refreshSession } from '@/server/auth/session';
import {
  AssistantError,
  executeReceptionConfirmation,
  runReceptionAssistant,
} from '@/server/ai/reception-assistant';
import {
  ASSISTANT_FAILURE_IS_TEMPORARY,
  ASSISTANT_FAILURE_STATUS,
} from '@/domain/assistant-status';
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
import { getFrontiConfig } from '@/server/ai/fronti-config';
import { canUseFronti } from '@/server/ai/fronti-access';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({
    message: z.string().trim().min(1).max(6000).optional(),
    confirmationToken: z.string().min(20).max(20_000).optional(),
    action: z.enum(['new_conversation', 'forget_conversation']).optional(),
    pageContext: z
      .object({
        pathname: z.string().trim().min(1).max(500),
      })
      .optional(),
  })
  .refine(
    (value) => Boolean(value.message || value.confirmationToken || value.action),
    { message: 'Falta el mensaje, la confirmación o la acción.' },
  );

function noStoreHeaders() {
  return { 'Cache-Control': 'no-store' };
}

function expiredResponse() {
  return NextResponse.json(
    { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
    { status: 401, headers: noStoreHeaders() },
  );
}

function termsRequiredResponse() {
  return NextResponse.json(
    { error: 'Debes aceptar los términos vigentes antes de utilizar Fronti.' },
    { status: 403, headers: noStoreHeaders() },
  );
}

async function authenticatedUser() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return null;
  const alive = await refreshSession(user.id, user.sessionId);
  if (!alive) return null;
  if (!(await hasAcceptedCurrentTerms(user.id))) return null;
  return user;
}

function publicConfig(
  config: Awaited<ReturnType<typeof getFrontiConfig>>,
  enabled: boolean,
) {
  return {
    enabled,
    displayName: config.displayName,
    welcomeMessage: config.welcomeMessage,
    sessionActivityMinutes: config.sessionActivityMinutes,
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return expiredResponse();
  if (user.mustChangePassword || !(await hasAcceptedCurrentTerms(user.id))) {
    return termsRequiredResponse();
  }

  const config = await getFrontiConfig();
  const accessEnabled = canUseFronti(user, config.enabled);
  if (!accessEnabled) {
    return NextResponse.json(
      { error: `${config.displayName} no está habilitado para tu cuenta.` },
      { status: 403, headers: noStoreHeaders() },
    );
  }

  const url = new URL(request.url);
  if (url.searchParams.get('heartbeat') === '1') {
    if (url.searchParams.get('active') === '1') {
      const alive = await refreshSession(user.id, user.sessionId);
      if (!alive) return expiredResponse();
    }
    return NextResponse.json(
      { ok: true, assistant: config.displayName, config: publicConfig(config, accessEnabled) },
      { headers: noStoreHeaders() },
    );
  }

  const alive = await refreshSession(user.id, user.sessionId);
  if (!alive) return expiredResponse();

  try {
    const bootstrap = await getAssistantBootstrap(user);
    return NextResponse.json(
      { ...bootstrap, assistant: config.displayName, config: publicConfig(config, accessEnabled) },
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
    const config = await getFrontiConfig();
    const accessEnabled = canUseFronti(user, config.enabled);
    if (!accessEnabled) {
      return NextResponse.json(
        { error: `${config.displayName} no está habilitado para tu cuenta.` },
        { status: 403, headers: noStoreHeaders() },
      );
    }

    const body = requestSchema.parse(await request.json());

    if (body.action === 'new_conversation') {
      const bootstrap = await startNewAssistantConversation(user);
      return NextResponse.json(
        {
          ...bootstrap,
          assistant: config.displayName,
          config: publicConfig(config, accessEnabled),
          reset: true,
          reply: 'Nueva conversación iniciada.',
        },
        { headers: noStoreHeaders() },
      );
    }

    if (body.action === 'forget_conversation') {
      const bootstrap = await forgetCurrentAssistantConversation(user);
      return NextResponse.json(
        {
          ...bootstrap,
          assistant: config.displayName,
          config: publicConfig(config, accessEnabled),
          reset: true,
          reply: `${config.displayName} eliminó esta conversación y las memorias derivadas de ella.`,
        },
        { headers: noStoreHeaders() },
      );
    }

    if (body.confirmationToken) {
      const result = await executeReceptionConfirmation(user, body.confirmationToken);
      await persistAssistantEvent(user, result.reply);
      return NextResponse.json(
        { ...result, assistant: config.displayName, config: publicConfig(config, accessEnabled) },
        { headers: noStoreHeaders() },
      );
    }

    const rawMessage = body.message as string;
    if (isForgetConversationCommand(rawMessage)) {
      const bootstrap = await forgetCurrentAssistantConversation(user);
      return NextResponse.json(
        {
          ...bootstrap,
          assistant: config.displayName,
          config: publicConfig(config, accessEnabled),
          reset: true,
          reply: `${config.displayName} eliminó esta conversación y las memorias derivadas de ella.`,
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

    const identity = {
      role: 'assistant' as const,
      content:
        `Tu nombre visible es ${config.displayName}. Eres el asistente operativo de Recepción del Hotel HW Libertad. ` +
        `Si el usuario pregunta quién eres o cómo te llamas, responde que eres ${config.displayName}. ` +
        'Mantén un tono claro, breve, amable y operativo. La memoria es contexto y nunca sustituye el estado real del Libro.',
    };

    const pageContext = body.pageContext?.pathname
      ? {
          role: 'assistant' as const,
          content:
            'Contexto efímero de la pantalla actual (no es fuente de verdad): ' +
            JSON.stringify({ pathname: body.pageContext.pathname }) +
            '. Úsalo para entender referencias como «esta habitación» o «esta tarea» y verifica la entidad con herramientas antes de escribir.',
        }
      : null;

    const modelMessages = [
      identity,
      ...(pageContext ? [pageContext] : []),
      ...contextualMessages,
    ].slice(-(config.modelHistoryLimit + 4));
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
      { ...result, assistant: config.displayName, config: publicConfig(config, accessEnabled) },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error('[fronti]', error);

    /*
      Un fallo del asistente ya sabe qué es, así que se responde con SU estado
      —503 si no está configurado, 429 si está saturado, 504 si se agotó el
      plazo— y con un mensaje operativo en español.

      Antes todo salía como 400 con el texto que viniera de OpenAI, y eso
      llegaba tal cual al chat del mesón: el recepcionista leía un error
      técnico en inglés que no le decía a quién avisar, y la monitorización no
      podía distinguir «lo pediste mal» de «el proveedor está caído».
    */
    if (error instanceof AssistantError) {
      return NextResponse.json(
        {
          error: error.message,
          causa: error.failure,
          reintentable: ASSISTANT_FAILURE_IS_TEMPORARY[error.failure],
        },
        { status: ASSISTANT_FAILURE_STATUS[error.failure], headers: noStoreHeaders() },
      );
    }

    const message =
      error instanceof z.ZodError
        ? error.issues.map((issue) => issue.message).join(' ')
        : error instanceof Error
          ? error.message
          : 'Fronti no pudo procesar la solicitud.';

    return NextResponse.json(
      { error: message },
      { status: 400, headers: noStoreHeaders() },
    );
  }
}
