import 'server-only';
import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requestMeta } from '@/server/auth/session';
import type { CurrentUser } from '@/server/auth/current-user';

type Client = PrismaClient | Prisma.TransactionClient;

export type AuditInput = {
  entity: string;
  entityId: string;
  action: AuditAction;
  summary: string;
  user?: Pick<CurrentUser, 'id' | 'sessionId'> | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  isDemo?: boolean;
};

/** Campos que nunca deben quedar registrados en la auditoría. */
const REDACTED = new Set(['passwordHash', 'password', 'token', 'passwordConfirm']);

function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const walk = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        out[k] = REDACTED.has(k) ? '[redactado]' : walk(v);
      }
      return out;
    }
    if (typeof input === 'bigint') return input.toString();
    return input;
  };
  return walk(value) as Prisma.InputJsonValue;
}

/**
 * Registra un evento en la bitácora de auditoría.
 *
 * Nunca interrumpe la operación principal: si el registro de auditoría falla,
 * se reporta por consola pero la acción del usuario no se revierte (salvo que
 * se invoque dentro de una transacción, donde sí participa del rollback).
 */
export async function recordAudit(
  input: AuditInput,
  client: Client = prisma,
): Promise<void> {
  const meta = await requestMeta();
  try {
    await client.auditLog.create({
      data: {
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        summary: input.summary,
        userId: input.user?.id ?? null,
        sessionId: input.user?.sessionId ?? null,
        before: sanitize(input.before),
        after: sanitize(input.after),
        reason: input.reason ?? null,
        ip: meta.ip,
        userAgent: meta.userAgent,
        isDemo: input.isDemo ?? false,
      },
    });
  } catch (error) {
    console.error('[auditoría] no se pudo registrar el evento', error);
  }
}

/** Calcula el diff de los campos vigilados entre dos versiones de un registro. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: Array<keyof T>,
): { before: Partial<T>; after: Partial<T>; changed: Array<keyof T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const changed: Array<keyof T> = [];
  for (const field of fields) {
    if (!(field in after)) continue;
    const prev = before[field];
    const next = after[field];
    const same =
      prev instanceof Date && next instanceof Date
        ? prev.getTime() === next.getTime()
        : JSON.stringify(prev ?? null) === JSON.stringify(next ?? null);
    if (!same) {
      b[field] = prev;
      a[field] = next as T[keyof T];
      changed.push(field);
    }
  }
  return { before: b, after: a, changed };
}
