import { randomUUID } from 'node:crypto';
import { AuditAction, Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma as servicePrisma } from '@/lib/prisma';
import { MAINTENANCE_DEFAULT, MAINTENANCE_MESSAGE, MAINTENANCE_SETTING_KEY } from '@/domain/system-maintenance';
import type { CurrentUser } from '@/server/auth/current-user';
import type * as CurrentUserModule from '@/server/auth/current-user';
import type * as LegalAcceptanceModule from '@/server/services/legal-acceptance';
import { requireAuthenticatedUser, requirePageUser, requireUser } from '@/server/auth/guard';
import { setSystemMaintenanceAction } from '@/server/actions/system-maintenance';
import { maintenanceCronResponse, withMaintenance } from '@/server/api/maintenance';
import {
  assertMaintenanceAccess,
  getMaintenanceState,
  maintenanceBlocksBackground,
  maintenanceStateFromRow,
  setSystemMaintenance,
} from '@/server/services/system-maintenance';
import { GET as maintenanceStatus } from '@/app/api/maintenance/route';
import { GET as memoryCron } from '@/app/api/cron/ai-memory/route';
import { GET as proactiveCron } from '@/app/api/cron/fronti-proactive/route';
import { GET as mailCron } from '@/app/api/cron/operational-mail/route';
import { GET as pushCron } from '@/app/api/cron/web-push/route';
import { createShift, createUser, prisma, resetOperationalData, ROLE_KEYS, seedCatalog, ShiftStatus, ShiftType } from './helpers';

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), revalidatePath: vi.fn() }));
const effects = vi.hoisted(() => ({
  automations: vi.fn(), coordination: vi.fn(), retention: vi.fn(), alerts: vi.fn(),
  fronti: vi.fn(), mail: vi.fn(), housekeeping: vi.fn(), alarms: vi.fn(), push: vi.fn(),
}));
vi.mock('@/server/auth/current-user', async importOriginal => ({
  ...await importOriginal<typeof CurrentUserModule>(),
  getCurrentUserFresh: mocks.currentUser,
}));
vi.mock('@/server/services/legal-acceptance', async importOriginal => ({
  ...await importOriginal<typeof LegalAcceptanceModule>(),
  hasAcceptedCurrentTerms: vi.fn(async () => true),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/server/services/operational-automation', () => ({ runOperationalAutomations: effects.automations }));
vi.mock('@/server/services/coordination', () => ({ escalateUnreceivedWork: effects.coordination }));
vi.mock('@/server/ai/retention-policy', () => ({ enforceFrontiRetentionPolicy: effects.retention }));
vi.mock('@/server/services/alert-engine', () => ({ runAlertEngine: effects.alerts }));
vi.mock('@/server/ai/fronti-proactive', () => ({ runFrontiProactiveSweep: effects.fronti }));
vi.mock('@/server/services/operational-mail', () => ({ flushOperationalMailOutbox: effects.mail }));
vi.mock('@/server/services/housekeeping', () => ({ escalateHousekeepingRequests: effects.housekeeping }));
vi.mock('@/server/services/operational-alarms', () => ({ dispatchDueAlarmsForAllUsers: effects.alarms }));
vi.mock('@/server/services/web-push', () => ({ flushWebPushSubscriptions: effects.push }));

let admin: CurrentUser;
let receptionist: CurrentUser;
const nonAdminUsers = new Map<string, CurrentUser>();
const nonAdminRoles = Object.values(ROLE_KEYS).filter(key => key !== ROLE_KEYS.SYSTEM_ADMIN);
const cronSecret = 'maintenance-cron-synthetic-only';
const crons = [
  { name: 'memoria', handler: memoryCron, expected: ['retention'] },
  { name: 'Fronti', handler: proactiveCron, expected: ['alerts', 'fronti'] },
  { name: 'correo', handler: mailCron, expected: ['mail'] },
  { name: 'push y automatizaciones', handler: pushCron, expected: ['automations', 'coordination', 'housekeeping', 'alarms', 'push'] },
];

beforeAll(async () => {
  await resetOperationalData();
  await seedCatalog();
  admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administración de prueba de mantenimiento' });
  for (const roleKey of nonAdminRoles) nonAdminUsers.set(roleKey, await createUser({ roleKey }));
  receptionist = nonAdminUsers.get(ROLE_KEYS.RECEPTIONIST)!;
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entity: 'SystemMaintenance' } });
  await prisma.systemSetting.deleteMany({ where: { key: MAINTENANCE_SETTING_KEY } });
  mocks.currentUser.mockReset().mockResolvedValue(null);
  mocks.revalidatePath.mockReset();
  for (const effect of Object.values(effects)) effect.mockReset().mockResolvedValue({});
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await resetOperationalData(); await prisma.$disconnect(); });

