import 'server-only';

import { env } from '@/lib/env';
import {
  ASSISTANT_TIMEOUT_MS,
  classifyAssistantFailure,
  type AssistantFailure,
} from '@/domain/assistant-status';

export type FrontiProviderName = 'groq' | 'vllm' | 'openai';

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

export type FrontiProviderConfig = {
  provider: FrontiProviderName;
  baseUrl: string;
  apiKey: string | null;
  model: string;
};

export class FrontiProviderError extends Error {
  readonly failure: AssistantFailure;

  constructor(failure: AssistantFailure, cause?: Error) {
    super(failure);
    this.name = 'FrontiProviderError';
    this.failure = failure;
    if (cause) this.cause = cause;
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveFrontiProvider(input: {
  provider: FrontiProviderName;
  model: string;
}): FrontiProviderConfig {
  const runtime = env();

  if (input.provider === 'vllm') {
    return {
      provider: 'vllm',
      baseUrl: trimSlash(runtime.FRONTI_BASE_URL ?? ''),
      apiKey: runtime.FRONTI_API_KEY ?? null,
      model: input.model,
    };
  }

  if (input.provider === 'openai') {
    return {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: runtime.OPENAI_API_KEY ?? null,
      model: runtime.OPENAI_MODEL?.trim() || input.model,
    };
  }

  return {
    provider: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: runtime.GROQ_API_KEY ?? null,
    model: input.model,
  };
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
}): Promise<{
  text: string;
  toolCalls: FrontiToolCall[];
  assistantMessage: FrontiChatMessage;
}> {
  if (!providerIsConfigured(args.provider)) {
    throw new FrontiProviderError('SIN_CLAVE');
  }

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
        tools: args.tools?.length ? args.tools : undefined,
        tool_choice: args.tools?.length ? 'auto' : undefined,
        parallel_tool_calls: false,
        temperature: 0.1,
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
    throw new FrontiProviderError(failure.failure);
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
