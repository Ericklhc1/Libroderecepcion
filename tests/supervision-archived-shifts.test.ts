import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('supervisión no revive turnos retirados', () => {
  const source = readFileSync('src/server/services/supervision.ts', 'utf-8');

  it('los turnos históricos pendientes excluyen los archivados', () => {
    const marker = 'status: { in: [ShiftStatus.RECIBIDO, ShiftStatus.ENTREGA_ENVIADA] }';
    const index = source.indexOf(marker);
    expect(index).toBeGreaterThan(-1);

    const query = source.slice(Math.max(0, index - 180), index + marker.length + 120);
    expect(query).toContain('archivedAt: null');
  });
});
