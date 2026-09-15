import { z } from 'zod';
import { normalizeDatabaseEnv } from './database-url';

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

  // Correo saliente. Opcional: si falta, el sistema muestra la clave en
  // pantalla en lugar de enviarla, y lo dice.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  /// Casilla que recibe las credenciales de los usuarios nuevos.
  CREDENTIALS_MAIL_TO: z.string().email().default('recepcion@hoteleshw.com'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

let cached: z.infer<typeof schema> | null = null;

export function env(): z.infer<typeof schema> {
  if (cached) return cached;
  normalizeDatabaseEnv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `Configuración de entorno inválida -> ${detail}. ` +
        'Revisa las variables del proyecto en el panel de despliegue.',
    );
  }
  cached = parsed.data;
  return cached;
}
