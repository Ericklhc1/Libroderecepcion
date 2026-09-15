/**
 * Resolución de las URL de base de datos.
 *
 * La aplicación necesita dos conexiones a la misma base: la agrupada, que usa
 * mientras opera, y la directa, que exigen las migraciones. Según cómo se haya
 * conectado la base, el proveedor las publica con nombres distintos:
 *
 * - A mano: `DATABASE_URL` y `DIRECT_DATABASE_URL`.
 * - Integración de Neon en Vercel: `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
 * - Integración de Postgres en Vercel: `POSTGRES_PRISMA_URL` y
 *   `POSTGRES_URL_NON_POOLING`.
 *
 * Aquí se acepta cualquiera de los tres, de modo que conectar la base desde el
 * panel del proveedor deje el sistema listo sin copiar cadenas a mano. Si sólo
 * existe la agrupada, se usa también como directa: es la misma base, y así una
 * configuración incompleta no rompe el despliegue.
 */

const POOLED_NAMES = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'];

const DIRECT_NAMES = [
  'DIRECT_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL_DIRECT',
];

/** Un mapa de variables de entorno: `process.env` encaja, y también un objeto de prueba. */
export type EnvLike = Record<string, string | undefined>;

function firstDefined(names: string[], env: EnvLike): string | null {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export type ResolvedDatabaseUrls = {
  pooled: string | null;
  direct: string | null;
  /** De qué variable salió cada una, para poder explicarlo en un error. */
  from: { pooled: string | null; direct: string | null };
};

export function resolveDatabaseUrls(
  env: EnvLike = process.env,
): ResolvedDatabaseUrls {
  const pooledName = POOLED_NAMES.find((name) => env[name]?.trim()) ?? null;
  const directName = DIRECT_NAMES.find((name) => env[name]?.trim()) ?? null;
  const pooled = firstDefined(POOLED_NAMES, env);
  const direct = firstDefined(DIRECT_NAMES, env) ?? pooled;

  return {
    pooled,
    direct,
    from: { pooled: pooledName, direct: directName ?? pooledName },
  };
}

/**
 * Deja `DATABASE_URL` y `DIRECT_DATABASE_URL` definidas, que son los nombres
 * que lee el esquema de Prisma. Se llama antes de crear el cliente y antes de
 * migrar, y no toca lo que ya estuviera puesto a mano.
 */
export function normalizeDatabaseEnv(env: EnvLike = process.env): {
  ok: boolean;
  detail: string;
} {
  const resolved = resolveDatabaseUrls(env);
  if (!resolved.pooled) {
    return {
      ok: false,
      detail:
        'Falta la URL de la base de datos. Define DATABASE_URL, o conecta la base ' +
        'desde el panel del proveedor para que la publique por su cuenta.',
    };
  }

  env.DATABASE_URL = resolved.pooled;
  if (resolved.direct) env.DIRECT_DATABASE_URL = resolved.direct;

  const sameSource = resolved.from.direct === resolved.from.pooled;
  return {
    ok: true,
    detail: sameSource
      ? `Conexión tomada de ${resolved.from.pooled} (la misma para operar y para migrar).`
      : `Conexión de ${resolved.from.pooled}; migraciones por ${resolved.from.direct}.`,
  };
}
