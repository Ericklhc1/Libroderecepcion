import { describe, expect, it } from 'vitest';
import { buildHkRoomBoard } from '@/domain/housekeeping-room-board';
import { hkActionPermission, hkAllowedActions, hkNextStatus } from '@/domain/housekeeping-work';
const room = { id: 'room', number: '512', floor: 5 };
const work = { id: 'work', humanId: 123, roomId: room.id, workKind: 'LIMPIEZA', workflowVersion: 1, status: 'PENDIENTE', finishedAt: null, inspectedAt: null };
describe('HK-2: evidencia de habitación y resolución', () => {
  it('separa sucia, por inspeccionar y limpia inspeccionada sin inventar estados', () => {
    const state = (rows: Parameters<typeof buildHkRoomBoard>[1]) => buildHkRoomBoard([room], rows)[0]!.state;
    expect(state([])).toBe('SIN_REGISTRO');
    expect(state([work])).toBe('SUCIA');
    expect(state([{ ...work, status: 'POR_REVISAR', finishedAt: new Date() }])).toBe('PENDIENTE_INSPECCION');
    const done = { ...work, status: 'RESUELTO', finishedAt: new Date(), inspectedAt: new Date() };
    expect(state([done])).toBe('LIMPIA');
    expect(state([done, work])).toBe('SUCIA');
    expect(state([{ ...work, status: 'CANCELADO' }])).toBe('SIN_REGISTRO');
    expect(state([{ ...done, inspectedAt: null }])).toBe('SIN_REGISTRO');
    expect(state([{ ...done, workflowVersion: 0 }])).toBe('SIN_REGISTRO');
    expect(buildHkRoomBoard([room], [done])[0]!.work[0]!.humanId).toBe(123);
  });
  it('resolver limpieza exige inspección y no permite saltarse la ejecución', () => {
    expect(hkActionPermission('RESOLVER', true)).toBe('housekeeping.inspect');
    expect(hkActionPermission('RESOLVER', false)).toBe('housekeeping.assign');
    expect(() => hkNextStatus('EN_GESTION', 'RESOLVER', true)).toThrow();
    expect(hkNextStatus('POR_REVISAR', 'RESOLVER', true)).toBe('RESUELTO');
    expect(hkNextStatus('EN_GESTION', 'RESOLVER', false)).toBe('RESUELTO');
    expect(hkAllowedActions('POR_REVISAR', true, true)).not.toContain('RESOLVER');
    expect(() => hkNextStatus('BLOQUEADO', 'RESOLVER', false)).toThrow();
  });
});
