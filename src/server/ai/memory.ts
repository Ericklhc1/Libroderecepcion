import 'server-only';

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { getMyOpenShift } from '@/server/services/shifts';
import type { AssistantMessage } from './reception-assistant';
import { getFrontiConfig } from './fronti-config';
import {
  chatWithFrontiProvider,
  resolveFrontiAuxiliaryProviderRuntime,
} from './fronti-provider';

const DAY_MS = 24 * 60 * 60 * 1000;
export const AI_MEMORY_RETENTION_DAYS = 30;
const UI_HISTORY_LIMIT = 60;
const MEMORY_CANDIDATE_LIMIT = 80;

type ConversationRow = {
  id: string;
  user_id: string;
  session_id: string;
  shift_id: string | null;
  created_at: Date;
  last_active_at: Date;
  expires_at: Date;
};

type MessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
};

type MemoryRow = {
  id: string;
  scope: 'PERSONAL' | 'TURNO';
  summary: string;
  entity_type: string | null;
  entity_id: string | null;
  importance: number;
  updated_at: Date;
  expires_at: Date;
};

export type AssistantBootstrap = {
  conversationId: string;
  retentionDays: number;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
  }>;
};

export type PreparedAssistantContext = {
  conversationId: string;
  messages: AssistantMessage[];
  memoryContext: string | null;
  persist: boolean;
  cleanMessage: string;
};

const STOP_WORDS = new Set([
  'para',
  'como',
  'esta',
  'este',
  'esto',
  'esa',
  'ese',
  'que',
  'por',
  'con',
  'del',
  'las',
  'los',
  'una',
  'uno',
  'unos',
  'unas',
  'sobre',
  'desde',
  'hasta',
  'pero',
  'porque',
  'donde',
  'cuando',
  'cual',
  'cuales',
  'quiero',
  'puedes',
  'favor',
  'habitacion',
]);

function expiresIn(ms: number): Date {
  return new Date(Date.now() + ms);
}

async function currentShiftId(userId: string): Promise<string | null> {
  const shift = await getMyOpenShift(userId);
  return shift?.id ?? null;
}

export function hasNoStoreDirective(message: string): boolean {
  const normalized = message.trim().toLocaleLowerCase('es-CL');
  return (
    normalized.startsWith('no guardes esto') ||
    normalized.startsWith('no recuerdes esto') ||
    normalized.startsWith('no almacenes esto') ||
    normalized.startsWith('sin memoria:') ||
    normalized.startsWith('no guardar:')
  );
}

export function isForgetConversationCommand(message: string): boolean {
  const normalized = message
    .trim()
    .toLocaleLowerCase('es-CL')
    .replace(/[.!¡¿?]+$/g, '');
  return [
    'olvida esta conversación',
    'olvida esta conversacion',
    'borra esta conversación',
    'borra esta conversacion',
    'elimina esta conversación',
    'elimina esta conversacion',
  ].includes(normalized);
}

function stripNoStoreDirective(message: string): string {
  if (!hasNoStoreDirective(message)) return message.trim();
  const colon = message.indexOf(':');
  if (colon >= 0 && message.slice(colon + 1).trim()) return message.slice(colon + 1).trim();
  return message
    .replace(/^\s*(?:no guardes esto|no recuerdes esto|no almacenes esto)\s*[:,.-]?\s*/i, '')
    .trim();
}

function containsSecretLikeData(message: string): boolean {
  const lower = message.toLocaleLowerCase('es-CL');
  if (/\b(?:cvv|cvc|contraseña|password|api[_ -]?key|token de acceso|clave secreta)\b/i.test(lower)) {
    return true;
  }
  const digits = message.replace(/[^0-9]/g, '');
  return digits.length >= 13 && digits.length <= 19;
}

function shouldPersist(message: string): boolean {
  return !hasNoStoreDirective(message) && !containsSecretLikeData(message);
}


export function shouldAttemptMemoryExtraction(message: string): boolean {
  const normalized = message.trim().toLocaleLowerCase('es-CL');
  if (!shouldPersist(message) || normalized.length < 8) return false;

  return [
    /\brecuerda\b/,
    /\brecuerdame\b/,
    /\bacu[eé]rdate\b/,
    /\bprefiero\b/,
    /\bpreferencia\b/,
    /\bde ahora en adelante\b/,
    /\bsiempre que\b/,
    /\bquiero que\b/,
    /\bno quiero que\b/,
    /\bregla\b/,
    /\bprocedimiento\b/,
    /\bten presente\b/,
    /\bimportante para m[ií]\b/,
  ].some((pattern) => pattern.test(normalized));
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL');
}

