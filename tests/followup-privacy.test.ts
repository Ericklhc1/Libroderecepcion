import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createUser, prisma, resetOperationalData, seedCatalog, ROLE_KEYS } from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import { followUpReadWhere, followUpAuditVisibility, visibleHandoverItems } from '@/server/services/followup-access';
import { getResetPreview } from '@/server/services/factory-reset';
import { getBookItems } from '@/server/services/book';
import { getHistory } from '@/server/services/history';
import { getEntry } from '@/server/services/entries';
import { searchOperationalRecords } from '@/server/services/global-search';
import { executeFrontiV2ReadTool } from '@/server/ai/fronti-v2/read-tools';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { getWebPushPayload } from '@/server/services/web-push';
import { listComments, addComment } from '@/server/services/comments';
import { frontiChatReader } from '@/server/ai/fronti-chat';
import { getSharedShiftMemoryContext } from '@/server/ai/shift-memory';
import { prepareAssistantContext } from '@/server/ai/memory';
import { createFollowUp, updateFollowUp } from '@/server/services/followups';
import { sendBookItemMailAction } from '@/server/actions/book-mail';
import { notify } from '@/server/notifications';
import { GET as report } from '@/app/api/libro/reporte/route';
import { POST as payloadRoute } from '@/app/api/push/payload/route';

const state = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/mail', async original => ({ ...await original<object>(), sendMail: vi.fn(async () => ({ sent: true, to: 'synthetic@example.invalid' })) }));
vi.mock('@/server/auth/guard', () => ({ requireUser: async () => { if (!state.user) throw new Error('Actor requerido'); return state.user; } }));
vi.mock('@/server/auth/current-user', async original => ({ ...await original<object>(), getCurrentUser: async () => state.user }));
vi.mock('@/server/services/legal-acceptance', () => ({ hasAcceptedCurrentTerms: async () => true }));
vi.mock('@/server/services/web-push-scheduler', () => ({ scheduleWebPushForUsers: vi.fn() }));
vi.mock('@/server/ai/fronti-proactive-scheduler', () => ({ scheduleFrontiProactiveSweep: vi.fn() }));
vi.mock('@/server/services/operational-mail', async original => ({ ...await original<object>(), tryDeliverOperationalMail: vi.fn() }));

let a: CurrentUser, b: CurrentUser, supervisor: CurrentUser;
let entry: { id: string };
let rows: Array<{ id: string; action: string }>;
const markers = ['PRIVATE_A', 'PRIVATE_B', 'RESERVED_A', 'OPERATIVE_ASSIGNED', 'OPERATIVE_FOREIGN', 'DELETED_PRIVATE', 'DELETED_OPERATIVE', 'DELETED_FOREIGN_PRIVATE'];
const expected = { A: [0, 2, 3, 4], B: [1, 3], supervisor: [2, 3, 4] };
const actors = () => ({ A: a, B: b, supervisor });
beforeAll(seedCatalog);
beforeEach(async () => {
  await resetOperationalData();
  a = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Synthetic A' });
  b = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Synthetic B' });
  supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Synthetic supervisor' });
  entry = await prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Synthetic parent', description: 'Synthetic description', createdById: b.id, requiresFollowUp: false } });
  const definitions = [
    { createdById: a.id, ownerId: b.id, visibility: 'PRIVADO' as const },
    { createdById: b.id, ownerId: a.id, visibility: 'PRIVADO' as const },
    { createdById: a.id, ownerId: b.id, visibility: 'SUPERVISION' as const },
    { createdById: a.id, ownerId: b.id, visibility: 'OPERATIVO' as const },
    { createdById: supervisor.id, ownerId: supervisor.id, visibility: 'OPERATIVO' as const },
    { createdById: a.id, ownerId: a.id, visibility: 'PRIVADO' as const, deletedAt: new Date() },
    { createdById: b.id, ownerId: b.id, visibility: 'OPERATIVO' as const, deletedAt: new Date() },
    { createdById: supervisor.id, ownerId: a.id, visibility: 'PRIVADO' as const, deletedAt: new Date() },
  ];
  rows = [];
  for (const [index, data] of definitions.entries()) {
    const row = await prisma.followUp.create({ data: { ...data, entryId: entry.id, action: markers[index]!, nextAction: `SUMMARY_${markers[index]}`, description: `DETAIL_${markers[index]}` } });
    rows.push(row);
    await prisma.auditLog.create({ data: { entity: 'FollowUp', entityId: row.id, action: 'CREAR', summary: row.action, userId: data.createdById } });
  }
  state.user = b;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External HTTP prohibited'); }));
});
afterEach(() => { vi.unstubAllGlobals(); state.user = null; });

