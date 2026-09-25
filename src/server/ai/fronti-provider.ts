import 'server-only';

import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { openSecret, sealSecret } from '@/lib/secret-box';
import {
  ASSISTANT_TIMEOUT_MS,
  classifyAssistantFailure,
  type AssistantFailure,
} from '@/domain/assistant-status';
import { normalizeFrontiToolsForProvider } from './fronti-v2/provider-schema';

export type FrontiProviderName = 'groq' | 'cloudflare' | 'vllm' | 'openai';

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
  const cloudflareAccountId =
    runtime.CLOUDFLARE_ACCOUNT_ID ??
    runtime.R2_ACCOUNT_ID ??
    runtime.R2_ACCOUND_ID ??
    null;
  const envConfigured =
    provider === 'groq'
      ? Boolean(runtime.GROQ_API_KEY)
      : provider === 'cloudflare'
        ? Boolean(runtime.CLOUDFLARE_AI_API_TOKEN && cloudflareAccountId)
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


type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
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

  if (input.provider === 'cloudflare') {
    const accountId =
      runtime.CLOUDFLARE_ACCOUNT_ID ??
      runtime.R2_ACCOUNT_ID ??
      runtime.R2_ACCOUND_ID ??
      '';
    return {
      provider: 'cloudflare',
      baseUrl: accountId
        ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
        : '',
      apiKey: runtime.CLOUDFLARE_AI_API_TOKEN ?? null,
      model: input.model.trim().startsWith('@cf/')
        ? input.model.trim()
        : CLOUDFLARE_FALLBACK_MODEL,
      reasoningEffort: input.reasoningEffort,
    };
  }

  if (input.provider === 'openai') {
    return {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: runtime.OPENAI_API_KEY ?? null,
      model: input.model.trim() || runtime.OPENAI_MODEL?.trim() || OPENAI_PRIMARY_MODEL,
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


export async function resolveFrontiProviderChainRuntime(input: {
  reasoningEffort: 'low' | 'medium' | 'high';
}): Promise<FrontiProviderConfig[]> {
  /*
   * Modo costo cero obligatorio:
   * 1) Groq 120B como cerebro principal.
   * 2) Workers AI Free con GLM-4.7-Flash como proveedor independiente.
   * 3) Groq 20B como continuidad liviana.
   *
   * OpenAI puede conservarse como integración heredada, pero nunca forma parte
   * de la cadena operativa de FRONTI.
   */
  const [groq120b, cloudflare, groq20b] = await Promise.all([
    resolveFrontiProviderRuntime({
      provider: 'groq',
      model: GROQ_PRIMARY_MODEL,
      reasoningEffort: input.reasoningEffort,
    }),
    resolveFrontiProviderRuntime({
      provider: 'cloudflare',
      model: CLOUDFLARE_FALLBACK_MODEL,
      reasoningEffort: input.reasoningEffort,
    }),
    resolveFrontiProviderRuntime({
      provider: 'groq',
      model: GROQ_FALLBACK_MODEL,
      reasoningEffort: input.reasoningEffort,
    }),
  ]);

  return [groq120b, cloudflare, groq20b].filter(providerIsConfigured);
}

export async function resolveFrontiAuxiliaryProviderRuntime(): Promise<FrontiProviderConfig | null> {
  const [cloudflare, groq] = await Promise.all([
    resolveFrontiProviderRuntime({
      provider: 'cloudflare',
      model: CLOUDFLARE_FALLBACK_MODEL,
      reasoningEffort: 'low',
    }),
    resolveFrontiProviderRuntime({
      provider: 'groq',
      model: GROQ_FALLBACK_MODEL,
      reasoningEffort: 'low',
    }),
  ]);

  return [cloudflare, groq].find(providerIsConfigured) ?? null;
}

export function providerIsConfigured(config: FrontiProviderConfig): boolean {
  if (!config.baseUrl) return false;
  if (config.provider === 'vllm') return true;
  return Boolean(config.apiKey);
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

const MAX_RATE_LIMIT_RETRY_MS = 12_500;
const MAX_MODEL_OUTPUT_TOKENS = 1_800;
export const OPENAI_PRIMARY_MODEL = 'gpt-5.6-sol';
export const OPENAI_SECONDARY_MODEL = 'gpt-5.6-terra';
export const OPENAI_TERTIARY_MODEL = 'gpt-5.6-luna';
export const OPENAI_AUXILIARY_MODEL = OPENAI_TERTIARY_MODEL;
export const GROQ_PRIMARY_MODEL = 'openai/gpt-oss-120b';
export const CLOUDFLARE_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash';
export const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b';

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1000) + 250;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

function openAIResponsesInput(messages: FrontiChatMessage[]): unknown[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
      continue;
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      if (message.content) {
        input.push({ role: 'assistant', content: message.content });
      }
      for (const call of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      continue;
    }

    input.push({
      role: message.role,
      content: message.content ?? '',
    });
  }

  return input;
}

function openAIResponsesTools(tools?: FrontiToolDefinition[]): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: tool.function.strict ?? true,
  }));
}