function keywords(value: string): Set<string> {
  const tokens = normalizeToken(value).match(/[a-z0-9]+/g) ?? [];
  return new Set(
    tokens.filter((token) => (token.length >= 4 || /^\d{3,}$/.test(token)) && !STOP_WORDS.has(token)),
  );
}

function memoryScore(memory: MemoryRow, queryTokens: Set<string>, retentionDays: number): number {
  const memoryTokens = keywords(`${memory.summary} ${memory.entity_type ?? ''} ${memory.entity_id ?? ''}`);
  let overlap = 0;
  for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
  const ageDays = Math.max(0, (Date.now() - memory.updated_at.getTime()) / DAY_MS);
  const recency = Math.max(0, retentionDays - ageDays) / Math.max(1, retentionDays / 5);
  const entityBonus = memory.entity_id && queryTokens.has(normalizeToken(memory.entity_id)) ? 12 : 0;
  return memory.importance * 5 + overlap * 7 + recency + entityBonus;
}

async function findActiveConversation(user: CurrentUser): Promise<ConversationRow | null> {
  const rows = await prisma.$queryRaw<ConversationRow[]>`
    SELECT id, user_id, session_id, shift_id, created_at, last_active_at, expires_at
      FROM ai_conversation
     WHERE user_id = ${user.id}
       AND session_id = ${user.sessionId}
       AND closed_at IS NULL
       AND expires_at > NOW()
     ORDER BY last_active_at DESC
     LIMIT 1
  `;
  return rows[0] ?? null;
}

async function createConversation(user: CurrentUser): Promise<ConversationRow> {
  const config = await getFrontiConfig();
  const id = randomUUID();
  const shiftId = await currentShiftId(user.id);
  const expiresAt = expiresIn(config.memoryRetentionDays * DAY_MS);

  try {
    await prisma.$executeRaw`
      INSERT INTO ai_conversation
        (id, user_id, session_id, shift_id, expires_at)
      VALUES
        (${id}, ${user.id}, ${user.sessionId}, ${shiftId}, ${expiresAt})
    `;
  } catch {
    const raced = await findActiveConversation(user);
    if (raced) return raced;
    throw new Error('No se pudo iniciar la conversación del asistente.');
  }

  const created = await findActiveConversation(user);
  if (!created) throw new Error('No se pudo recuperar la conversación recién creada.');
  return created;
}

async function getOrCreateConversation(user: CurrentUser): Promise<ConversationRow> {
  return (await findActiveConversation(user)) ?? createConversation(user);
}

async function recentMessages(conversationId: string, limit: number): Promise<MessageRow[]> {
  return prisma.$queryRaw<MessageRow[]>`
    SELECT id, role, content, created_at
      FROM (
        SELECT id, role, content, created_at
          FROM ai_message
         WHERE conversation_id = ${conversationId}
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT ${limit}
      ) recent
     ORDER BY created_at ASC
  `;
}

