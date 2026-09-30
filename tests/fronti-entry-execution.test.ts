import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/server/auth/current-user';
import type { FrontiConfig } from '@/server/ai/fronti-config';

const m = vi.hoisted(() => ({
  chat: vi.fn(), createEntry: vi.fn(), users: vi.fn(), workflow: vi.fn(), revalidate: vi.fn(),
  used: new Set<string>(),
}));
vi.mock('@/lib/env', () => ({ env: () => ({ AUTH_SECRET: 'fronti-test-only-signing-key-not-production', HOTEL_TIMEZONE: 'America/Santiago', FRONTI_PROVIDER: 'groq', FRONTI_MODEL: 'openai/gpt-oss-120b' }) }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  room: { findFirst: vi.fn(async ({ where }: { where: { number: string } }) => where.number === '514' ? { id: 'room-test' } : null) },
  department: {
    findMany: vi.fn(async () => [{ id: 'reception-test', name: 'Recepción', key: 'RECEPCION' }]),
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => where.id === 'reception-test' ? { id: where.id } : null),
  },
  assistantActionReceipt: {
    create: vi.fn(async ({ data }: { data: { nonce: string } }) => {
      if (m.used.has(data.nonce)) throw Object.assign(new Error('Duplicado'), { code: 'P2002' });
      m.used.add(data.nonce); return data;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { nonce: string } }) => { m.used.delete(where.nonce); return { count: 1 }; }),
  },
} }));
vi.mock('@/server/services/users', () => ({ listOperationalUsers: m.users, listSupervisorIds: vi.fn(async () => []), assertAssignable: vi.fn() }));
vi.mock('@/server/services/entries', () => ({ createEntry: m.createEntry }));
vi.mock('@/server/services/incident-workflow', () => ({ ensureIncidentWorkflow: m.workflow }));
vi.mock('@/server/services/reception-operation-gate', () => ({
  getReceptionOperationGate: vi.fn(async () => ({ mode: 'ACTIVE' })),
  assertReceptionOperationPermission: vi.fn(async (user: CurrentUser, permission: string) => {
    if (!user.permissions.some((value) => value === permission)) throw new Error('No tienes permiso para esa acción.');
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate, unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock('@/server/ai/fronti-provider', () => ({
  chatWithFrontiProviderChain: m.chat,
  resolveFrontiProviderChainRuntime: vi.fn(async () => [{ provider: 'groq', model: 'test-model' }]),
  FrontiProviderError: class FrontiProviderError extends Error {},
}));
vi.mock('@/server/ai/fronti-v2/telemetry', () => ({ startFrontiAgentRun: () => ({ startedAt: new Date() }), recordFrontiAgentRun: vi.fn() }));
vi.mock('@/server/ai/fronti-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ai/fronti-config')>();
  return { ...actual, getFrontiConfig: async () => config };
});

import { runReceptionAssistant, executeReceptionConfirmation } from '@/server/ai/reception-assistant';
import { prepareFrontiEntryDraft, validateFrontiEntryAssignment } from '@/server/ai/fronti-v2/entry-draft';

const config: FrontiConfig = {
  enabled: true, provider: 'groq', displayName: 'Fronti', welcomeMessage: '', extraInstructions: '',
  model: 'test-model', reasoningEffort: 'low', memoryRetentionDays: 30, shiftMemoryHours: 36,
  memoryContextLimit: 12, modelHistoryLimit: 15, sessionActivityMinutes: 15,
  tools: { room: true, priorities: true, deadlines: true, checkout: true, reminder: true, fine: true },
};
const user = { id: 'operator-test', name: 'Operador de prueba', roleKey: 'SUPERVISOR', isSystemAdmin: false, departmentId: 'reception-test', permissions: ['entry.create', 'incident.create'] } as CurrentUser;
const args = { type: 'NOVEDAD', title: 'Pago faltante hab 514', description: null, roomNumber: '514', priority: 'CRITICA', severity: null, requiresFollowUp: false, responsible: 'área recepción.', dueAt: 'hoy a las 21:00' };

function proposalResponse(input: Record<string, unknown> = args, repeated = false) {
  const call = { id: 'call-test', type: 'function', function: { name: 'proponer_registro', arguments: JSON.stringify(input) } };
  return { text: 'Ya está creada.', toolCalls: repeated ? [call, { ...call, id: 'call-test-2' }] : [call], assistantMessage: { role: 'assistant', content: null, tool_calls: [call] }, providerUsed: 'groq', modelUsed: 'test-model' };
}
async function propose(input: Record<string, unknown> = args) {
  m.chat.mockResolvedValueOnce(proposalResponse(input));
  return runReceptionAssistant(user, [
    { role: 'user', content: 'Crea una novedad' },
    { role: 'assistant', content: '¿Qué ocurrió?' },
    { role: 'user', content: 'Título: Pago faltante hab 514. Responsable: recepción. Prioridad: crítica. Vence hoy a las 21:00.' },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks(); m.chat.mockReset(); m.used.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T21:40:00Z'));
  m.users.mockResolvedValue([{ id: 'person-test', name: 'María Prueba', username: 'maria', department: { id: 'reception-test', name: 'Recepción' } }]);
  m.workflow.mockResolvedValue(undefined);
  m.createEntry.mockImplementation(async (_user: unknown, input: { title: string }) => ({ id: 'entry-test', humanId: 7123, title: input.title }));
});
afterEach(() => vi.useRealTimers());

describe('Fronti · ejecución de novedades sin producción ni proveedor externo', () => {
  it('prepara una tarjeta, no guarda anticipadamente y no depende de una segunda respuesta del modelo', async () => {
    const result = await propose();
    expect(result.confirmations).toHaveLength(1);
    expect(result.reply).toContain('todavía no');
    expect(result.reply).not.toContain('Ya está creada');
    expect(result.confirmations[0]!.detail).toContain('Área: Recepción');
    expect(result.confirmations[0]!.detail).toContain('21:00');
    expect(m.createEntry).not.toHaveBeenCalled();
    expect(m.chat).toHaveBeenCalledTimes(1);
    const request = m.chat.mock.calls[0]![0] as { tools: Array<{ function: { name: string } }> };
    expect(request.tools.some((tool) => tool.function.name === 'proponer_registro')).toBe(true);
  });
  it('confirma con servicio canónico, fecha, área y enlace al # real; un doble clic no duplica', async () => {
    const result = await propose();
    const token = result.confirmations[0]!.token;
    const saved = await executeReceptionConfirmation(user, token);
    expect(m.createEntry).toHaveBeenCalledWith(user, expect.objectContaining({ dueAt: new Date('2026-10-01T00:00:00Z'), departmentId: 'reception-test', ownerId: null, roomId: 'room-test', priority: 'CRITICA', description: args.title }));
    expect(saved.reply).toContain('#7123');
    expect(saved.reply).toContain('/libro/entry-test');
    expect(m.revalidate).toHaveBeenCalledWith('/libro');
    await expect(executeReceptionConfirmation(user, token)).rejects.toThrow('ya fue usada');
    expect(m.createEntry).toHaveBeenCalledTimes(1);
  });
  it('resuelve nombres del catálogo y persiste la persona correcta', async () => {
    const result = await propose({ ...args, responsible: 'María' });
    await executeReceptionConfirmation(user, result.confirmations[0]!.token);
    expect(m.createEntry).toHaveBeenCalledWith(user, expect.objectContaining({ ownerId: 'person-test' }));
  });
  it('no concede el permiso de creación al confirmar', async () => {
    const result = await propose();
    await expect(executeReceptionConfirmation({ ...user, permissions: [] }, result.confirmations[0]!.token)).rejects.toThrow('permiso');
    expect(m.createEntry).not.toHaveBeenCalled();
  });
  it('rechaza una tarjeta caducada', async () => {
    const result = await propose();
    vi.setSystemTime(new Date('2026-09-30T21:51:00Z'));
    await expect(executeReceptionConfirmation(user, result.confirmations[0]!.token)).rejects.toThrow('venció');
    expect(m.createEntry).not.toHaveBeenCalled();
  });
  it('no prepara dos tarjetas iguales en una respuesta', async () => {
    m.chat.mockResolvedValueOnce(proposalResponse(args, true));
    const result = await runReceptionAssistant(user, [{ role: 'user', content: 'Crea una novedad' }]);
    expect(result.confirmations).toHaveLength(1);
  });
  it('un fallo del seguimiento no vuelve a habilitar una creación ya guardada', async () => {
    m.workflow.mockRejectedValueOnce(new Error('Fallo de seguimiento simulado'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await propose({ ...args, type: 'INCIDENCIA', severity: 'ALTA' });
      const saved = await executeReceptionConfirmation(user, result.confirmations[0]!.token);
      expect(saved.reply).toContain('#7123');
      expect(saved.reply).toContain('seguimiento');
      await expect(executeReceptionConfirmation(user, result.confirmations[0]!.token)).rejects.toThrow('ya fue usada');
      expect(m.createEntry).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
  it('no exige campos opcionales ni inventa una persona', async () => {
    const result = await prepareFrontiEntryDraft(user, { title: 'Puerta con ruido' });
    expect(result.draft).toMatchObject({ description: 'Puerta con ruido', priority: 'MEDIA', ownerId: null, dueAt: null, roomNumber: null });
  });
  it('pide aclaración ante nombres ambiguos', async () => {
    m.users.mockResolvedValue([{ id: 'one', name: 'María Uno', username: 'uno' }, { id: 'two', name: 'María Dos', username: 'dos' }]);
    await expect(prepareFrontiEntryDraft(user, { ...args, responsible: 'María' })).rejects.toThrow('más de una coincidencia');
  });
  it('no acepta una asignación que desapareció del catálogo', async () => {
    const result = await prepareFrontiEntryDraft(user, { ...args, responsible: 'María' });
    m.users.mockResolvedValue([]);
    await expect(validateFrontiEntryAssignment(result.draft)).rejects.toThrow('dejó de estar disponible');
  });
});
