import 'server-only';
import { AuditAction, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { MAINTENANCE_DEFAULT, MAINTENANCE_MESSAGE, MAINTENANCE_SETTING_KEY, type MaintenanceState } from '@/domain/system-maintenance';
import type { CurrentUser } from '@/server/auth/current-user';
import { requestMeta } from '@/server/auth/session';
import { AppError, ForbiddenError, RuleError } from '@/server/errors';
import { authorizedRevision } from '@/server/security/authorized-revision';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const closureSchema = z.object({
  phase: z.enum(['CLOSING', 'LOCKED']),
  startedAt: z.string().datetime(),
  startedById: z.string().min(1),
  pendingShiftIds: z.array(z.string().min(1)).default([]),
  backup: z.object({
    filename: z.string().min(1).max(200), digest: digestSchema, fingerprint: digestSchema, verificationNonce: digestSchema,
    createdAt: z.string().datetime(), createdById: z.string().min(1),
    verifiedAt: z.string().datetime().nullable(), verifiedById: z.string().min(1).nullable(),
  }).nullable(),
  lockedAt: z.string().datetime().nullable(), lockedById: z.string().min(1).nullable(),
});
const valueSchema = z.object({
  enabled: z.boolean(), message: z.string().trim().min(1).max(500), startedAt: z.string().datetime().nullable(),
  closure: closureSchema.nullable().default(null),
}).superRefine((state, context) => {
  if (state.closure && state.enabled !== (state.closure.phase === 'LOCKED')) {
    context.addIssue({ code: 'custom', message: 'El estado de cierre no coincide con la disponibilidad.' });
  }
  if (state.closure?.phase === 'LOCKED' && (!state.closure.lockedAt || !state.closure.lockedById || !state.closure.backup?.verifiedAt || !state.closure.backup.verifiedById)) {
    context.addIssue({ code: 'custom', message: 'El bloqueo requiere respaldo verificado y autoría.' });
  }
});

export class MaintenanceError extends AppError {
  constructor(message = MAINTENANCE_MESSAGE) { super(message, 'MAINTENANCE'); this.name = 'MaintenanceError'; }
}

export function maintenanceStateFromRow(row: { value: unknown; updatedAt: Date } | null): MaintenanceState {
  const parsed = valueSchema.safeParse(row ? row.value : MAINTENANCE_DEFAULT);
  // A malformed control cannot silently reopen the operation. SysAdmin can repair it from the same console.
  return {
    ...(parsed.success ? parsed.data : { ...MAINTENANCE_DEFAULT, enabled: true }),
    revision: authorizedRevision(row ? { value: row.value, updatedAt: row.updatedAt } : null),
    valid: parsed.success,
  };
}

/** No process/CDN cache: all compatible instances and releases read the same committed control. */
export async function getMaintenanceState(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<MaintenanceState> {
  const row = await client.systemSetting.findUnique({ where: { key: MAINTENANCE_SETTING_KEY }, select: { value: true, updatedAt: true } });
  return maintenanceStateFromRow(row);
}

/** Background work fails closed during maintenance or an unavailable control. */
export async function maintenanceBlocksBackground(): Promise<boolean> {
  try { const state = await getMaintenanceState(); return state.enabled || state.closure !== null; }
  catch { return true; }
}

export async function assertMaintenanceAccess(user: Pick<CurrentUser, 'isSystemAdmin'>): Promise<void> {
  if (user.isSystemAdmin) return;
  let state: MaintenanceState;
  try { state = await getMaintenanceState(); }
  catch { throw new MaintenanceError(); }
  if (state.enabled) throw new MaintenanceError(state.message);
}

/** Single audited transaction. No account, permission, session or operational record is changed. */
export async function setSystemMaintenance(user: CurrentUser, input: { enabled: boolean; expectedRevision: string }): Promise<MaintenanceState> {
  if (!user.isSystemAdmin) throw new ForbiddenError('Sólo el Administrador de sistema puede controlar el mantenimiento.');
  if (!/^[a-f0-9]{64}$/.test(input.expectedRevision)) throw new RuleError('Recarga el control de mantenimiento antes de confirmar.');
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'setting:' + MAINTENANCE_SETTING_KEY}))::text`;
    const previous = await tx.systemSetting.findUnique({ where: { key: MAINTENANCE_SETTING_KEY }, select: { value: true, updatedAt: true } });
    const current = maintenanceStateFromRow(previous);
    if (current.revision !== input.expectedRevision) throw new RuleError('El mantenimiento cambió. Recarga la página y vuelve a confirmar.');
    if (current.closure) throw new RuleError('El cierre ordenado sólo puede recuperarse con su acción explícita de recuperación.');
    if (current.valid && current.enabled === input.enabled) return current;
    const value = { enabled: input.enabled, message: MAINTENANCE_MESSAGE, startedAt: input.enabled ? new Date().toISOString() : null, closure: null };
    const data = { value, updatedById: user.id, category: 'mantenimiento', description: 'Control temporal auditado. Se administra exclusivamente desde Modo mantenimiento.' };
    const row = await tx.systemSetting.upsert({ where: { key: MAINTENANCE_SETTING_KEY }, create: { key: MAINTENANCE_SETTING_KEY, ...data }, update: data });
    // Unlike best-effort logging, failure here must roll back the availability change.
    await tx.auditLog.create({ data: { entity: 'SystemMaintenance', entityId: row.id, action: AuditAction.CONFIGURAR,
      summary: input.enabled ? 'Mantenimiento temporal activado; operación del personal pausada.' : 'Mantenimiento temporal desactivado; operación reabierta.',
      userId: user.id, sessionId: user.sessionId || null, before: previous ? previous.value === null ? Prisma.JsonNull : previous.value : MAINTENANCE_DEFAULT, after: value,
      ip: meta.ip, userAgent: meta.userAgent } });
    return maintenanceStateFromRow(row);
  });
}
