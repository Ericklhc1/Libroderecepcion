/**
 * Sustituto de `next/headers`. Fuera de una petición HTTP no hay cookies ni
 * encabezados: los servicios ya toleran esta ausencia (ver `requestMeta`).
 */
export async function cookies() {
  throw new Error('cookies() no está disponible fuera de una petición');
}

export async function headers() {
  return {
    get: (_name: string): string | null => null,
  };
}
