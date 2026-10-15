import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma, EntryType, ShiftStatus, ShiftType } from '@prisma/client';
import { prisma as applicationPrisma } from '@/lib/prisma';
import { collectClosureBackup, closureBackupFingerprint, getClosureBinaryInventory } from '@/server/services/closure-backup';
import { getBookReportItems } from '@/server/services/book';
import { getHistory } from '@/server/services/history';
import type { CurrentUser } from '@/server/auth/current-user';
import { ROLE_KEYS, createShift, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';

const fullText = `Inicio ${'evidencia completa con saltos\n'.repeat(30)} MARCADOR_FINAL_INTEGRO`;

describe('respaldo íntegro y verificable de cierre', () => {
  let admin: CurrentUser;
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador de prueba' });
  });

  const collect = () => applicationPrisma.$transaction(tx => collectClosureBackup(tx), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  it('informa expresamente que el JSON no incluye ni verifica binarios, incluso con inventario vacío', async () => {
    const backup = await collect();
    expect(backup.binaryBackup).toMatchObject({ included: false, verified: false, total: 0 });
    expect(backup.binaryBackup.sources).toEqual([
      { source: 'Attachment', count: 0, ids: [] },
      { source: 'SupportRequestAttachment', count: 0, ids: [] },
      { source: 'ChatSticker', count: 0, ids: [] },
    ]);
    expect(backup.binaryBackup.notice).toContain('referencias y metadatos no sustituyen los archivos');
  });

  it('inventaría adjuntos de Libro, tareas, chat, huérfanos y los eliminados o de prueba sin asumir respaldo', async () => {
    const deletedAt = new Date('2026-10-15T12:00:00Z');
    const entry = await prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Adjunto sintético', description: fullText, createdById: admin.id } });
    const task = await prisma.task.create({ data: { title: 'Tarea sintética', createdById: admin.id } });
    const conversation = await prisma.chatConversation.create({ data: { type: 'GRUPO', title: 'CONTENIDO_CHAT_PRIVADO_NO_EXPORTAR', createdById: admin.id } });
    const message = await prisma.chatMessage.create({ data: { conversationId: conversation.id, senderId: admin.id, body: 'CONTENIDO_CHAT_PRIVADO_NO_EXPORTAR' } });
    await prisma.attachment.createMany({ data: [
      { id: 'binary-entry', entryId: entry.id, fileName: 'libro.txt', mimeType: 'text/plain', size: 4, storageKey: 'synthetic/entry.txt', uploadedById: admin.id },
      { id: 'binary-task-deleted', taskId: task.id, deletedAt, fileName: 'tarea.txt', mimeType: 'text/plain', size: 4, storageKey: 'synthetic/task.txt', uploadedById: admin.id },
      { id: 'binary-chat', chatMessageId: message.id, fileName: 'NOMBRE_CHAT_PRIVADO_NO_EXPORTAR.txt', mimeType: 'text/plain', size: 4, storageKey: 'synthetic/chat.txt', uploadedById: admin.id },
      { id: 'binary-orphan-demo-deleted', isDemo: true, deletedAt, fileName: 'NOMBRE_HUERFANO_NO_EXPORTAR.txt', mimeType: 'text/plain', size: 4, storageKey: 'synthetic/orphan.txt', uploadedById: admin.id },
    ] });
    await prisma.supportRequest.create({ data: {
      id: 'support-with-binary', correlationId: 'synthetic-binary-support', kind: 'ERROR', subject: 'CONTENIDO_SOPORTE_PRIVADO_NO_EXPORTAR', description: 'CONTENIDO_SOPORTE_PRIVADO_NO_EXPORTAR',
      requestedById: admin.id, requesterName: admin.name, requesterUser: 'synthetic', requesterRole: admin.roleKey, context: {},
      attachments: { create: { id: 'binary-support', kind: 'ARCHIVO', fileName: 'NOMBRE_SOPORTE_PRIVADO_NO_EXPORTAR.txt', mimeType: 'text/plain', size: 4, storageKey: 'synthetic/support.txt' } },
    } });
    await prisma.chatSticker.create({ data: { id: 'binary-sticker-deleted', ownerId: admin.id, deletedAt, fileName: 'NOMBRE_STICKER_PRIVADO_NO_EXPORTAR.png', mimeType: 'image/png', size: 4, storageKey: 'synthetic/sticker.png' } });
    const inventory = await applicationPrisma.$transaction(tx => getClosureBinaryInventory(tx));
    expect(inventory).toEqual({ total: 6, sources: [
      { source: 'Attachment', count: 4, ids: ['binary-chat', 'binary-entry', 'binary-orphan-demo-deleted', 'binary-task-deleted'] },
      { source: 'SupportRequestAttachment', count: 1, ids: ['binary-support'] },
      { source: 'ChatSticker', count: 1, ids: ['binary-sticker-deleted'] },
    ] });
    const backup = await collect();
    expect(backup.binaryBackup).toMatchObject({ ...inventory, included: false, verified: false });
    expect(backup.tables.attachments).toHaveLength(2);
    const json = JSON.stringify(backup);
    expect(json).toContain('no incluye ni verifica los archivos binarios');
    expect(json).not.toContain('PRIVADO_NO_EXPORTAR');
    expect(json).not.toContain('synthetic/chat.txt');
    expect(json).not.toContain('synthetic/support.txt');
    expect(json).not.toContain('synthetic/sticker.png');
    const fingerprint = closureBackupFingerprint(backup);
    await prisma.attachment.create({ data: { id: 'binary-new-orphan', fileName: 'otro.txt', mimeType: 'text/plain', size: 4, storageKey: 'synthetic/new-orphan.txt', uploadedById: admin.id } });
    expect(closureBackupFingerprint(await collect())).not.toBe(fingerprint);
  });

  it('conserva quién participó en una auditoría, quién lo incorporó y sus identidades y roles trazables', async () => {
    const participant = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Participante sintético' });
    const template = await prisma.checklistTemplate.create({ data: { name: 'Auditoría sintética', createdById: admin.id } });
    const audit = await prisma.checklistRun.create({ data: { templateId: template.id, templateName: template.name, runById: admin.id, deletedAt: new Date('2026-10-15T12:00:00Z') } });
    const addedAt = new Date('2026-10-15T11:00:00Z');
    await prisma.auditParticipant.create({ data: { id: 'audit-participant-synthetic', auditId: audit.id, userId: participant.id, addedById: admin.id, createdAt: addedAt } });
    await prisma.auditLog.create({ data: { entity: 'ChecklistRun', entityId: audit.id, action: 'CREAR', userId: admin.id, summary: 'Auditoría con participante sintético', after: { participantIds: [participant.id] } } });
    const backup = await collect();
    expect(backup.tables.auditParticipants).toEqual([{
      id: 'audit-participant-synthetic', auditId: audit.id, userId: participant.id, addedById: admin.id, createdAt: addedAt.toISOString(),
    }]);
    expect(backup.tables.checklistRuns).toEqual(expect.arrayContaining([expect.objectContaining({ id: audit.id, runById: admin.id })]));
    expect(backup.tables.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: participant.id, name: participant.name, roleId: participant.roleId }),
      expect.objectContaining({ id: admin.id, name: admin.name, roleId: admin.roleId }),
    ]));
    expect(backup.tables.roles).toEqual(expect.arrayContaining([expect.objectContaining({ id: participant.roleId, key: ROLE_KEYS.RECEPTIONIST })]));
    expect(backup.tables.auditLogs).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: audit.id, after: { participantIds: [participant.id] } })]));
    expect(JSON.stringify(backup)).not.toContain('passwordHash');
  });

  it('exporta más de 2000 novedades con su texto y comentarios completos', async () => {
    await prisma.operationalEntry.createMany({
      data: Array.from({ length: 2005 }, (_, index) => ({
        id: `backup-entry-${String(index).padStart(4, '0')}`,
        type: EntryType.NOVEDAD, title: `Registro ficticio ${index}`, description: fullText,
        createdById: admin.id, occurredAt: new Date('2026-10-15T10:00:00Z'),
      })),
    });
    await prisma.comment.create({ data: { entryId: 'backup-entry-2004', authorId: admin.id, body: fullText } });
    const rows = await getBookReportItems({ kinds: ['entry'] }, admin);
    expect(rows).toHaveLength(2005);
    expect(rows.every(row => row.summary === fullText)).toBe(true);
    expect(rows.find(row => row.id === 'backup-entry-2004')?.comments?.[0]?.body).toBe(fullText);
    const backup = await collect();
    expect(backup.tables.entries).toHaveLength(2005);
    expect(JSON.stringify(backup)).toContain('MARCADOR_FINAL_INTEGRO');
    expect(backup.tables.comments).toEqual(expect.arrayContaining([expect.objectContaining({ body: fullText })]));
  });

  it('el informe normal conserva la privacidad de seguimientos y comentarios', async () => {
    const reader = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Lector ficticio' });
    const entry = await prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Visible', description: fullText, createdById: admin.id } });
    const followUp = await prisma.followUp.create({ data: { action: 'SEGUIMIENTO_PRIVADO', entryId: entry.id, ownerId: admin.id, createdById: admin.id, visibility: 'PRIVADO' } });
    await prisma.comment.create({ data: { followUpId: followUp.id, authorId: admin.id, body: 'COMENTARIO_PRIVADO' } });
    await prisma.comment.create({ data: { entryId: entry.id, authorId: admin.id, body: 'COMENTARIO_VISIBLE' } });
    const report = await getBookReportItems({}, reader);
    expect(report).toHaveLength(1);
    expect(report[0]?.comments).toEqual(expect.arrayContaining([expect.objectContaining({ body: 'COMENTARIO_VISIBLE' })]));
    expect(JSON.stringify(report)).not.toContain('PRIVADO');
  });

  it('conserva cierres previos y el final, custodia real y trazabilidad sin credenciales', async () => {
    const humanIds = [1725, 1715, 1700, 1693, 1680, 1673, 1733];
    for (const humanId of humanIds) {
      const shift = await createShift({ userId: admin.id, type: ShiftType.DIA });
      await prisma.shift.update({ where: { id: shift.id }, data: { humanId, status: ShiftStatus.CERRADO, actualEnd: new Date('2026-10-15T11:20:00Z') } });
      await prisma.shiftHandover.create({ data: {
        fromShiftId: shift.id, issuedById: admin.id, status: 'ENVIADA', issuedAt: new Date('2026-10-15T11:15:00Z'),
        notes: fullText, issuerSessionId: 'DO_NOT_EXPORT_SESSION', snapshot: { original: fullText },
      } });
    }
    const shift = await prisma.shift.findUniqueOrThrow({ where: { humanId: 1733 }, include: { handoverOut: true } });
    const handoverId = shift.handoverOut!.id;
    await prisma.$executeRaw`INSERT INTO "ShiftCashClosure" ("id", "shiftId", "closedById", "snapshot", "notes") VALUES ('backup-cash-closure', ${shift.id}, ${admin.id}, ${JSON.stringify({ original: fullText })}::jsonb, ${fullText})`;
    const elementType = await prisma.handoverElementType.upsert({ where: { name: 'Objeto ficticio para respaldo' }, create: { name: 'Objeto ficticio para respaldo' }, update: {} });
    await prisma.handoverElement.create({ data: { handoverId, elementTypeId: elementType.id, declared: true, confirmed: false, notes: fullText } });
    await prisma.auditLog.create({ data: {
      entity: 'ShiftHandover', entityId: handoverId, action: 'EDITAR', summary: fullText,
      before: { original: fullText, passwordHash: 'DO_NOT_EXPORT_HASH' }, after: { original: fullText },
      sessionId: 'DO_NOT_EXPORT_SESSION', userId: admin.id,
    } });
    const backup = await collect();
    expect(backup.tables.shifts).toEqual(expect.arrayContaining(humanIds.map(humanId => expect.objectContaining({ humanId }))));
    expect(backup.tables.cashClosures).toEqual(expect.arrayContaining([expect.objectContaining({ notes: fullText })]));
    expect(backup.tables.handoverElements).toEqual(expect.arrayContaining([expect.objectContaining({ declared: true, confirmed: false, notes: fullText })]));
    const body = JSON.stringify(backup);
    expect(body).toContain(fullText.replaceAll('\n', '\\n'));
    expect(body).not.toContain('DO_NOT_EXPORT');
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('SessionId');
    expect(closureBackupFingerprint(backup)).toMatch(/^[a-f0-9]{64}$/);
    expect(closureBackupFingerprint(await collect())).toBe(closureBackupFingerprint(backup));
  });

  it('detecta cambios de texto o comentarios; auditar el respaldo no invalida su huella', async () => {
    const entry = await prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Fuente ficticia', description: fullText, createdById: admin.id } });
    const original = closureBackupFingerprint(await collect());
    await prisma.auditLog.create({ data: { entity: 'SystemClosure', entityId: 'control', action: 'EDITAR', summary: 'Respaldo generado', userId: admin.id } });
    expect(closureBackupFingerprint(await collect())).toBe(original);
    const comment = await prisma.comment.create({ data: { entryId: entry.id, authorId: admin.id, body: fullText } });
    const commented = closureBackupFingerprint(await collect());
    expect(commented).not.toBe(original);
    await prisma.comment.update({ where: { id: comment.id }, data: { body: `${fullText} añadido` } });
    expect(closureBackupFingerprint(await collect())).not.toBe(commented);
  });

  it('incluye históricos eliminados y las jornadas de Supervisión y Housekeeping', async () => {
    const deletedAt = new Date('2026-10-15T12:00:00Z');
    await prisma.cashAudit.create({ data: { id: 'audit-deleted', currency: 'CLP', expectedAmount: 0, countedAmount: 0, difference: 0, countedById: admin.id, notes: fullText, deletedAt } });
    await prisma.housekeepingRequest.create({ data: { id: 'hk-deleted', requestKey: 'hk-deleted-backup', title: 'Aviso histórico ficticio', description: fullText, deletedAt } });
    const supervision = await prisma.supervisionShift.create({ data: { supervisorId: admin.id, status: 'CERRADO', openingState: { original: fullText } } });
    await prisma.supervisionShiftHandover.create({ data: { supervisionShiftId: supervision.id, issuedById: admin.id, snapshot: { original: fullText }, note: fullText } });
    const backup = await collect();
    expect(backup.tables.cashAudits).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'audit-deleted', deletedAt: deletedAt.toISOString(), notes: fullText })]));
    expect(backup.tables.housekeepingRequests).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'hk-deleted', deletedAt: deletedAt.toISOString(), description: fullText })]));
    expect(backup.tables.supervisionShifts).toEqual(expect.arrayContaining([expect.objectContaining({ id: supervision.id })]));
    expect(backup.tables.supervisionHandovers).toEqual(expect.arrayContaining([expect.objectContaining({ supervisionShiftId: supervision.id, receivedAt: null })]));
    const original = closureBackupFingerprint(backup);
    await prisma.supervisionShiftHandover.update({ where: { supervisionShiftId: supervision.id }, data: { receivedById: admin.id, receivedAt: new Date('2026-10-15T12:01:00Z') } });
    expect(closureBackupFingerprint(await collect())).not.toBe(original);
  });

  it('la impresión individual solicita comentarios y auditoría sin límites ocultos', async () => {
    const shift = await createShift({ userId: admin.id, type: ShiftType.DIA });
    const handover = await prisma.shiftHandover.create({ data: { fromShiftId: shift.id, issuedById: admin.id } });
    await prisma.comment.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ id: `backup-comment-${index}`, handoverId: handover.id, authorId: admin.id, body: fullText })) });
    await prisma.auditLog.createMany({ data: Array.from({ length: 305 }, (_, index) => ({ id: `backup-audit-${index}`, entity: 'ShiftHandover', entityId: handover.id, action: 'EDITAR' as const, summary: fullText, before: { original: fullText }, userId: admin.id })) });
    const events = await getHistory({ entity: 'ShiftHandover', entityId: handover.id }, admin, true);
    expect(events.filter(event => event.kind === 'comentario')).toHaveLength(205);
    expect(events.filter(event => event.kind === 'auditoria')).toHaveLength(305);
    expect(events.find(event => event.kind === 'comentario')?.detail).toBe(fullText);
  });
});