async function setEnabled(enabled: boolean) {
  const state = await getMaintenanceState();
  return setSystemMaintenance(admin, { enabled, expectedRevision: state.revision });
}

async function formFor(enabled: boolean) {
  const form = new FormData();
  form.set('enabled', String(enabled));
  form.set('revision', (await getMaintenanceState()).revision);
  form.set('confirm', 'on');
  return form;
}

function cronRequest(authorized = true) {
  return new Request('https://synthetic.invalid/api/cron/maintenance', {
    headers: authorized ? { authorization: `Bearer ${cronSecret}` } : {},
  });
}

async function expectMaintenance(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('retry-after')).toBe('60');
  expect(await response.json()).toEqual({ ok: false, code: 'MAINTENANCE', error: MAINTENANCE_MESSAGE });
}

/** Compare complete rows, including credentials, permissions, queues and operational evidence. */
async function unaffectedDatabaseSnapshot() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('SystemSetting', 'AuditLog', '_prisma_migrations')
    ORDER BY table_name`;
  const snapshot: Record<string, unknown> = {};
  for (const { table_name: name } of tables) {
    const identifier = Prisma.raw(`"${name.replaceAll('"', '""')}"`);
    const [result] = await prisma.$queryRaw<Array<{ rows: unknown }>>(Prisma.sql`
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
      FROM ${identifier} t`);
    snapshot[name] = result?.rows;
  }
  snapshot.otherSettings = await prisma.systemSetting.findMany({
    where: { key: { not: MAINTENANCE_SETTING_KEY } }, orderBy: { key: 'asc' },
  });
  snapshot.otherAudit = await prisma.auditLog.findMany({
    where: { entity: { not: 'SystemMaintenance' } }, orderBy: { id: 'asc' },
  });
  return snapshot;
}