async function storeMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<string> {
  const config = await getFrontiConfig();
  const id = randomUUID();
  const expiresAt = expiresIn(config.memoryRetentionDays * DAY_MS);
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO ai_message (id, conversation_id, role, content, expires_at)
      VALUES (${id}, ${conversationId}, ${role}, ${content}, ${expiresAt})
    `,
    prisma.$executeRaw`
      UPDATE ai_conversation
         SET updated_at = NOW(),
             last_active_at = NOW(),
             expires_at = ${expiresAt}
       WHERE id = ${conversationId}
    `,
  ]);
  return id;
}

async function relevantMemories(user: CurrentUser, query: string): Promise<MemoryRow[]> {
  const config = await getFrontiConfig();
  const shiftId = await currentShiftId(user.id);
  const rows = shiftId
    ? await prisma.$queryRaw<MemoryRow[]>`
        SELECT id, scope, summary, entity_type, entity_id, importance, updated_at, expires_at
          FROM ai_memory
         WHERE user_id = ${user.id}
           AND expires_at > NOW()
           AND (scope = 'PERSONAL' OR (scope = 'TURNO' AND shift_id = ${shiftId}))
         ORDER BY updated_at DESC
         LIMIT ${MEMORY_CANDIDATE_LIMIT}
      `
    : await prisma.$queryRaw<MemoryRow[]>`
        SELECT id, scope, summary, entity_type, entity_id, importance, updated_at, expires_at
          FROM ai_memory
         WHERE user_id = ${user.id}
           AND expires_at > NOW()
           AND scope = 'PERSONAL'
         ORDER BY updated_at DESC
         LIMIT ${MEMORY_CANDIDATE_LIMIT}
      `;

  const queryTokens = keywords(query);
  return rows
    .map((memory) => ({
      memory,
      score: memoryScore(memory, queryTokens, config.memoryRetentionDays),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.memoryContextLimit)
    .map(({ memory }) => memory);
}

function formatMemoryContext(memories: MemoryRow[]): string | null {
  if (!memories.length) return null;
  return memories
    .map((memory) => {
      const entity = memory.entity_id
        ? ` · ${memory.entity_type ?? 'referencia'} ${memory.entity_id}`
        : '';
      return `- [${memory.scope}] ${memory.summary}${entity}`;
    })
    .join('\n');
}

async function upsertMemory(
  user: CurrentUser,
  conversationId: string,
  memory: {
    scope: 'PERSONAL' | 'TURNO';
    summary: string;
    entityType: string | null;
    entityId: string | null;
    importance: number;
  },
) {
  const config = await getFrontiConfig();
  const summary = memory.summary.trim().slice(0, 600);
  if (!summary || containsSecretLikeData(summary)) return;

  const shiftId = memory.scope === 'TURNO' ? await currentShiftId(user.id) : null;
  const scope = memory.scope === 'TURNO' && !shiftId ? 'PERSONAL' : memory.scope;
  const effectiveShiftId = scope === 'TURNO' ? shiftId : null;
  const ttl =
    scope === 'TURNO'
      ? config.shiftMemoryHours * 60 * 60 * 1000
      : config.memoryRetentionDays * DAY_MS;
  const expiresAt = expiresIn(ttl);
  const importance = Math.min(5, Math.max(1, Math.round(memory.importance || 3)));
  const entityType = memory.entityType?.trim().slice(0, 80) || null;
  const entityId = memory.entityId?.trim().slice(0, 120) || null;

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
      FROM ai_memory
     WHERE user_id = ${user.id}
       AND scope = ${scope}
       AND summary = ${summary}
       AND expires_at > NOW()
     ORDER BY updated_at DESC
     LIMIT 1
  `;

  if (existing[0]) {
    await prisma.$executeRaw`
      UPDATE ai_memory
         SET updated_at = NOW(),
             expires_at = ${expiresAt},
             importance = ${importance},
             entity_type = ${entityType},
             entity_id = ${entityId},
             shift_id = ${effectiveShiftId}
       WHERE id = ${existing[0].id}
    `;
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO ai_memory
      (id, user_id, conversation_id, shift_id, scope, summary, entity_type, entity_id, importance, expires_at)
    VALUES
      (${randomUUID()}, ${user.id}, ${conversationId}, ${effectiveShiftId}, ${scope}, ${summary}, ${entityType}, ${entityId}, ${importance}, ${expiresAt})
  `;
}

export async function extractAndStoreMemories(
  user: CurrentUser,
  conversationId: string,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  if (!shouldAttemptMemoryExtraction(userMessage)) return;

  try {
    const config = await getFrontiConfig();
    const provider = await resolveFrontiAuxiliaryProviderRuntime();
    if (!provider) return;

    const response = await chatWithFrontiProvider({
      provider,
      toolChoice: 'required',
      messages: [
        {
          role: 'system',
          content:
            'Extrae sólo contexto conversacional que pueda ser útil después en la operación de recepción. ' +
            'No guardes contraseñas, claves, tokens, números completos de tarjetas, CVV/CVC ni secretos. ' +
            'No dupliques como memoria datos que deberían consultarse como fuente de verdad en tareas, multas, garantías, habitaciones o reservas. ' +
            `PERSONAL sirve para contexto útil al mismo usuario durante hasta ${config.memoryRetentionDays} días. TURNO sirve sólo para contexto útil al turno actual. ` +
            'Si no hay nada que merezca recordarse, devuelve una lista vacía. Resume sin adornos y minimiza datos personales. ' +
            'La importancia debe expresarse idealmente en escala 1 a 5; el Libro normaliza cualquier desviación.',
        },
        {
          role: 'user',
          content:
            `Mensaje del usuario:\n${userMessage}\n\nRespuesta del asistente:\n${assistantReply}`,
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'extraer_memorias',
            description:
              'Devuelve hasta tres memorias contextuales útiles o una lista vacía.',
            strict: true,
            parameters: {
              type: 'object',
              properties: {
                memories: {
                  type: 'array',
                  maxItems: 3,
                  items: {
                    type: 'object',
                    properties: {
                      scope: { type: 'string', enum: ['PERSONAL', 'TURNO'] },
                      summary: { type: 'string', minLength: 5, maxLength: 600 },
                      entityType: { type: ['string', 'null'] },
                      entityId: { type: ['string', 'null'] },
                      importance: {
                        type: 'integer',
                        description: 'Importancia sugerida. Usa preferentemente 1 a 5; el Libro normaliza el valor.',
                      },
                    },
                    required: [
                      'scope',
                      'summary',
                      'entityType',
                      'entityId',
                      'importance',
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ['memories'],
              additionalProperties: false,
            },
          },
        },
      ],
    });

    const call = response.toolCalls.find(
      (item) =>
        item.function.name === 'extraer_memorias' &&
        typeof item.function.arguments === 'string',
    );
    if (!call?.function.arguments) return;

    const parsed = JSON.parse(call.function.arguments) as {
      memories?: Array<{
        scope?: 'PERSONAL' | 'TURNO';
        summary?: string;
        entityType?: string | null;
        entityId?: string | null;
        importance?: number;
      }>;
    };

    for (const memory of parsed.memories ?? []) {
      if (!memory.summary || !memory.scope) continue;
      await upsertMemory(user, conversationId, {
        scope: memory.scope,
        summary: memory.summary,
        entityType: memory.entityType ?? null,
        entityId: memory.entityId ?? null,
        importance: memory.importance ?? 3,
      });
    }
  } catch (error) {
    console.error('[asistente-memoria-extraccion]', error);
  }
}

export async function cleanupExpiredAiMemory(): Promise<{
  messages: number;
  memories: number;
  conversations: number;
}> {
  const [messages, memories, conversations] = await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM ai_message WHERE expires_at <= NOW()`,
    prisma.$executeRaw`DELETE FROM ai_memory WHERE expires_at <= NOW()`,
    prisma.$executeRaw`DELETE FROM ai_conversation WHERE expires_at <= NOW()`,
  ]);
  return { messages, memories, conversations };
}

