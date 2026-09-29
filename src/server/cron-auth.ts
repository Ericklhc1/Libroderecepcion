import 'server-only';

/**
 * Vercel Cron envía un User-Agent propio y, cuando CRON_SECRET está
 * configurado, añade Authorization: Bearer <secret>.
 *
 * La clave es opcional para no romper despliegues existentes; si está
 * presente pasa a ser obligatoria y reemplaza la confianza en User-Agent.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    return request.headers.get('authorization') === `Bearer ${secret}`;
  }
  return (request.headers.get('user-agent') ?? '').startsWith('vercel-cron/');
}