describe('mantenimiento temporal · estado duradero y control exclusivo', () => {
  it('empieza desactivado cuando no existe el control, con el mensaje solicitado exacto', async () => {
    expect(MAINTENANCE_MESSAGE).toBe('Trabajos de mantenimiento programados por actualizaciones importantes.');
    expect(await getMaintenanceState()).toEqual({ ...MAINTENANCE_DEFAULT, valid: true, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(await prisma.systemSetting.count({ where: { key: MAINTENANCE_SETTING_KEY } })).toBe(0);
  });

  it('activa y desactiva de forma persistida, con revisión nueva y fecha sólo mientras está activo', async () => {
    const initial = await getMaintenanceState();
    const enabled = await setEnabled(true);
    expect(enabled).toEqual({ enabled: true, message: MAINTENANCE_MESSAGE, startedAt: expect.any(String), valid: true, revision: expect.any(String) });
    expect(new Date(enabled.startedAt!).toISOString()).toBe(enabled.startedAt);
    expect(enabled.revision).not.toBe(initial.revision);
    expect(await getMaintenanceState()).toEqual(enabled);
    const disabled = await setEnabled(false);
    expect(disabled).toMatchObject({ enabled: false, startedAt: null, message: MAINTENANCE_MESSAGE, valid: true });
    expect(disabled.revision).not.toBe(enabled.revision);
    expect(await getMaintenanceState()).toEqual(disabled);
  });

  it('otro cliente y otra lectura observan inmediatamente el mismo control sin caché local', async () => {
    const enabled = await setEnabled(true);
    const anotherInstance = new PrismaClient();
    try {
      const row = await anotherInstance.systemSetting.findUniqueOrThrow({ where: { key: MAINTENANCE_SETTING_KEY } });
      expect(maintenanceStateFromRow(row)).toEqual(enabled);
      const committed = await anotherInstance.systemSetting.update({
        where: { key: MAINTENANCE_SETTING_KEY }, data: { value: { ...MAINTENANCE_DEFAULT } },
      });
      expect(await getMaintenanceState()).toEqual(maintenanceStateFromRow(committed));
      expect((await getMaintenanceState()).enabled).toBe(false);
    } finally { await anotherInstance.$disconnect(); }
  });

  it.each(nonAdminRoles)('rechaza el rol %s aunque tenga system.configure', async roleKey => {
    const user = nonAdminUsers.get(roleKey)!;
    const initial = await getMaintenanceState();
    await expect(setSystemMaintenance({ ...user, permissions: ['system.configure'] }, {
      enabled: true, expectedRevision: initial.revision,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await getMaintenanceState()).toEqual(initial);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemMaintenance' } })).toBe(0);
  });

  it('rechaza revisiones malformadas sin cambiar el control', async () => {
    await expect(setSystemMaintenance(admin, { enabled: true, expectedRevision: '' })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect((await getMaintenanceState()).enabled).toBe(false);
  });

  it('impide reabrir con una confirmación anterior', async () => {
    const before = await getMaintenanceState();
    const active = await setEnabled(true);
    await expect(setSystemMaintenance(admin, { enabled: false, expectedRevision: before.revision })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect(await getMaintenanceState()).toEqual(active);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemMaintenance' } })).toBe(1);
  });

  it('serializa confirmaciones concurrentes: una escritura y una revisión obsoleta', async () => {
    const before = await getMaintenanceState();
    const results = await Promise.allSettled([
      setSystemMaintenance(admin, { enabled: true, expectedRevision: before.revision }),
      setSystemMaintenance(admin, { enabled: true, expectedRevision: before.revision }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'RULE_VIOLATION' }) }),
    ]);
    expect((await getMaintenanceState()).enabled).toBe(true);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemMaintenance' } })).toBe(1);
  });

  it('un reintento con estado y revisión vigentes no añade cambios ni auditoría duplicada', async () => {
    const active = await setEnabled(true);
    expect(await setSystemMaintenance(admin, { enabled: true, expectedRevision: active.revision })).toEqual(active);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemMaintenance' } })).toBe(1);
  });

  const corruptValues = [
    { name: 'JSON null', value: Prisma.JsonNull },
    { name: 'objeto vacío', value: {} },
    { name: 'booleano en lugar de objeto', value: false },
    { name: 'enabled de tipo incorrecto', value: { enabled: 'false', message: MAINTENANCE_MESSAGE, startedAt: null } },
    { name: 'aviso vacío', value: { enabled: false, message: '', startedAt: null } },
    { name: 'fecha inválida', value: { enabled: false, message: MAINTENANCE_MESSAGE, startedAt: 'ayer' } },
  ];
  it.each(corruptValues)('falla cerrado ante $name y permite reparación auditada', async ({ value }) => {
    await prisma.systemSetting.create({ data: { key: MAINTENANCE_SETTING_KEY, value } });
    const corrupt = await getMaintenanceState();
    expect(corrupt).toMatchObject({ enabled: true, valid: false, message: MAINTENANCE_MESSAGE });
    await expect(assertMaintenanceAccess(receptionist)).rejects.toMatchObject({ code: 'MAINTENANCE' });
    const fixed = await setSystemMaintenance(admin, { enabled: false, expectedRevision: corrupt.revision });
    expect(fixed).toMatchObject({ enabled: false, valid: true, startedAt: null });
    const logs = await prisma.auditLog.findMany({ where: { entity: 'SystemMaintenance' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.before).toEqual(value === Prisma.JsonNull ? null : value);
  });

  it('registra ambas transiciones con autor, sesión, antes y después', async () => {
    const active = await setEnabled(true);
    await setEnabled(false);
    const logs = await prisma.auditLog.findMany({ where: { entity: 'SystemMaintenance' }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(2);
    const setting = await prisma.systemSetting.findUniqueOrThrow({ where: { key: MAINTENANCE_SETTING_KEY } });
    expect(setting.updatedById).toBe(admin.id);
    for (const log of logs) expect(log).toMatchObject({ entityId: setting.id, action: AuditAction.CONFIGURAR, userId: admin.id, sessionId: admin.sessionId });
    expect(logs[0]?.before).toEqual(MAINTENANCE_DEFAULT);
    expect(logs[0]?.after).toEqual({ enabled: true, message: MAINTENANCE_MESSAGE, startedAt: active.startedAt });
    expect(logs[1]?.before).toEqual(logs[0]?.after);
    expect(logs[1]?.after).toEqual(MAINTENANCE_DEFAULT);
  });

  it('revierte la escritura PostgreSQL si no puede persistir la auditoría', async () => {
    const initial = await getMaintenanceState();
    const realTransaction = servicePrisma.$transaction.bind(servicePrisma);
    const transaction = vi.spyOn(servicePrisma, '$transaction');
    transaction.mockImplementation((async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      realTransaction(async tx => {
        const failAudit = vi.spyOn(tx.auditLog, 'create').mockRejectedValueOnce(new Error('Auditoría sintética no disponible'));
        try { return await run(tx); } finally { failAudit.mockRestore(); }
      })) as typeof servicePrisma.$transaction);
    await expect(setSystemMaintenance(admin, { enabled: true, expectedRevision: initial.revision })).rejects.toThrow('Auditoría sintética no disponible');
    transaction.mockRestore();
    expect(await getMaintenanceState()).toEqual(initial);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemMaintenance' } })).toBe(0);
  });

  it('conserva todas las filas operativas, cuentas, sesiones, permisos y colas al activar y reabrir', async () => {
    const shift = await createShift({ userId: receptionist.id, type: ShiftType.DIA, status: ShiftStatus.ACTIVO });
    const room = await prisma.room.findFirstOrThrow({ orderBy: { number: 'asc' } });
    const stay = await prisma.roomStay.create({ data: {
      reservationId: 'MANTENIMIENTO-SINTETICO', roomId: room.id, guestNames: ['Huésped sintético'],
      sourceReport: 'IN_HOUSE', status: 'IN_HOUSE', stage: 'CONFIRMADO', businessDate: new Date('2026-10-05T00:00:00Z'),
    } });
    await prisma.operationalEntry.create({ data: {
      type: 'NOVEDAD', title: 'Pendiente sintético', description: 'Debe conservarse durante la pausa.',
      createdById: receptionist.id, ownerId: receptionist.id, shiftId: shift.id, roomId: room.id, stayId: stay.id,
    } });
    await prisma.cashMovement.create({ data: {
      id: randomUUID(), kind: 'AJUSTE_ENTRADA', direction: 'ENTRADA', currency: 'CLP', amount: 1234,
      createdById: receptionist.id, shiftId: shift.id, roomId: room.id, stayId: stay.id,
    } });
    await prisma.session.create({ data: { userId: receptionist.id, expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.notification.create({ data: { userId: receptionist.id, type: 'ACCION_REQUERIDA', title: 'Aviso pendiente sintético' } });
    const before = await unaffectedDatabaseSnapshot();
    await setEnabled(true);
    expect(await unaffectedDatabaseSnapshot()).toEqual(before);
    await setEnabled(false);
    expect(await unaffectedDatabaseSnapshot()).toEqual(before);
  });
});

describe('mantenimiento temporal · API, acciones y páginas', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('devuelve 503 antes del handler %s de un usuario ordinario', async method => {
    await setEnabled(true);
    mocks.currentUser.mockResolvedValue(receptionist);
    const handler = vi.fn(async (_request: Request) => new Response('No debe ejecutarse'));
    await expectMaintenance(await withMaintenance(handler)(new Request('https://synthetic.invalid/api', { method })));
    expect(handler).not.toHaveBeenCalled();
  });

  it('bloquea al visitante anónimo antes de analizar el cuerpo o realizar efectos', async () => {
    await setEnabled(true);
    const request = new Request('https://synthetic.invalid/api', { method: 'POST', body: 'JSON deliberadamente inválido' });
    const handler = vi.fn(async (input: Request) => Response.json(await input.json()));
    await expectMaintenance(await withMaintenance(handler)(request));
    expect(handler).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it('permite al Administrador y conserva argumentos, estado y cuerpo originales', async () => {
    await setEnabled(true);
    mocks.currentUser.mockResolvedValue(admin);
    const request = new Request('https://synthetic.invalid/api');
    const context = { params: Promise.resolve({ id: 'fixture' }) };
    const response = new Response('Operación administrativa autorizada', { status: 201 });
    const handler = vi.fn(async (_request: Request, _context: typeof context) => response);
    expect(await withMaintenance(handler)(request, context)).toBe(response);
    expect(handler).toHaveBeenCalledExactlyOnceWith(request, context);
  });

  it('desactivado conserva el handler normal y su autenticación propia', async () => {
    const response = new Response('Rechazo nativo de autenticación', { status: 401 });
    const handler = vi.fn(async () => response);
    expect(await withMaintenance(handler)()).toBe(response);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it('consulta el estado otra vez en cada solicitud y reanuda al desactivar', async () => {
    mocks.currentUser.mockResolvedValue(receptionist);
    const handler = vi.fn(async () => new Response('normal'));
    const wrapped = withMaintenance(handler);
    expect((await wrapped()).status).toBe(200);
    await setEnabled(true);
    await expectMaintenance(await wrapped());
    await setEnabled(false);
    expect(await (await wrapped()).text()).toBe('normal');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('un fallo al leer el control devuelve 503 incluso para una sesión administrativa', async () => {
    mocks.currentUser.mockResolvedValue(admin);
    vi.spyOn(servicePrisma.systemSetting, 'findUnique').mockRejectedValueOnce(new Error('DB sintética no disponible'));
    const handler = vi.fn(async () => new Response('No debe ejecutarse'));
    await expectMaintenance(await withMaintenance(handler)());
    expect(handler).not.toHaveBeenCalled();
  });

  it('un fallo al verificar la sesión durante la pausa devuelve 503', async () => {
    await setEnabled(true);
    mocks.currentUser.mockRejectedValueOnce(new Error('Sesión sintética no disponible'));
    const handler = vi.fn(async () => new Response('No debe ejecutarse'));
    await expectMaintenance(await withMaintenance(handler)());
    expect(handler).not.toHaveBeenCalled();
  });

  it('los guards de acciones bloquean al personal y conservan al Administrador', async () => {
    await setEnabled(true);
    mocks.currentUser.mockResolvedValue(receptionist);
    await expect(requireAuthenticatedUser()).rejects.toMatchObject({ code: 'MAINTENANCE', message: MAINTENANCE_MESSAGE });
    await expect(requireUser()).rejects.toMatchObject({ code: 'MAINTENANCE' });
    mocks.currentUser.mockResolvedValue(admin);
    expect(await requireUser()).toBe(admin);
  });

  it('el guard de página redirige antes de cargar operación, incluso con acceso incompleto', async () => {
    await setEnabled(true);
    mocks.currentUser.mockResolvedValue(receptionist);
    await expect(requirePageUser()).rejects.toMatchObject({ digest: expect.stringContaining('/mantenimiento') });
    await expect(requirePageUser({ allowIncompleteAccess: true })).rejects.toMatchObject({ digest: expect.stringContaining('/mantenimiento') });
    mocks.currentUser.mockResolvedValue(admin);
    expect(await requirePageUser()).toBe(admin);
  });

  it('el guard falla cerrado si el control no se puede consultar', async () => {
    vi.spyOn(servicePrisma.systemSetting, 'findUnique').mockRejectedValueOnce(new Error('DB sintética no disponible'));
    await expect(assertMaintenanceAccess(receptionist)).rejects.toMatchObject({ code: 'MAINTENANCE', message: MAINTENANCE_MESSAGE });
  });

  it('el formulario exige confirmación explícita y una revisión antes de mutar', async () => {
    mocks.currentUser.mockResolvedValue(admin);
    const missingConfirmation = await formFor(true);
    missingConfirmation.delete('confirm');
    expect(await setSystemMaintenanceAction(null, missingConfirmation)).toMatchObject({ ok: false, fieldErrors: { confirm: expect.any(Array) } });
    const missingRevision = await formFor(true);
    missingRevision.delete('revision');
    expect(await setSystemMaintenanceAction(null, missingRevision)).toMatchObject({ ok: false, fieldErrors: { revision: expect.any(Array) } });
    expect((await getMaintenanceState()).enabled).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('la acción autenticada no sustituye SysAdmin por un permiso genérico', async () => {
    mocks.currentUser.mockResolvedValue({ ...receptionist, permissions: ['system.configure'] });
    expect(await setSystemMaintenanceAction(null, await formFor(true))).toMatchObject({ ok: false, error: expect.stringContaining('Administrador de sistema') });
    expect((await getMaintenanceState()).enabled).toBe(false);
  });

  it('la acción administrativa activa, revalida y permite reabrir desde el estado activo', async () => {
    mocks.currentUser.mockResolvedValue(admin);
    expect(await setSystemMaintenanceAction(null, await formFor(true))).toMatchObject({ ok: true });
    expect((await getMaintenanceState()).enabled).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await setSystemMaintenanceAction(null, await formFor(false))).toMatchObject({ ok: true });
    expect((await getMaintenanceState()).enabled).toBe(false);
  });

  it('la consulta pública sólo expone disponibilidad y mensaje, sin revisión ni datos de cuenta', async () => {
    const inactive = await maintenanceStatus();
    expect(await inactive.json()).toEqual({ enabled: false, message: null });
    await setEnabled(true);
    const active = await maintenanceStatus();
    expect(active.headers.get('cache-control')).toBe('no-store');
    expect(await active.json()).toEqual({ enabled: true, message: MAINTENANCE_MESSAGE });
  });

  it('la consulta pública indica mantenimiento si falla PostgreSQL', async () => {
    vi.spyOn(servicePrisma.systemSetting, 'findUnique').mockRejectedValueOnce(new Error('DB sintética no disponible'));
    expect(await (await maintenanceStatus()).json()).toEqual({ enabled: true, message: MAINTENANCE_MESSAGE });
  });
});

describe('mantenimiento temporal · procesos automáticos', () => {
  it('el control de background y la respuesta cron fallan cerrados si falla PostgreSQL', async () => {
    vi.spyOn(servicePrisma.systemSetting, 'findUnique').mockRejectedValue(new Error('DB sintética no disponible'));
    expect(await maintenanceBlocksBackground()).toBe(true);
    const response = await maintenanceCronResponse();
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true, skipped: 'maintenance' });
  });

  for (const { name, handler, expected } of crons) {
    it(`${name}: el cron autorizado se omite sin ejecutar ningún servicio mientras está activo`, async () => {
      vi.stubEnv('CRON_SECRET', cronSecret);
      await setEnabled(true);
      const response = await handler(cronRequest());
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ ok: true, skipped: 'maintenance' });
      for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
    });

    it(`${name}: conserva autenticación antes de consultar mantenimiento`, async () => {
      vi.stubEnv('CRON_SECRET', cronSecret);
      await setEnabled(true);
      const read = vi.spyOn(servicePrisma.systemSetting, 'findUnique');
      expect((await handler(cronRequest(false))).status).toBe(401);
      expect(read).not.toHaveBeenCalled();
      for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
    });

    it(`${name}: reanuda los servicios originales al reabrir`, async () => {
      vi.stubEnv('CRON_SECRET', cronSecret);
      await setEnabled(true);
      await setEnabled(false);
      expect((await handler(cronRequest())).status).toBe(200);
      for (const [key, effect] of Object.entries(effects)) expect(effect).toHaveBeenCalledTimes(expected.includes(key) ? 1 : 0);
    });
  }
});
