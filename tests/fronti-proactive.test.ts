import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  highestSignalSeverity,
  parseProactiveBrief,
  severityAtLeast,
  type ProactiveSignal,
} from '@/domain/fronti-proactive';
import { runProactiveSupervisionAnalysis } from '@/server/ai/proactive-supervision';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';

const signals: ProactiveSignal[] = [
  { id: 'S1', severity: 'ALTA', source: 'Ventas por período', date: '2026-09-29', title: 'Cortesía detectada', detail: 'Existe una habitación-día en cortesía.' },
  { id: 'S2', severity: 'MEDIA', source: 'Producción por habitación', date: '2026-09-29', title: 'Producción no concilia', detail: 'La producción difiere del total del período.' },
];

describe('Fronti proactivo', () => {
  beforeAll(async () => { await resetOperationalData(); await seedCatalog(); });
  beforeEach(async () => { await resetOperationalData(); await seedCatalog(); });

  it('deriva severidad desde las señales citadas y descarta IDs inventados', () => {
    const parsed = parseProactiveBrief(JSON.stringify({
      summary: 'Hay dos señales relacionadas que requieren revisión.',
      groups: [{
        title: 'Posible discrepancia de imputación',
        severity: 'BAJA',
        confidence: 'MEDIA',
        signalIds: ['S1', 'S2', 'INVENTADA'],
        explanation: 'Las señales coinciden, sin demostrar causa raíz.',
        nextAction: 'Revisar autorización de cortesía y producción del día.',
      }],
    }), signals);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.severity).toBe('ALTA');
    expect(parsed.groups[0]?.signalIds).toEqual(['S1', 'S2']);
  });

  it('aplica severidad mínima determinísticamente', () => {
    expect(severityAtLeast('ALTA', 'MEDIA')).toBe(true);
    expect(severityAtLeast('BAJA', 'MEDIA')).toBe(false);
    expect(highestSignalSeverity(['S1', 'S2'], signals)).toBe('ALTA');
  });

  it('no llama proveedores ni notifica cuando el turno activo no tiene señales', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisor Fronti proactivo' });
    await prisma.user.update({ where: { id: supervisor.id }, data: { frontiAccessEnabled: true } });
    await prisma.supervisionShift.create({ data: { supervisorId: supervisor.id, status: 'ACTIVO', priorities: [] } });
    const result = await runProactiveSupervisionAnalysis();
    expect(result).toMatchObject({ shifts: 1, notified: 0, deduplicated: 0, empty: 1, unavailable: 0 });
    expect(await prisma.notification.count({ where: { userId: supervisor.id, entity: 'FrontiProactiveBrief' } })).toBe(0);
  });
});
