import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, createShift, prisma as fixtureDb, resetOperationalData } from '../tests/helpers';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { createEntry, updateEntry, changeEntryStatus, getEntry } from '@/server/services/entries';
import { createFollowUp, updateFollowUp } from '@/server/services/followups';
import { getBookItems } from '@/server/services/book';
import { getHistory } from '@/server/services/history';
import { searchOperationalRecords } from '@/server/services/global-search';
import { executeFrontiV2ReadTool } from '@/server/ai/fronti-v2/read-tools';
import { createEntryAction } from '@/server/actions/entries';
import { createManualCashMovementAction, createCashDifferenceRegularizationAction } from '@/server/actions/live-cash';
import { createHkWork, changeHkWork } from '@/server/services/housekeeping-work';
import { hotelDateKey } from '@/domain/time';
import { registerWebPushSubscription, dispatchWebPushForUsers, getWebPushPayload } from '@/server/services/web-push';
import { GET as report } from '@/app/api/libro/reporte/route';

// Actores sintéticos; no se prueba cookie/SSO. Se mantienen permisos de catálogo.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null, failWorkflow: false, pdf: null as null | { lines: string[]; subtitle: string } }));
vi.mock('@/server/auth/guard', () => ({
  requireUser: async () => { if (!state.user) throw new Error('actor sintético requerido'); return state.user; },
  requirePermission: async (permission: string) => {
    if (!state.user?.permissions.includes(permission as never)) throw new Error('permiso sintético ausente');
    return state.user;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/server/ai/fronti-proactive-scheduler', () => ({ scheduleFrontiProactiveSweep: vi.fn() }));
vi.mock('@/server/services/web-push-scheduler', () => ({ scheduleWebPushForUsers: vi.fn() }));
vi.mock('@/server/observability/operational', async original => ({ ...await original<object>(), recordOperationalEvent: vi.fn() }));
vi.mock('@/server/services/operational-mail', async original => ({ ...await original<object>(), tryDeliverOperationalMail: vi.fn() }));
vi.mock('@/server/services/incident-workflow', async original => {
  const actual = await original<typeof import('@/server/services/incident-workflow')>();
  return { ...actual, ensureIncidentWorkflow: async (id: string) => {
    if (state.failWorkflow) throw new Error('fallo sintético entre commits');
    return actual.ensureIncidentWorkflow(id);
  } };
});
vi.mock('@/server/reports/simple-pdf', () => ({ createTextPdf: (input: { lines: string[]; subtitle: string }) => { state.pdf = input; return Buffer.from('PDF sintético; se comprueba proyección, no empaquetado'); } }));

let a: CurrentUser, b: CurrentUser, supervisor: CurrentUser;
const base = { type: 'NOVEDAD' as const, title: 'Novedad exclusivamente sintética', description: 'Descripción sintética de prueba', priority: 'MEDIA' as const, tags: [], requiresFollowUp: false };
beforeEach(async () => {
  await resetOperationalData();
  a = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Actor sintético A' });
  b = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Actor sintético B' });
  supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisor sintético' });
  const shift = await createShift({ userId: a.id, type: 'DIA', status: 'ACTIVO' });
  await fixtureDb.shiftAssignment.updateMany({ where: { shiftId: shift.id, userId: a.id }, data: { activatedAt: new Date() } });
  await fixtureDb.rolePermission.updateMany({ where: { roleId: a.roleId, permission: { key: 'cash.manual_in' } }, data: { requiresApproval: false } });
  state.user = a; state.failWorkflow = false; state.pdf = null;
  // Toda salida HTTP se intercepta. Sólo conexiones PostgreSQL locales son reales.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('salida HTTP bloqueada por reproducción'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await prisma.$disconnect(); await fixtureDb.$disconnect(); });

describe('H01: caracterización de alcances divergentes; no prueba exposición real', () => {
  async function fixtures() {
    const entry = await createEntry(a, base);
    const privateOwn = await createFollowUp(supervisor, { entryId: entry.id, action: 'MARCADOR_PRIVADO', nextAction: 'RESUMEN_PRIVADO', visibility: 'PRIVADO' });
    const privateAssigned = await createFollowUp(supervisor, { entryId: entry.id, action: 'MARCADOR_ASIGNADO', visibility: 'PRIVADO', ownerId: b.id });
    const reserved = await createFollowUp(supervisor, { entryId: entry.id, action: 'MARCADOR_RESERVADO', visibility: 'SUPERVISION' });
    const operational = await createFollowUp(supervisor, { entryId: entry.id, action: 'MARCADOR_OPERATIVO', visibility: 'OPERATIVO' });
    const deleted = await createFollowUp(supervisor, { entryId: entry.id, action: 'MARCADOR_ELIMINADO', visibility: 'PRIVADO' });
    await fixtureDb.followUp.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    return { entry, privateOwn, privateAssigned, reserved, operational, deleted };
  }
  it('Libro devuelve privados/reservados y resúmenes sin contexto de lector; eliminados es opt-in libre', async () => {
    const f = await fixtures(); const normal = await getBookItems({ kinds: ['followup'] });
    expect(normal.items.map(x => x.id)).toEqual(expect.arrayContaining([f.privateOwn.id, f.reserved.id]));
    expect(normal.items.find(x => x.id === f.privateOwn.id)?.summary).toContain('RESUMEN_PRIVADO');
    expect(normal.items.map(x => x.id)).not.toContain(f.deleted.id);
    expect((await getBookItems({ kinds: ['followup'], includeDeleted: true })).items.map(x => x.id)).toContain(f.deleted.id);
  });
  it('informe de B sin permiso proyecta contenido eliminado y lo incluye en contador', async () => {
    await fixtures(); state.user = b;
    const response = await report({ url: 'https://synthetic.invalid/api/libro/reporte?clase=followup&eliminados=1' } as Parameters<typeof report>[0]);
    expect(response.status).toBe(200);
    expect(state.pdf?.lines.join('\n')).toContain('MARCADOR_PRIVADO');
    expect(state.pdf?.lines.join('\n')).toContain('MARCADOR_ELIMINADO');
    expect(state.pdf?.subtitle).toContain('Registros: 5');
  });
  it('búsqueda filtra; Fronti permite privado de otro asignado a B y operativo ajeno', async () => {
    const f = await fixtures();
    const search = await searchOperationalRecords(b, 'MARCADOR');
    expect(search.map(x => x.entityId)).not.toContain(f.privateAssigned.id);
    expect(search.map(x => x.entityId)).not.toContain(f.reserved.id);
    expect(search.map(x => x.entityId)).not.toContain(f.operational.id);
    expect(search.map(x => x.entityId)).not.toContain(f.deleted.id);
    expect((await searchOperationalRecords(supervisor, 'MARCADOR')).map(x => x.entityId)).toContain(f.privateOwn.id);
    const fronti = await executeFrontiV2ReadTool(b, 'consultar_seguimientos', { onlyOpen: false });
    const rows = (fronti.result as { items: { id: string }[] }).items;
    expect(rows.map(x => x.id)).toEqual(expect.arrayContaining([f.privateAssigned.id, f.operational.id]));
    expect(rows.map(x => x.id)).not.toContain(f.deleted.id);
  });
  it('historia asociada y metadatos de entrada cuentan/proyectan seguimientos privados', async () => {
    const f = await fixtures();
    expect((await getHistory({ entity: 'OperationalEntry', entityId: f.entry.id })).map(x => x.summary)).toContain('MARCADOR_PRIVADO');
    expect((await getEntry(f.entry.id))._count.followUps).toBe(5);
  });
  it('Fronti acepta reservado con supervision.view aun sin supervision.followup.manage', async () => {
    const f = await fixtures();
    const reader = { ...b, permissions: [...b.permissions.filter(p => p !== 'supervision.followup.manage'), 'supervision.view' as const] };
    const result = await executeFrontiV2ReadTool(reader, 'consultar_seguimientos', { onlyOpen: false });
    expect((result.result as { items: { id: string }[] }).items.map(x => x.id)).toContain(f.reserved.id);
  });
});

function cashForm(key: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ direction: 'ENTRADA', currency: 'CLP', amount: '1000', reference: 'Operación sintética', requestKey: key })) form.set(k, v);
  return form;
}
describe('H02: doble efecto de misma operación; dos legítimas iguales siguen permitidas', () => {
  it.each(['manual', 'regularizacion', 'solicitud'] as const)('%s: doble envío concurrente crea dos efectos', async kind => {
    state.user = kind === 'regularizacion' ? supervisor : a;
    if (kind === 'solicitud') await fixtureDb.rolePermission.updateMany({ where: { roleId: a.roleId, permission: { key: 'cash.manual_in' } }, data: { requiresApproval: true } });
    const action = kind === 'regularizacion' ? createCashDifferenceRegularizationAction : createManualCashMovementAction;
    const key = randomUUID(); const results = await Promise.all([action(null, cashForm(key)), action(null, cashForm(key))]);
    expect(results.every(x => x.ok)).toBe(true);
    expect(new Set(results.map(x => x.ok ? x.id : null)).size).toBe(2);
    expect(await fixtureDb.cashMovement.count()).toBe(kind === 'solicitud' ? 0 : 2);
    if (kind !== 'solicitud') expect(Number((await fixtureDb.cashMovement.aggregate({ _sum: { amount: true } }))._sum.amount)).toBe(2000);
    expect(await fixtureDb.operationalEntry.count({ where: { category: 'AJUSTE_CAJA_SOLICITADO' } })).toBe(kind === 'solicitud' ? 2 : 0);
  });
  it.each(['manual', 'regularizacion', 'solicitud'] as const)('%s: respuesta descartada tras commit y reintento duplican', async kind => {
    state.user = kind === 'regularizacion' ? supervisor : a;
    if (kind === 'solicitud') await fixtureDb.rolePermission.updateMany({ where: { roleId: a.roleId, permission: { key: 'cash.manual_in' } }, data: { requiresApproval: true } });
    const action = kind === 'regularizacion' ? createCashDifferenceRegularizationAction : createManualCashMovementAction;
    const key = randomUUID(); const discarded = await action(null, cashForm(key)); expect(discarded.ok).toBe(true);
    const retried = await action(null, cashForm(key)); expect(retried.ok).toBe(true);
    expect(discarded.ok && retried.ok && discarded.id !== retried.id).toBe(true);
    expect(await fixtureDb.cashMovement.count()).toBe(kind === 'solicitud' ? 0 : 2);
  });
  it('control: dos operaciones legítimas iguales con distintas claves son posibles', async () => {
    // Restablecer política sintética modificada por los casos anteriores.
    await fixtureDb.rolePermission.updateMany({ where: { roleId: a.roleId, permission: { key: 'cash.manual_in' } }, data: { requiresApproval: false } });
    const results = await Promise.all([createManualCashMovementAction(null, cashForm(randomUUID())), createManualCashMovementAction(null, cashForm(randomUUID()))]);
    expect(results.every(x => x.ok)).toBe(true); expect(await fixtureDb.cashMovement.count()).toBe(2);
  });
});

// Barrier después de DOS lecturas reales, antes de las escrituras reales; sin sleeps.
function staleReadBarrier(model: 'operationalEntry' | 'followUp') {
  const delegate = prisma[model]; const original = delegate.findFirst.bind(delegate);
  let arrived = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(delegate, 'findFirst').mockImplementation((async (...args: unknown[]) => {
    const row = await (original as (...args: unknown[]) => Promise<unknown>)(...args);
    arrived++; if (arrived === 2) release(); await gate; return row;
  }) as never);
}
describe('H03/H05: dos clientes leen la misma revisión; continuidad falla después del commit', () => {
  it('dos ediciones incompatibles de Novedad se aceptan y una queda sobrescrita', async () => {
    const entry = await createEntry(a, base); staleReadBarrier('operationalEntry');
    const results = await Promise.all([updateEntry(a, { id: entry.id, description: 'Cambio sintético A' }), updateEntry(b, { id: entry.id, description: 'Cambio sintético B' })]);
    expect(results).toHaveLength(2);
    expect(['Cambio sintético A', 'Cambio sintético B']).toContain((await fixtureDb.operationalEntry.findUniqueOrThrow({ where: { id: entry.id } })).description);
    expect(await fixtureDb.auditLog.count({ where: { entityId: entry.id, action: 'EDITAR' } })).toBe(2);
  });
  it('dos cambios incompatibles de estado de Novedad se aceptan', async () => {
    const entry = await createEntry(a, base); staleReadBarrier('operationalEntry');
    const results = await Promise.all([changeEntryStatus(supervisor, { id: entry.id, status: 'EN_ESPERA' }), changeEntryStatus(supervisor, { id: entry.id, status: 'CERRADO' })]);
    expect(results.map(x => x.status).sort()).toEqual(['CERRADO', 'EN_ESPERA']);
  });
  it('dos resoluciones incompatibles de Seguimiento se aceptan', async () => {
    const entry = await createEntry(a, base); const follow = await createFollowUp(a, { entryId: entry.id, action: 'Continuidad sintética' }); staleReadBarrier('followUp');
    const results = await Promise.all([updateFollowUp(a, { id: follow.id, status: 'CUMPLIDO', result: 'Resultado A' }), updateFollowUp(a, { id: follow.id, status: 'CANCELADO', result: 'Resultado B' })]);
    expect(results.map(x => x.status).sort()).toEqual(['CANCELADO', 'CUMPLIDO']);
  });
  it('un seguimiento añadido después de validar cierre queda pendiente en registro cerrado', async () => {
    const entry = await createEntry(a, base);
    const original = prisma.followUp.count.bind(prisma.followUp);
    vi.spyOn(prisma.followUp, 'count').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const count = await original(args);
      await createFollowUp(a, { entryId: entry.id, action: 'Creado entre validación y cierre' });
      return count;
    }) as never);
    expect((await changeEntryStatus(supervisor, { id: entry.id, status: 'CERRADO' })).status).toBe('CERRADO');
    expect(await fixtureDb.followUp.count({ where: { entryId: entry.id, status: 'PENDIENTE' } })).toBe(1);
  });
  it('fallo del segundo commit deja incidencia guardada, comunica error y retry crea otra', async () => {
    state.user = supervisor; state.failWorkflow = true;
    const form = () => { const f = new FormData(); for (const [k, v] of Object.entries({ ...base, type: 'INCIDENCIA', severity: 'ALTA', tags: '', requiresFollowUp: 'on', requestKey: 'misma-operacion-sintetica' })) f.set(k, String(v)); return f; };
    const failed = await createEntryAction(null, form()); expect(failed.ok).toBe(false);
    expect(await fixtureDb.operationalEntry.count({ where: { type: 'INCIDENCIA' } })).toBe(1);
    expect(await fixtureDb.task.count()).toBe(0); expect(await fixtureDb.followUp.count()).toBe(0);
    state.failWorkflow = false; const retried = await createEntryAction(null, form()); expect(retried.ok).toBe(true);
    expect(await fixtureDb.operationalEntry.count({ where: { type: 'INCIDENCIA' } })).toBe(2);
    expect(await fixtureDb.task.count()).toBe(1); expect(await fixtureDb.followUp.count()).toBe(1);
  });
});