async function chatWithOpenAIResponses(args: {
  provider: FrontiProviderConfig;
  messages: FrontiChatMessage[];
  tools?: FrontiToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none';
}): Promise<{
  text: string;
  toolCalls: FrontiToolCall[];
  assistantMessage: FrontiChatMessage;
  modelUsed: string;
}> {
  let response: Response;
  try {
    response = await fetch(`${args.provider.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        ...authHeaders(args.provider.apiKey),
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
      body: JSON.stringify({
        model: args.provider.model,
        input: openAIResponsesInput(args.messages),
        tools: openAIResponsesTools(args.tools),
        tool_choice: args.tools?.length ? (args.toolChoice ?? 'auto') : undefined,
        parallel_tool_calls: false,
        reasoning: { effort: args.provider.reasoningEffort },
        max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,
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

  let payload: OpenAIResponsePayload;
  try {
    payload = (await response.json()) as OpenAIResponsePayload;
  } catch (error) {
    throw new FrontiProviderError('CAIDO', error instanceof Error ? error : undefined);
  }

  const toolCalls: FrontiToolCall[] = [];
  const textParts: string[] = [];

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    textParts.push(payload.output_text.trim());
  }

  for (const item of payload.output ?? []) {
    if (
      item.type === 'function_call' &&
      typeof item.call_id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.arguments === 'string'
    ) {
      toolCalls.push({
        id: item.call_id,
        type: 'function',
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      });
      continue;
    }

    if (item.type === 'message') {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text' && typeof content.text === 'string') {
          const clean = content.text.trim();
          if (clean && !textParts.includes(clean)) textParts.push(clean);
        }
      }
    }
  }

  const text = textParts.join('\n\n').trim();
  const assistantMessage: FrontiChatMessage = {
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };

  return {
    text,
    toolCalls,
    assistantMessage,
    modelUsed: args.provider.model,
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
  modelUsed: string;
}> {
  if (!providerIsConfigured(args.provider)) {
    throw new FrontiProviderError('SIN_CLAVE');
  }

  if (args.provider.provider === 'openai') {
    return chatWithOpenAIResponses(args);
  }

  const transportTools = normalizeFrontiToolsForProvider(
    args.provider.provider,
    args.tools,
  );

  const buildRequestBody = (model: string) =>
    JSON.stringify({
      model,
      messages: args.messages,
      tools: transportTools?.length ? transportTools : undefined,
      tool_choice: transportTools?.length ? (args.toolChoice ?? 'auto') : undefined,
      parallel_tool_calls: false,
      max_completion_tokens: MAX_MODEL_OUTPUT_TOKENS,
      ...(args.provider.provider === 'groq' &&
      model.startsWith('openai/gpt-oss-')
        ? {
            reasoning_effort: args.provider.reasoningEffort,
            reasoning_format: 'hidden',
          }
        : {}),
    });

  const performRequest = async (model: string): Promise<Response> => {
    try {
      return await fetch(`${args.provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...authHeaders(args.provider.apiKey),
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
        body: buildRequestBody(model),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'TimeoutError';
      throw new FrontiProviderError(
        classifyAssistantFailure({ aborted, network: !aborted }),
        error instanceof Error ? error : undefined,
      );
    }
  };

  let modelUsed = args.provider.model;
  let response = await performRequest(modelUsed);

  if (
    response.status === 429 &&
    !(args.provider.provider === 'groq' && modelUsed === GROQ_PRIMARY_MODEL)
  ) {
    const delay = retryAfterMs(response);
    if (delay !== null && delay <= MAX_RATE_LIMIT_RETRY_MS) {
      console.info(
        '[fronti-provider] rate limit temporal; reintento interno',
        JSON.stringify({
          provider: args.provider.provider,
          model: modelUsed,
          retryMs: delay,
        }),
      );
      await wait(delay);
      response = await performRequest(modelUsed);
    }
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

  return { text, toolCalls, assistantMessage, modelUsed };
}

export async function chatWithFrontiProviderChain(args: {
  providers: FrontiProviderConfig[];
  messages: FrontiChatMessage[];
  tools?: FrontiToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none';
}): Promise<{
  text: string;
  toolCalls: FrontiToolCall[];
  assistantMessage: FrontiChatMessage;
  modelUsed: string;
  providerUsed: FrontiProviderName;
}> {
  if (!args.providers.length) {
    throw new FrontiProviderError('SIN_CLAVE');
  }

  let lastError: FrontiProviderError | null = null;

  for (const provider of args.providers) {
    try {
      const result = await chatWithFrontiProvider({
        provider,
        messages: args.messages,
        tools: args.tools,
        toolChoice: args.toolChoice,
      });
      return {
        ...result,
        providerUsed: provider.provider,
      };
    } catch (error) {
      if (!(error instanceof FrontiProviderError)) throw error;
      lastError = error;
      console.warn(
        '[fronti-provider] proveedor no disponible; intentando fallback',
        JSON.stringify({
          provider: provider.provider,
          model: provider.model,
          failure: error.failure,
          detail: error.detail?.slice(0, 500) ?? null,
        }),
      );
    }
  }

  throw lastError ?? new FrontiProviderError('CAIDO');
}

export async function probeFrontiProvider(
  provider: FrontiProviderConfig,
): Promise<{ ok: true } | { ok: false; failure: AssistantFailure }> {
  if (!providerIsConfigured(provider)) {
    return { ok: false, failure: 'SIN_CLAVE' };
  }

  let response: Response;
  try {
    const probeUrl =
      provider.provider === 'cloudflare'
        ? `${provider.baseUrl.replace(/\/ai\/v1$/, '/ai')}/models/search?search=${encodeURIComponent(provider.model)}&per_page=5`
        : `${provider.baseUrl}/models`;
    response = await fetch(probeUrl, {
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

  if (provider.provider === 'cloudflare') return { ok: true };

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
