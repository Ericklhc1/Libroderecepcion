const DEFAULT_MAX_TOOL_RESULT_CHARS = 3_600;
const DEFAULT_MAX_STRING_CHARS = 420;
const DEFAULT_MAX_ARRAY_ITEMS = 10;
const DEFAULT_MAX_OBJECT_KEYS = 24;
const DEFAULT_MAX_DEPTH = 5;

type BudgetOptions = {
  maxChars?: number;
  maxStringChars?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxDepth?: number;
};

function compactValue(
  value: unknown,
  options: Required<BudgetOptions>,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length <= options.maxStringChars) return value;
    return `${value.slice(0, options.maxStringChars)}…`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Date) return value.toISOString();

  if (depth >= options.maxDepth) {
    if (Array.isArray(value)) return `[lista omitida: ${value.length} elementos]`;
    if (typeof value === 'object') return '[detalle omitido por presupuesto de contexto]';
    return String(value);
  }

  if (Array.isArray(value)) {
    const limited = value
      .slice(0, options.maxArrayItems)
      .map((item) => compactValue(item, options, depth + 1));

    if (value.length > options.maxArrayItems) {
      limited.push({
        _frontiTruncated: true,
        omittedItems: value.length - options.maxArrayItems,
      });
    }
    return limited;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries.slice(0, options.maxObjectKeys)) {
      out[key] = compactValue(nested, options, depth + 1);
    }
    if (entries.length > options.maxObjectKeys) {
      out._frontiTruncatedKeys = entries.length - options.maxObjectKeys;
    }
    return out;
  }

  return String(value);
}

function stringifyEnvelope(result: unknown, compacted: boolean): string {
  return JSON.stringify({
    ok: true,
    compacted,
    result,
  });
}

/**
 * Mantiene cada resultado de herramienta dentro de un presupuesto pequeño y
 * predecible para no agotar el TPM del proveedor entre pasos del agente.
 *
 * Nunca corta JSON en bruto: reduce arrays, textos y profundidad y vuelve a
 * serializar una estructura válida.
 */
export function serializeToolResultForModel(
  result: unknown,
  options: BudgetOptions = {},
): string {
  const resolved: Required<BudgetOptions> = {
    maxChars: options.maxChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS,
    maxStringChars: options.maxStringChars ?? DEFAULT_MAX_STRING_CHARS,
    maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxObjectKeys: options.maxObjectKeys ?? DEFAULT_MAX_OBJECT_KEYS,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };

  const direct = stringifyEnvelope(result, false);
  if (direct.length <= resolved.maxChars) return direct;

  let compacted = compactValue(result, resolved);
  let serialized = stringifyEnvelope(compacted, true);
  if (serialized.length <= resolved.maxChars) return serialized;

  const aggressive: Required<BudgetOptions> = {
    maxChars: resolved.maxChars,
    maxStringChars: Math.min(resolved.maxStringChars, 220),
    maxArrayItems: Math.min(resolved.maxArrayItems, 5),
    maxObjectKeys: Math.min(resolved.maxObjectKeys, 14),
    maxDepth: Math.min(resolved.maxDepth, 4),
  };
  compacted = compactValue(result, aggressive);
  serialized = stringifyEnvelope(compacted, true);
  if (serialized.length <= aggressive.maxChars) return serialized;

  return JSON.stringify({
    ok: true,
    compacted: true,
    result: compactValue(result, {
      ...aggressive,
      maxStringChars: 140,
      maxArrayItems: 3,
      maxObjectKeys: 10,
      maxDepth: 3,
    }),
    note:
      'Resultado reducido por presupuesto de contexto. Si falta un detalle necesario, consulta la herramienta específica del área.',
  });
}

export function budgetConversationMessages<T extends { content: string }>(
  messages: T[],
  options: { maxMessages: number; maxChars: number },
): T[] {
  const selected: T[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;

    const remaining = options.maxChars - used;
    if (remaining <= 0 && selected.length > 0) break;

    const content =
      message.content.length <= remaining || selected.length === 0
        ? message.content.slice(0, Math.max(400, remaining))
        : message.content.slice(0, Math.max(0, remaining));

    selected.push({ ...message, content });
    used += content.length;

    if (selected.length >= options.maxMessages) break;
  }

  return selected.reverse();
}