describe('H04: misma entidad INCIDENCIA, distinto contrato de creación', () => {
  it('derivación conserva vínculo único pero omite gravedad y continuidad habitual', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const area = await fixtureDb.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } });
    await fixtureDb.user.update({ where: { id: admin.id }, data: { departmentId: area.id } });
    admin.departmentId = area.id;
    const room = await fixtureDb.room.findUniqueOrThrow({ where: { number: '512' } });
    const work = await createHkWork(admin, { requestKey: randomUUID(), title: 'Trabajo sintético', description: 'Descripción sintética para derivación', departmentId: area.id, workDate: hotelDateKey(new Date()), workKind: 'LIMPIEZA', roomId: room.id, priority: 'ALTA', effortMinutes: 35 });
    // Fixture sintético en estado bloqueado, no acción real sobre un cuarto.
    await fixtureDb.housekeepingRequest.update({ where: { id: work.id }, data: { status: 'BLOQUEADO', blockReason: 'Falla sintética' } });
    const changed = await changeHkWork(admin, { id: work.id, version: work.version, action: 'MANTENIMIENTO', note: 'Reparación sintética requerida' });
    const entry = await fixtureDb.operationalEntry.findUniqueOrThrow({ where: { id: changed.maintenanceEntryId! } });
    expect(entry.type).toBe('INCIDENCIA'); expect(entry.severity).toBeNull(); expect(entry.ownerId).toBeNull();
    expect(await fixtureDb.task.count({ where: { entryId: entry.id } })).toBe(0);
    expect(await fixtureDb.followUp.count({ where: { entryId: entry.id } })).toBe(0);
    expect(await fixtureDb.auditLog.count({ where: { entityId: entry.id, action: 'CREAR' } })).toBe(1);
    await expect(changeHkWork(admin, { id: work.id, version: changed.version, action: 'MANTENIMIENTO', note: 'Reintento sintético' })).rejects.toThrow('Ya existe');
    expect(await fixtureDb.operationalEntry.count({ where: { type: 'INCIDENCIA' } })).toBe(1);
  });
});

