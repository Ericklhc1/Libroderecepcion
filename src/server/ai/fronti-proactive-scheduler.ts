import 'server-only';

import { after } from 'next/server';

let lastScheduledAt = 0;
const SCHEDULE_THROTTLE_MS = 60_000;

/**
 * Dispara Fronti proactivo fuera del camino crítico de la petición.
 *
 * La ejecución inmediata es best-effort. La garantía de continuidad la da el
 * cron de Vercel, por lo que un entorno sin request scope nunca puede romper
 * la operación principal.
 */
export function scheduleFrontiProactiveSweep(reason: string): void {
  const now = Date.now();
  if (now - lastScheduledAt < SCHEDULE_THROTTLE_MS) return;
  lastScheduledAt = now;

  try {
    after(async () => {
      try {
        const { runFrontiProactiveSweep } = await import('./fronti-proactive');
        await runFrontiProactiveSweep({ trigger: `event:${reason}` });
      } catch (error) {
        console.error('[fronti-proactivo] ejecución diferida falló', error);
      }
    });
  } catch (error) {
    lastScheduledAt = 0;
    console.warn(
      '[fronti-proactivo] no se pudo programar la ejecución inmediata; el cron actuará como respaldo',
      error,
    );
  }
}
