export type FrontiProviderNameLike = 'groq' | 'vllm' | 'openai';

export type FrontiToolDefinitionLike = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

/**
 * Adaptaciones de transporte para schemas de herramientas.
 *
 * El contrato semántico de las tools vive en el Tool Registry. Esta capa sólo
 * compensa diferencias del proveedor sin cambiar la ejecución real.
 */
export function normalizeFrontiToolsForProvider<
  T extends FrontiToolDefinitionLike,
>(
  provider: FrontiProviderNameLike,
  tools?: T[],
): T[] | undefined {
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
     * properties: {} sea válido. Añadimos un marcador técnico obligatorio que
     * el ejecutor ignora.
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
    } as T;
  });
}
