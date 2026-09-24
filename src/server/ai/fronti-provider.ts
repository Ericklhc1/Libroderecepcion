import 'server-only';

import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { openSecret, sealSecret } from '@/lib/secret-box';
import {
  ASSISTANT_TIMEOUT_MS,
  classifyAssistantFailure,
  type AssistantFailure,
} from '@/domain/assistant-status';

export type FrontiProviderName = 'groq' | 'vllm' | 'openai';

const SECRET_PURPOSE_PREFIX = 'fronti/provider/';
const SECRET_SETTING_PREFIX = '__secret.fronti.provider.';

function secretSettingKey(provider: FrontiProviderName): string {
  return `${SECRET_SETTING_PREFIX}${provider}`;
}

function secretPurpose(provider: FrontiProviderName): string {
  return `${SECRET_PURPOSE_PREFIX}${provider}`;
}

async function readStoredProviderSecret(
  provider: FrontiProviderName,
): Promise<{ present: boolean; value: string | null }> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: secretSettingKey(provider) },
    select: { value: true },
  });
  if (!row) return { present: false, value: null };
  const sealed = typeof row.value === 'string' ? row.value : null;
  if (!sealed) return { present: true, value: null };
  return {
    present: true,
    value: openSecret(sealed, secretPurpose(provider)),
  };
}

export async function saveFrontiProviderSecret(
  provider: FrontiProviderName,
  apiKey: string,
  updatedById: string,
): Promise<void> {
  const clean = apiKey.trim();
  if (clean.length < 8) throw new Error('La credencial parece incompleta.');
  if (clean.length > 2000) throw new Error('La credencial supera el largo permitido.');

  const sealed = sealSecret(clean, secretPurpose(provider));
  await prisma.systemSetting.upsert({
    where: { key: secretSettingKey(provider) },
    create: {
      key: secretSettingKey(provider),
      value: sealed,
      category: 'secreto',
      description: 'Credencial cifrada del proveedor de IA. No listar ni devolver al cliente.',
      updatedById,
    },
    update: {
      value: sealed,
      updatedById,
    },
  });
}

export async function clearFrontiProviderSecret(
  provider: FrontiProviderName,
): Promise<void> {
  await prisma.systemSetting.deleteMany({
    where: { key: secretSettingKey(provider) },
  });
}

export async function getFrontiProviderCredentialView(
  provider: FrontiProviderName,
): Promise<{
  hasStoredSecret: boolean;
  storedSecretUnreadable: boolean;
  envConfigured: boolean;
}> {
  const stored = await readStoredProviderSecret(provider);
  const runtime = env();
  const envConfigured =
    provider === 'groq'
      ? Boolean(runtime.GROQ_API_KEY)
      : provider === 'openai'
        ? Boolean(runtime.OPENAI_API_KEY)
        : Boolean(runtime.FRONTI_API_KEY);

  return {
    hasStoredSecret: stored.present && stored.value !== null,
    storedSecretUnreadable: stored.present && stored.value === null,
    envConfigured,
  };
}

export type FrontiChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: FrontiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type FrontiToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

export function normalizeFrontiToolsForProvider(
  provider: FrontiProviderName,
  tools?: FrontiToolDefinition[],
): FrontiToolDefinition[] | undefined {
  if (!tools?.length || provider !== 'groq') return tools;

  return tools.map((tool) => {
    const parameters = tool.function.parameters;
    const properties =
      parameters.properties &&
      typeof parameters.properties === 'object' &&
      !Array.isArray(parameters.properties)
        ? (parameters.properties as Record<string, unknown>)
        : null;

    if (
      parameters.type !== 'object' ||
      !properties ||
      Object.keys(properties).length > 0
    ) {
      return tool;
    }

    /*
     * Groq rechaza schemas estrictos de herramientas sin argumentos aunque
     * properties: {} sea JSON Schema válido: lo reporta como si
     * properties faltara. Se añade un marcador técnico obligatorio que el
     * ejecutor ignora. Así las herramientas semánticamente sin argumentos
     * siguen siéndolo para FRONTI, pero el transporte cumple el validador de
     * Groq. Se aplica en la capa del proveedor para proteger también futuras
     * herramientas vacías.
     */
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...parameters,
          properties: {
            _fronti: {
              type: 'string',
              enum: ['current'],
              description:
                'Marcador interno del Libro para herramientas sin argumentos. Usa siempre "current".',
            },
          },
          required: ['_fronti'],
          additionalProperties: false,
        },
      },
    };
  });
}

export type FrontiToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: FrontiToolCall[];
    };
  }>;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
};

export type FrontiProviderConfig = {
  provider: FrontiProviderName;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
};

export class FrontiProviderError extends Error {
  readonly failure: AssistantFailure;
  readonly detail: string | null;

