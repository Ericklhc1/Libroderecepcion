import 'server-only';
import { randomUUID } from 'node:crypto';
import { AuditAction } from '@prisma/client';
import { z } from 'zod';
import { AppError, ValidationError } from '@/server/errors';
import { normalizeTags } from '@/domain/tags';
import { recordAudit } from '@/server/audit';
import { getSettingBool } from '@/server/services/settings';
import {
  operationalFailureType,
  recordOperationalEvent,
} from '@/server/observability/operational';

export const ACTION_TIMEOUT_THRESHOLD_MS = 20_000;

/**
 * Credenciales que sólo se pueden leer una vez.
 *
 * Viajan como dato, no dentro del texto del mensaje. Una clave metida en una
 * frase se pierde en cuanto la interfaz decide cerrar el formulario, y esa
 * clave no se puede recuperar: hay que volver a generarla.
 */
export type RevealedCredentials = {
  name: string;
  username: string;
  password: string;
  /** A dónde se envió, si el correo está configurado. */
  recipient: string;
  sent: boolean;
  /** Por qué no se pudo enviar, cuando corresponda. */
  reason?: string | null;
};

export type ActionState =
  | {
      ok: true;
      message: string;
      id?: string;
      /**
       * Su presencia obliga a la interfaz a mantener el formulario abierto:
       * quien lo ve tiene que poder copiarlas antes de cerrar.
       */
      credentials?: RevealedCredentials;
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Convierte FormData en objeto plano; agrupa claves repetidas en arreglos. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue;
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (key in out) {
      const existing = out[key];
      out[key] = Array.isArray(existing)
        ? [...existing, trimmed]
        : [existing, trimmed];
    } else {
      out[key] = trimmed;
    }
  }
  return out;
}

/** Valida en servidor. Lanza ValidationError con errores por campo. */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flat = result.error.flatten();
    throw new ValidationError(flat.fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

/**
 * Envuelve el cuerpo de una acción de servidor y traduce cualquier error de
 * dominio a un estado apto para la interfaz. Los errores inesperados se
 * registran en servidor y se muestran de forma genérica.
 */
export async function runAction(
  fn: () => Promise<ActionState>,
): Promise<ActionState> {
  const startedAt = new Date();

  try {
    return await fn();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flat = error.flatten();
      return {
        ok: false,
        error: error.issues[0]?.message ?? 'Revisa los campos indicados.',
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      };
    }
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof AppError) {
      return { ok: false, error: error.message };
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      console.warn('[acción] conflicto de unicidad evitado');
      return {
        ok: false,
        error: 'Ya existe un registro con esos datos. Revisa los valores e intenta nuevamente.',
      };
    }
    // Permite que redirect()/notFound() de Next.js sigan su curso.
    if (
      error &&
      typeof error === 'object' &&
      'digest' in error &&
      typeof (error as { digest?: unknown }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_')
    ) {
      throw error;
    }
    const failedAt = new Date();
    recordOperationalEvent({
      eventType: 'ACTION_FAILED',
      startedAt,
      completedAt: failedAt,
      durationMs: failedAt.getTime() - startedAt.getTime(),
      status: 'FAILED',
      source: 'SERVER_ACTION',
      entityType: 'ServerAction',
      metadata: { failureType: operationalFailureType(error) },
    });

    console.error('[acción] error inesperado', error);
    try {
      if (await getSettingBool('diagnostics.runtimeCaptureEnabled', true)) {
        const runtimeError = error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack?.slice(0, 8000) ?? null,
            }
          : {
              name: 'UnknownError',
              message: String(error),
              stack: null,
            };
        await recordAudit({
          entity: 'RuntimeError',
          entityId: randomUUID(),
          action: AuditAction.CREAR,
          summary: runtimeError.message.slice(0, 2000) || 'Error inesperado en acción de servidor',
          after: {
            source: 'server-action',
            name: runtimeError.name,
            stack: runtimeError.stack,
          },
        });
      }
    } catch (captureError) {
      console.error('[diagnóstico] no se pudo registrar el error de ejecución', captureError);
    }
    return {
      ok: false,
      error: 'Ocurrió un error inesperado. El incidente quedó registrado para diagnóstico.',
    };
  } finally {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    if (durationMs >= ACTION_TIMEOUT_THRESHOLD_MS) {
      recordOperationalEvent({
        eventType: 'ACTION_TIMEOUT',
        startedAt,
        completedAt,
        durationMs,
        status: 'FAILED',
        source: 'SERVER_ACTION',
        entityType: 'ServerAction',
        metadata: { timeoutThresholdMs: ACTION_TIMEOUT_THRESHOLD_MS },
      });
    }
  }
}

/** Esquemas reutilizables para formularios. */
export const zOptionalString = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const zRequiredString = (max = 200, field = 'Este campo') =>
  z
    .string({ required_error: `${field} es obligatorio` })
    .trim()
    .min(3, `${field} debe tener al menos 3 caracteres`)
    .max(max, `${field} supera el largo permitido`);

export const zCuid = z.string().min(1);

export const zOptionalCuid = z
  .string()
  .optional()
  .transform((v) => (v === '' || v === undefined || v === 'none' ? null : v));

export const zOptionalDate = z
  .string()
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), 'Fecha inválida')
  .transform((v) => (v === null ? null : new Date(v)));

export const zTags = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => normalizeTags(v));

export const zCheckbox = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true' || v === '1');
