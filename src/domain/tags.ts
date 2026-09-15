const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

/**
 * Normaliza etiquetas: minúsculas, sin espacios sobrantes, sin duplicados y
 * acotadas en cantidad y largo.
 *
 * Única fuente de verdad: la usan tanto la validación del formulario como los
 * servicios, de modo que un registro nunca queda con etiquetas inconsistentes
 * aunque se cree desde otro punto de entrada.
 */
export function normalizeTags(input: string | string[] | undefined | null): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : input.split(',');
  return Array.from(
    new Set(
      raw
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_LENGTH),
    ),
  ).slice(0, MAX_TAGS);
}
