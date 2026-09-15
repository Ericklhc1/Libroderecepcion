import { z } from 'zod';

/**
 * Validación de variables de entorno. Falla temprano y con mensaje claro si
 * falta configuración crítica. Nunca se exponen al cliente.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET debe tener al menos 32 caracteres'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(168).default(12),
  SEED_DEMO_PASSWORD: z.string().min(8).default('Demo2024!'),
  HOTEL_TIMEZONE: z.string().default('America/Santiago'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

let cached: z.infer<typeof schema> | null = null;

export function env(): z.infer<typeof schema> {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Configuración de entorno inválida -> ${detail}`);
  }
  cached = parsed.data;
  return cached;
}
