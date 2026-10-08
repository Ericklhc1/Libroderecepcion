import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { requestMeta } from '@/server/auth/session';

export const cleanupKinds = ['fronti', 'frontiChat', 'notification', 'cashMovement', 'cashAudit', 'housekeeping'] as const;
export type CleanupKind = (typeof cleanupKinds)[number];
export const cleanupInput = z.object({
  kind: z.enum(cleanupKinds), id: z.string().min(1),
  revision: z.string().min(1), reason: z.string().trim().min(5).max(500),
  confirmation: z.literal('ELIMINAR'),
});
export function assertCleanupAdmin(user: Pick<CurrentUser, 'isSystemAdmin' | 'roleKey'>) {
  if (!user.isSystemAdmin || user.roleKey !== 'ADMINISTRADOR_SISTEMA') throw new ForbiddenError('Sólo SysAdmin puede limpiar datos desde Administración.');
}

/** Uses native lifecycle fields. No physical deletion, external sends or operational impersonation. */
export async function cleanupAdminRecord(user: CurrentUser, raw: z.input<typeof cleanupInput>) {
  assertCleanupAdmin(user);
  const input = cleanupInput.parse(raw);
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    const data = { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason };
    let entity: string;
    let changed: number;
    let before: object;
    if (input.kind === 'fronti') {
      const row = await tx.ai_message.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!row) throw new NotFoundError();
      if (row.created_at.toISOString() !== input.revision) throw new RuleError('El mensaje cambió. Recarga antes de eliminar.');
      // Memory extracted from this conversation may contain the removed text.
      await tx.ai_memory.updateMany({ where: { conversation_id: row.conversation_id, deletedAt: null }, data });
      changed = (await tx.ai_message.updateMany({ where: { id: row.id, deletedAt: null }, data })).count;
      before = { conversationId: row.conversation_id, role: row.role };
      entity = 'ai_message';
    } else if (input.kind === 'frontiChat') {
      const row = await tx.chatMessage.findFirst({ where: { id: input.id, deletedAt: null, OR: [{ author: 'FRONTI' }, { conversation: { type: 'FRONTI' } }] } });
      if (!row) throw new NotFoundError();
      if ((row.editedAt ?? row.createdAt).toISOString() !== input.revision) throw new RuleError('El mensaje cambió. Recarga antes de eliminar.');
      changed = (await tx.chatMessage.updateMany({ where: { id: row.id, deletedAt: null, editedAt: row.editedAt }, data: { deletedAt: data.deletedAt } })).count;
      await tx.chatConversation.update({ where: { id: row.conversationId }, data: { updatedAt: data.deletedAt } });
      before = { conversationId: row.conversationId, author: row.author };
      entity = 'ChatMessage';
    } else if (input.kind === 'notification') {
      const row = await tx.notification.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!row) throw new NotFoundError();
      if (row.createdAt.toISOString() !== input.revision) throw new RuleError('El aviso cambió. Recarga antes de eliminar.');
      changed = (await tx.notification.updateMany({ where: { id: row.id, deletedAt: null }, data })).count;
      before = { userId: row.userId, title: row.title };
      entity = 'Notification';
    } else if (input.kind === 'cashMovement') {
      const row = await tx.cashMovement.findFirst({ where: { id: input.id, voidedAt: null } });
      if (!row) throw new NotFoundError();
      if (row.createdAt.toISOString() !== input.revision) throw new RuleError('El movimiento cambió. Recarga antes de eliminar.');
      // The existing void lifecycle removes its impact from all ledger reads and expected cash.
      changed = (await tx.cashMovement.updateMany({ where: { id: row.id, voidedAt: null }, data: { voidedAt: data.deletedAt, voidedById: user.id, voidReason: input.reason, affectsExpected: false } })).count;
      before = { kind: row.kind, currency: row.currency, amount: row.amount.toString(), affectsExpected: row.affectsExpected, guaranteeId: row.guaranteeId, gymPassId: row.gymPassId, cashTransferId: row.cashTransferId };
      entity = 'CashMovement';
    } else if (input.kind === 'cashAudit') {
      const row = await tx.cashAudit.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!row) throw new NotFoundError();
      if (row.createdAt.toISOString() !== input.revision) throw new RuleError('El arqueo cambió. Recarga antes de eliminar.');
      changed = (await tx.cashAudit.updateMany({ where: { id: row.id, deletedAt: null }, data })).count;
      before = { humanId: row.humanId, currency: row.currency, countedAmount: row.countedAmount.toString() };
      entity = 'CashAudit';
    } else {
      const row = await tx.housekeepingRequest.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!row) throw new NotFoundError();
      if (String(row.version) !== input.revision) throw new RuleError('El trabajo cambió. Recarga antes de eliminar.');
      // Free active lifecycle keys; snapshot linked text to satisfy the native content invariant.
      // Original links/keys remain in the mandatory audit, while the physical row and events survive.
      const source = row.sourceEntryId ? await readEntries(tx, user).findUnique({ where: { id: row.sourceEntryId }, select: { title: true, description: true } }) : null;
      changed = (await tx.housekeepingRequest.updateMany({ where: { id: row.id, version: row.version, deletedAt: null }, data: { ...data, requestKey: `deleted:${randomUUID()}`, sourceEntryId: null, routineId: null, title: row.title ?? source?.title, description: row.description ?? source?.description, version: { increment: 1 } } })).count;
      before = { humanId: row.humanId, version: row.version, status: row.status, sourceEntryId: row.sourceEntryId, departmentId: row.departmentId, requestKey: row.requestKey, routineId: row.routineId, workDate: row.workDate };
      entity = 'HousekeepingRequest';
    }
    if (changed !== 1) throw new RuleError('El registro cambió o ya fue eliminado. Recarga la página.');
    // Audit is mandatory: any failure rolls back the cleanup and derived memory change.
    await tx.auditLog.create({ data: { entity, entityId: input.id, action: 'ELIMINAR', userId: user.id, sessionId: user.sessionId,
      summary: 'Limpieza individual de prueba desde Administración', reason: input.reason,
      before, after: { deletedAt: data.deletedAt.toISOString(), deletedById: user.id }, ip: meta.ip, userAgent: meta.userAgent } });
  });
}