function assertProjection(value: unknown, indices: number[]) {
  const text = JSON.stringify(value);
  for (const [i, row] of rows.entries()) {
    if (!indices.includes(i)) {
      expect(text).not.toContain(row.id);
      expect(text).not.toContain(row.action);
      expect(text).not.toContain(`SUMMARY_${row.action}`);
    }
  }
}

async function sharedActor(members: CurrentUser[]) {
  const conversation = await prisma.chatConversation.create({ data: {
    type: 'GRUPO', createdById: a.id,
    participants: { create: members.map(member => ({ userId: member.id })) },
  } });
  return { conversation, actor: await frontiChatReader(a, conversation.id) };
}

describe('H01 canonical privacy with real PostgreSQL and crossed negative cases', () => {
  it.each(['A', 'B', 'supervisor'] as const)('%s: canonical policy, Libro, search, Fronti, associated history and counts agree', async key => {
    const actor = actors()[key];
    const ids = expected[key].map(i => rows[i]!.id).sort();
    expect((await prisma.followUp.findMany({ where: followUpReadWhere(actor) })).map(row => row.id).sort()).toEqual(ids);
    const book = await getBookItems(actor, { kinds: ['followup'] });
    expect(book.items.map(row => row.id).sort()).toEqual(ids);
    assertProjection(book, expected[key]);
    const fronti = await executeFrontiV2ReadTool(actor, 'consultar_seguimientos', { onlyOpen: false });
    expect((fronti.result as { items: { id: string }[] }).items.map(row => row.id).sort()).toEqual(ids);
    assertProjection(fronti, expected[key]);
    for (const [i, row] of rows.entries()) {
      const search = await searchOperationalRecords(actor, row.action);
      expect(search.some(hit => hit.entityId === row.id)).toBe(expected[key].includes(i));
      if (!expected[key].includes(i)) expect(search).toEqual([]);
      const history = await getHistory(actor, { entity: 'FollowUp', entityId: row.id });
      expect(history.length > 0).toBe(expected[key].includes(i));
    }
    const history = await getHistory(actor, { entity: 'OperationalEntry', entityId: entry.id });
    assertProjection(history, expected[key]);
    expect(history.filter(event => event.kind === 'seguimiento')).toHaveLength(ids.length);
    expect((await getEntry(entry.id, actor))._count.followUps).toBe(ids.length);
    const counts = await prisma.followUp.groupBy({ by: ['status'], where: followUpReadWhere(actor), _count: { _all: true } });
    expect(counts.reduce((total, row) => total + row._count._all, 0)).toBe(ids.length);
    const audit = await prisma.auditLog.findMany({ where: await followUpAuditVisibility(actor) });
    assertProjection(audit, expected[key]);
  });
  it('supervision.view, assignment and system hierarchy do not confer private/reserved read access', async () => {
    const reader = { ...b, permissions: [...b.permissions, 'supervision.view' as const] };
    expect((await prisma.followUp.findMany({ where: followUpReadWhere(reader) })).map(row => row.id).sort()).toEqual(expected.B.map(i => rows[i]!.id).sort());
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    assertProjection(await getBookItems(admin, { kinds: ['followup'] }), [2, 3, 4]);
  });
  it('deleted requires explicit authorization; authorized reads still exclude foreign private records', async () => {
    expect(() => followUpReadWhere(b, { includeDeleted: true })).toThrow('autorización');
    await expect(getBookItems(b, { includeDeleted: true })).rejects.toThrow('autorización');
    const reader = { ...a, permissions: [...a.permissions, 'entry.restore' as const] };
    const deleted = await prisma.followUp.findMany({ where: followUpReadWhere(reader, { onlyDeleted: true }) });
    expect(deleted.map(row => row.id).sort()).toEqual([rows[5]!.id, rows[6]!.id].sort());
    expect(deleted.map(row => row.id)).not.toContain(rows[7]!.id);
    expect((await getBookItems(reader, { kinds: ['followup'], includeDeleted: true })).items).toHaveLength(6);
  });
  it.each(['A', 'B', 'supervisor'] as const)('%s: direct report API produces a real PDF without foreign markers or inflated counts', async key => {
    state.user = actors()[key];
    const response = await report(new NextRequest('http://localhost/api/libro/reporte?clase=followup&descargar=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const text = Buffer.from(await response.arrayBuffer()).toString('latin1');
    expect(text).toContain('%PDF');
    expect(text).toContain(`Registros: ${expected[key].length}`);
    for (const [index, marker] of markers.entries()) expect(text.includes(marker)).toBe(expected[key].includes(index));
  });
  it('direct report cannot grant deleted access via query parameter', async () => {
    expect((await report(new NextRequest('http://localhost/api/libro/reporte?clase=followup&eliminados=1'))).status).toBe(403);
  });
  it('historical notification content, IDs, unread counts and push payload inherit current source policy', async () => {
    for (const row of rows) {
      const alert = await prisma.alert.create({ data: { type: 'SEGUIMIENTO_VENCIDO', level: 'ATENCION', title: row.action, followUpId: row.id } });
      for (const [entity, entityId] of [['FollowUp', row.id], ['Alert', alert.id]]) await prisma.notification.create({ data: { userId: b.id, type: 'MENCION', entity, entityId, title: row.action, body: `SUMMARY_${row.action}` } });
    }
    const feed = await getNotificationFeedForUser(b);
    expect(feed.unread).toBe(4); expect(feed.items).toHaveLength(4); assertProjection(feed, expected.B);
    await prisma.pushSubscription.create({ data: { userId: b.id, endpoint: 'https://synthetic.invalid/subscription', createdAt: new Date(0) } });
    const payload = await getWebPushPayload({ user: b, endpoint: 'https://synthetic.invalid/subscription' });
    expect(payload.unread).toBe(4); expect(payload.newCount).toBe(4); assertProjection(payload, expected.B);
  });
  it('notification producer denies assignment and mentions to readers lacking source authorization', async () => {
    await notify(rows.slice(0, 5).map(row => ({ userId: b.id, type: 'MENCION' as const, title: row.action, entity: 'FollowUp', entityId: row.id })));
    const persisted = await prisma.notification.findMany({ where: { userId: b.id } });
    expect(persisted).toHaveLength(2); assertProjection(persisted, expected.B);
  });
  it('historical handover references are projected without deleting stored history', async () => {
    const items = rows.map(row => ({ refType: 'followup', refId: row.id, title: row.action }));
    const visible = await visibleHandoverItems(b, items);
    expect(visible).toHaveLength(2); assertProjection(visible, expected.B); expect(items).toHaveLength(8);
  });
  it('push payload direct handler rejects an expired session without reading or advancing subscriptions', async () => {
    state.user = null;
    const response = await payloadRoute(new Request('http://localhost/api/push/payload', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://synthetic.invalid/subscription' }) }));
    expect(response.status).toBe(401);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
  it('direct comment reads and edits cannot reveal or mutate an assigned foreign private source', async () => {
    await prisma.comment.create({ data: { body: 'PRIVATE_COMMENT', authorId: a.id, followUpId: rows[0]!.id, entryId: entry.id } });
    expect(await listComments(b, { followUpId: rows[0]!.id })).toEqual([]);
    expect(JSON.stringify(await getHistory(b, { entity: 'OperationalEntry', entityId: entry.id }))).not.toContain('PRIVATE_COMMENT');
    expect(await listComments(a, { followUpId: rows[0]!.id })).toHaveLength(1);
    await expect(addComment(b, { followUpId: rows[0]!.id, body: 'Unauthorized comment' })).rejects.toThrow('no existe');
    await expect(updateFollowUp(b, { id: rows[0]!.id, result: 'Unauthorized change' })).rejects.toThrow('no existe');
    expect(await prisma.followUp.findUnique({ where: { id: rows[0]!.id } })).toMatchObject({ result: null });
  });
  it('direct mail export denies a foreign private record before invoking delivery', async () => {
    const { sendMail } = await import('@/server/mail');
    vi.mocked(sendMail).mockClear();
    state.user = supervisor;
    const form = new FormData();
    form.set('kind', 'followup'); form.set('id', rows[0]!.id); form.set('to', 'synthetic@example.invalid');
    const result = await sendBookItemMailAction(null, form);
    expect(result.ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('technical inventory counts cannot reveal foreign private records', async () => {
    const preview = await getResetPreview(b);
    expect(preview.followUps).toBe(2);
  });
  it('actor is mandatory even when a filter is empty', () => {
    expect(() => followUpReadWhere(undefined as never)).toThrow('identidad');
  });
  it('Fronti shared audience intersects effective permissions without disclosing creator private records', async () => {
    const { conversation, actor } = await sharedActor([a, b]);
    const result = await executeFrontiV2ReadTool(actor, 'consultar_seguimientos', { onlyOpen: false });
    assertProjection(result, [3]);
    expect((result.result as { items: { id: string }[] }).items.map(row => row.id)).toEqual([rows[3]!.id]);
    await expect(frontiChatReader(supervisor, conversation.id)).rejects.toThrow('conversación');
    // A role change is read from the database, not from an audience supplied by the client.
    await prisma.user.update({ where: { id: b.id }, data: { roleId: supervisor.roleId } });
    const changed = await frontiChatReader(a, conversation.id);
    assertProjection(await executeFrontiV2ReadTool(changed, 'consultar_seguimientos', { onlyOpen: false }), [2, 3, 4]);
    expect((await prisma.followUp.findMany({ where: followUpReadWhere(changed) })).map(row => row.id).sort()).toEqual([2, 3, 4].map(i => rows[i]!.id).sort());
  });

  it('Fronti rejects private creation in a shared chat atomically, preserving legitimate operative creation', async () => {
    const { actor } = await sharedActor([a, b]);
    const before = await prisma.followUp.count();
    const audits = await prisma.auditLog.count();
    await expect(createFollowUp(actor, { entryId: entry.id, action: 'SHARED_PRIVATE', visibility: 'PRIVADO', ownerId: b.id })).rejects.toThrow('participantes');
    expect(await prisma.followUp.count()).toBe(before);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect((await prisma.operationalEntry.findUniqueOrThrow({ where: { id: entry.id } })).requiresFollowUp).toBe(false);
    const positive = await createFollowUp(actor, { entryId: entry.id, action: 'SHARED_OPERATIVE', visibility: 'OPERATIVO', ownerId: b.id });
    expect(await prisma.followUp.count({ where: { id: positive.id, AND: [followUpReadWhere(actor)] } })).toBe(1);
    const personal = await createFollowUp(a, { action: 'PERSONAL_PRIVATE', visibility: 'PRIVADO', ownerId: b.id });
    expect(await prisma.followUp.count({ where: { id: personal.id, AND: [followUpReadWhere(a)] } })).toBe(1);
    expect(await prisma.followUp.count({ where: { id: personal.id, AND: [followUpReadWhere(b)] } })).toBe(0);
  });

  it('Fronti personal conversation remains individual and an incompatible audience is rejected', async () => {
    const conversation = await prisma.chatConversation.create({ data: { type: 'FRONTI', createdById: a.id, participants: { create: { userId: a.id } } } });
    const actor = await frontiChatReader(a, conversation.id);
    expect(await prisma.followUp.count({ where: { id: rows[0]!.id, AND: [followUpReadWhere(actor)] } })).toBe(1);
    await prisma.chatParticipant.create({ data: { conversationId: conversation.id, userId: b.id } });
    await expect(frontiChatReader(a, conversation.id)).rejects.toThrow('audiencia incompatible');
  });

  it('Fronti shift memory applies source privacy before its limit and preserves stored history', async () => {
    const shift = await prisma.shift.create({ data: { date: new Date(), type: 'DIA', status: 'ACTIVO', plannedStart: new Date(), plannedEnd: new Date(Date.now() + 3600000), assignments: { create: { userId: b.id } } } });
    for (let i = 0; i < 13; i++) await prisma.ai_memory.create({ data: { id: `private-memory-${i}`, user_id: a.id, shift_id: shift.id, scope: 'TURNO', summary: 'PRIVATE_MEMORY', entity_type: 'FollowUp', entity_id: rows[0]!.id, importance: 5, expires_at: new Date(Date.now() + 3600000) } });
    await prisma.ai_memory.create({ data: { id: 'visible-memory', user_id: a.id, shift_id: shift.id, scope: 'TURNO', summary: 'VISIBLE_MEMORY', entity_type: 'FollowUp', entity_id: rows[3]!.id, importance: 1, expires_at: new Date(Date.now() + 3600000) } });
    const context = await getSharedShiftMemoryContext(b);
    expect(context).toContain('VISIBLE_MEMORY');
    expect(context).not.toContain('PRIVATE_MEMORY');
    expect(context).not.toContain(rows[0]!.id);
    expect(await prisma.ai_memory.count()).toBe(14);
  });

  it('Fronti personal referenced memory cannot retain access after ownership or permission changes', async () => {
    for (const [i, row] of rows.entries()) await prisma.ai_memory.create({ data: { id: `personal-memory-${i}`, user_id: b.id, scope: 'PERSONAL', summary: row.action, entity_type: 'FollowUp', entity_id: row.id, expires_at: new Date(Date.now() + 3600000) } });
    const context = await prepareAssistantContext(b, 'seguimientos #no-guardar');
    expect(context.memoryContext).toContain('PRIVATE_B');
    expect(context.memoryContext).toContain('OPERATIVE_ASSIGNED');
    assertProjection(context.memoryContext, [1, 3]);
    expect(await prisma.ai_memory.count()).toBe(8);
  });

});