  constructor(failure: AssistantFailure, cause?: Error, detail?: string | null) {
    super(failure);
    this.name = 'FrontiProviderError';
    this.failure = failure;
    this.detail = detail?.trim() || null;
    if (cause) this.cause = cause;
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveFrontiProvider(input: {
  provider: FrontiProviderName;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
}): FrontiProviderConfig {
  const runtime = env();

  if (input.provider === 'vllm') {
    return {
      provider: 'vllm',
      baseUrl: trimSlash(runtime.FRONTI_BASE_URL ?? ''),
      apiKey: runtime.FRONTI_API_KEY ?? null,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
    };
  }

  if (input.provider === 'openai') {
    return {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: runtime.OPENAI_API_KEY ?? null,
      model: runtime.OPENAI_MODEL?.trim() || input.model,
      reasoningEffort: input.reasoningEffort,
    };
  }

  return {
    provider: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: runtime.GROQ_API_KEY ?? null,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  };
}

export async function resolveFrontiProviderRuntime(input: {
  provider: FrontiProviderName;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
}): Promise<FrontiProviderConfig> {
  const resolved = resolveFrontiProvider(input);
  const stored = await readStoredProviderSecret(input.provider);
  return stored.value ? { ...resolved, apiKey: stored.value } : resolved;
}

export function providerIsConfigured(config: FrontiProviderConfig): boolean {
  if (!config.baseUrl) return false;
  if (config.provider === 'vllm') return true;
  return Boolean(config.apiKey);
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function parseFailure(
  response: Response,
): Promise<{ failure: AssistantFailure; detail?: string }> {
  let code: string | null = null;
  let message: string | null = null;

  try {
    const payload = (await response.json()) as ChatCompletionPayload;
    code = payload.error?.code ?? payload.error?.type ?? null;
    message = payload.error?.message ?? null;
  } catch {
    // Un proxy puede devolver HTML. El estado HTTP sigue siendo suficiente.
  }

  return {
    failure: classifyAssistantFailure({
      status: response.status,
      code,
      message,
    }),
    detail: message ?? undefined,
  };
}

export async function chatWithFrontiProvider(args: {
  provider: FrontiProviderConfig;
  messages: FrontiChatMessage[];
  tools?: FrontiToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none';
}): Promise<{
  text: string;
  toolCalls: FrontiToolCall[];
  assistantMessage: FrontiChatMessage;
}> {
  if (!providerIsConfigured(args.provider)) {
    throw new FrontiProviderError('SIN_CLAVE');
  }

  const transportTools = normalizeFrontiToolsForProvider(
    args.provider.provider,
    args.tools,
  );

  let response: Response;
  try {
    response = await fetch(`${args.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...authHeaders(args.provider.apiKey),
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
      body: JSON.stringify({
        model: args.provider.model,
        messages: args.messages,
        tools: transportTools?.length ? transportTools : undefined,
        tool_choice: transportTools?.length ? (args.toolChoice ?? 'auto') : undefined,
        parallel_tool_calls: false,
        ...(args.provider.provider === 'groq' &&
        args.provider.model.startsWith('openai/gpt-oss-')
          ? {
              reasoning_effort: args.provider.reasoningEffort,
              /*
               * Groq exige reasoning_format="hidden" (o "parsed") cuando
               * GPT-OSS usa tool calling. include_reasoning=false sirve para
               * respuestas de texto, pero combinado con tools provoca un 400
               * de petición inválida. Fronti usa herramientas en toda
               * conversación operativa, por lo que este campo es obligatorio.
               */
              reasoning_format: 'hidden',
            }
          : {}),
      }),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'TimeoutError';
    throw new FrontiProviderError(
      classifyAssistantFailure({ aborted, network: !aborted }),
      error instanceof Error ? error : undefined,
    );
  }

  if (!response.ok) {
    const failure = await parseFailure(response);
    throw new FrontiProviderError(failure.failure, undefined, failure.detail);
  }

  let payload: ChatCompletionPayload;
  try {
    payload = (await response.json()) as ChatCompletionPayload;
  } catch (error) {
    throw new FrontiProviderError('CAIDO', error instanceof Error ? error : undefined);
  }

  const message = payload.choices?.[0]?.message;
  if (!message) throw new FrontiProviderError('CAIDO');

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  const assistantMessage: FrontiChatMessage = {
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };

  return { text, toolCalls, assistantMessage };
}

export async function probeFrontiProvider(
  provider: FrontiProviderConfig,
): Promise<{ ok: true } | { ok: false; failure: AssistantFailure }> {
  if (!providerIsConfigured(provider)) {
    return { ok: false, failure: 'SIN_CLAVE' };
  }

  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}/models`, {
      headers: {
        ...authHeaders(provider.apiKey),
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      failure: classifyAssistantFailure({ aborted, network: !aborted }),
    };
  }

  if (!response.ok) {
    const failure = await parseFailure(response);
    return { ok: false, failure: failure.failure };
  }

  try {
    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    const ids = new Set((payload.data ?? []).map((item) => item.id).filter(Boolean));
    if (ids.size > 0 && !ids.has(provider.model)) {
      return { ok: false, failure: 'MODELO_DESCONOCIDO' };
    }
  } catch {
    // Algunos vLLM/proxies no siguen exactamente el shape de /models.
    // Si el endpoint respondió 2xx, se considera configurado.
  }

  return { ok: true };
}