describe('H06/H07: PostgreSQL real con proveedor sintético interceptado', () => {
  const old = new Date('2026-01-01T00:00:00Z'); const next = new Date('2026-01-01T00:00:01Z');
  async function sub(user = a, endpoint = 'https://synthetic.invalid/a') { return fixtureDb.pushSubscription.create({ data: { userId: user.id, endpoint, createdAt: old, lastTriggeredAt: old, lastDeliveredAt: old } }); }
  async function notice(user = a, count = 1) { for (let i = 0; i < count; i++) await fixtureDb.notification.create({ data: { userId: user.id, type: 'ALARMA', title: `Aviso sintético ${i}`, body: `Cuerpo ${i}`, createdAt: next } }); }
  it.each([201, 410, 503])('eliminación concurrente y HTTP %i abortan con P2025 y dejan siguiente destinatario sin intentar', async status => {
    const first = await sub(); const second = await sub(b, 'https://synthetic.invalid/b'); await notice(); await notice(b);
    // Fuerza orden de snapshot, sin reemplazar la consulta real.
    const original = prisma.pushSubscription.findMany.bind(prisma.pushSubscription);
    vi.spyOn(prisma.pushSubscription, 'findMany').mockImplementation((async (args: Parameters<typeof original>[0]) => (await original(args)).sort((x, y) => Number(y.id === first.id) - Number(x.id === first.id))) as never);
    const fetch = vi.fn(async () => { await fixtureDb.pushSubscription.delete({ where: { id: first.id } }); return new Response(null, { status }); }); vi.stubGlobal('fetch', fetch);
    await expect(dispatchWebPushForUsers([a.id, b.id])).rejects.toMatchObject({ code: 'P2025' });
    expect(fetch).toHaveBeenCalledTimes(1); expect((await fixtureDb.pushSubscription.findUniqueOrThrow({ where: { id: second.id } })).lastTriggeredAt).toEqual(old);
  });
  it('control: rechazo ordinario de proveedor no aborta otros destinatarios', async () => {
    await sub(); await sub(b, 'https://synthetic.invalid/b'); await notice(); await notice(b);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 201 })));
    expect(await dispatchWebPushForUsers([a.id, b.id])).toMatchObject({ attempted: 2, sent: 1, failed: 1 });
  });
  it('aceptación del proveedor sólo adelanta señal: no acredita payload ni lectura', async () => {
    const subscription = await sub(); await notice();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
    expect(await dispatchWebPushForUsers([a.id])).toMatchObject({ sent: 1 });
    const persisted = await fixtureDb.pushSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(persisted.lastSuccessAt).not.toBeNull(); expect(persisted.lastDeliveredAt).toEqual(old);
    expect(await fixtureDb.notification.count({ where: { userId: a.id, readAt: null } })).toBe(1);
  });
  it('respuesta perdida del proveedor deja señal reintentable aunque pudo aceptarse', async () => {
    await sub(); await notice(); let accepted = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { accepted++; throw new Error('respuesta perdida después de aceptación sintética'); }));
    expect(await dispatchWebPushForUsers([a.id])).toMatchObject({ failed: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => { accepted++; return new Response(null, { status: 201 }); }));
    expect(await dispatchWebPushForUsers([a.id])).toMatchObject({ sent: 1 }); expect(accepted).toBe(2);
  });
  it('payload obtenido y respuesta descartada: retry no recupera aviso aunque sigue no leído', async () => {
    await sub(); await notice(); expect((await getWebPushPayload({ userId: a.id, endpoint: 'https://synthetic.invalid/a' })).newCount).toBe(1);
    expect((await getWebPushPayload({ userId: a.id, endpoint: 'https://synthetic.invalid/a' })).newCount).toBe(0);
    expect(await fixtureDb.notification.count({ where: { userId: a.id, readAt: null } })).toBe(1);
  });
  it('reconciliación del mismo endpoint adelanta cursor y pierde pendientes del payload', async () => {
    await sub(); await notice(); await registerWebPushSubscription({ userId: a.id, endpoint: 'https://synthetic.invalid/a' });
    expect((await getWebPushPayload({ userId: a.id, endpoint: 'https://synthetic.invalid/a' })).newCount).toBe(0);
    expect(await fixtureDb.notification.count({ where: { userId: a.id, readAt: null } })).toBe(1);
  });
  it('21 avisos con mismo timestamp: lee 20, muestra hasta 3 y retry pierde el restante', async () => {
    await sub(); await notice(a, 21); const first = await getWebPushPayload({ userId: a.id, endpoint: 'https://synthetic.invalid/a' });
    expect(first.newCount).toBe(20); expect(first.items.length).toBeLessThanOrEqual(3);
    expect((await getWebPushPayload({ userId: a.id, endpoint: 'https://synthetic.invalid/a' })).newCount).toBe(0);
    expect(await fixtureDb.notification.count({ where: { userId: a.id, readAt: null } })).toBe(21);
  });
});
