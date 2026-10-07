/** Operational transport errors shared by both existing Fronti surfaces. */
export function frontiClientError(error: unknown, fallback = 'Fronti no pudo procesar la solicitud.'): string {
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
    return 'Fronti no respondió a tiempo. Revisa la conversación y el módulo antes de repetir un cambio.';
  }
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return 'No se pudo recibir una respuesta de Fronti. Revisa la conexión e inténtalo de nuevo; si confirmaste un cambio, verifica primero su resultado en el módulo.';
  }
  return error instanceof Error ? error.message : fallback;
}