export async function getAssistantBootstrap(user: CurrentUser): Promise<AssistantBootstrap> {
  await cleanupExpiredAiMemory();
  const config = await getFrontiConfig();
  const conversation = await getOrCreateConversation(user);
  const messages = await recentMessages(conversation.id, UI_HISTORY_LIMIT);
  return {
    conversationId: conversation.id,
    retentionDays: config.memoryRetentionDays,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at.toISOString(),
    })),
  };
}

export async function prepareAssistantContext(
  user: CurrentUser,
  rawMessage: string,
): Promise<PreparedAssistantContext> {
  await cleanupExpiredAiMemory();
  const config = await getFrontiConfig();
  const conversation = await getOrCreateConversation(user);
  const cleanMessage = stripNoStoreDirective(rawMessage) || rawMessage.trim();
  const persist = shouldPersist(rawMessage);
  const [history, memories] = await Promise.all([
    recentMessages(conversation.id, config.modelHistoryLimit),
    relevantMemories(user, cleanMessage),
  ]);

  const messages: AssistantMessage[] = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const memoryContext = formatMemoryContext(memories);
  if (memoryContext) {
    messages.unshift({
      role: 'assistant',
      content:
        'Contexto interno recuperado de memoria. Puede estar desactualizado: úsalo sólo para entender referencias del usuario y verifica el estado actual con las herramientas del Libro antes de afirmar hechos:\n' +
        memoryContext,
    });
  }

  if (persist) await storeMessage(conversation.id, 'user', cleanMessage);
  messages.push({ role: 'user', content: cleanMessage });

  return {
    conversationId: conversation.id,
    messages: messages.slice(-(config.modelHistoryLimit + 2)),
    memoryContext,
    persist,
    cleanMessage,
  };
}

export async function persistAssistantReply(
  conversationId: string,
  reply: string,
  persist: boolean,
): Promise<void> {
  if (!persist || !reply.trim()) return;
  await storeMessage(conversationId, 'assistant', reply.trim());
}

export async function persistAssistantEvent(user: CurrentUser, reply: string): Promise<void> {
  if (!reply.trim()) return;
  const conversation = await getOrCreateConversation(user);
  await storeMessage(conversation.id, 'assistant', reply.trim());
}

export async function startNewAssistantConversation(user: CurrentUser): Promise<AssistantBootstrap> {
  await prisma.$executeRaw`
    UPDATE ai_conversation
       SET closed_at = NOW(), updated_at = NOW()
     WHERE user_id = ${user.id}
       AND session_id = ${user.sessionId}
       AND closed_at IS NULL
  `;
  await createConversation(user);
  return getAssistantBootstrap(user);
}

export async function forgetCurrentAssistantConversation(user: CurrentUser): Promise<AssistantBootstrap> {
  await prisma.$executeRaw`
    DELETE FROM ai_conversation
     WHERE user_id = ${user.id}
       AND session_id = ${user.sessionId}
       AND closed_at IS NULL
  `;
  await createConversation(user);
  return getAssistantBootstrap(user);
}
