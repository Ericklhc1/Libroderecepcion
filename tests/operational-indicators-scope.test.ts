import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/server/auth/current-user';
import type { CoordinationRow } from '@/server/services/coordination';

const db = vi.hoisted(() => ({
  frontiExecutionStep: { findMany: vi.fn() },
  operationalAutomationRun: { groupBy: vi.fn() },
  task: { findMany: vi.fn() },
  shift: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
  housekeepingEvent: { findMany: vi.fn() },
}));
const board = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/server/services/coordination', () => ({ getCoordinationBoard: board, coordinationMetrics: () => ({ pending: 0 }) }));
import { operationalIndicators } from '@/server/services/operational-indicators';

const reader = { id: 'reader', roleKey: 'GERENCIA', permissions: ['management.dashboard.view'] } as CurrentUser;
const from = new Date('2026-10-05T00:00:00Z');
const to = new Date('2026-10-05T18:00:00Z');

describe('indicadores: alcance de muestra y bloqueo nativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(db)) for (const method of Object.values(model)) method.mockResolvedValue([]);
    board.mockResolvedValue({ rows: [], byArea: [], hasMore: false, totalExact: true });
  });

  it('declara parciales las áreas cuando el tablero trunca identidades', async () => {
    board.mockResolvedValue({ rows: [], byArea: [{ departmentId: 'area', name: 'Área', total: 5000, blocked: 0 }], hasMore: true, totalExact: false });
    const data = await operationalIndicators(reader, { from, to });
    expect(data.complete).toBe(false);
    expect(data.byAreaComplete).toBe(false);
    expect(data.recurrence.complete).toBe(false);
  });

  it('las áreas pueden ser completas aunque las filas excedan diez páginas', async () => {
    board.mockResolvedValue({ rows: [], byArea: [], hasMore: true, totalExact: true });
    const data = await operationalIndicators(reader, { from, to });
    expect(data.complete).toBe(false);
    expect(data.byAreaComplete).toBe(true);
    expect(data.recurrence.complete).toBe(false);
  });

  it('cuenta EN_ESPERA como bloqueo, sin duplicar actualizaciones del mismo estado', async () => {
    board.mockResolvedValue({ rows: [{ id: 'entry', kind: 'entry', createdAt: from, updatedAt: to, receivedAt: null, completedAt: null } as CoordinationRow], byArea: [], hasMore: false, totalExact: true });
    db.auditLog.findMany.mockResolvedValue([
      { entity: 'OperationalEntry', entityId: 'entry', before: { status: 'EN_CURSO' }, after: { status: 'EN_ESPERA' } },
      { entity: 'OperationalEntry', entityId: 'entry', before: { status: 'EN_ESPERA' }, after: { status: 'EN_ESPERA' } },
    ]);
    const data = await operationalIndicators(reader, { from, to });
    expect(data.recurrence.blockEvents).toBe(1);
  });
});
