import { describe, expect, it } from 'vitest';
import { buildOperationalAttention } from '@/domain/operational-attention';

describe('motor de atención operativa', () => {
  it('prioriza bloqueos físicos y críticos sin depender de IA', () => {
    const result = buildOperationalAttention({
      rooms: [
        {
          number: '415',
          state: 'PENDIENTE_LIBERACION',
          openIncidents: 1,
          keyIssues: 1,
        },
      ],
      alerts: [
        {
          id: 'a1',
          level: 'CRITICA',
          title: 'Garantía pendiente',
          message: 'Requiere resolución.',
        },
      ],
      overdueTasks: [
        {
          id: 't1',
          title: 'Llamar huésped',
          priority: 'ALTA',
        },
      ],
      criticalEntries: [],
      followUps: [],
    });

    expect(result[0]?.id).toBe('room:415');
    expect(result[0]?.score).toBe(100);
    expect(result[0]?.reason).toContain('incidencia');
    expect(result[0]?.reason).toContain('llave');
    expect(result.some((item) => item.id === 'alert:a1')).toBe(true);
    expect(result.some((item) => item.id === 'task:t1')).toBe(true);
  });

  it('da una acción concreta a una incidencia aislada de habitación', () => {
    const [incident] = buildOperationalAttention({
      rooms: [
        {
          number: '501',
          state: 'OCUPADA',
          openIncidents: 1,
          keyIssues: 0,
        },
      ],
      alerts: [],
      overdueTasks: [],
      criticalEntries: [],
      followUps: [],
    });

    expect(incident?.action).toBe('Revisar las incidencias abiertas');
    expect(incident?.action).not.toBe('Sin acción pendiente');
    expect(incident?.reason).not.toContain('Sin acción pendiente');
  });

  it('es determinístico y respeta el límite', () => {
    const input = {
      rooms: [],
      alerts: [],
      overdueTasks: [
        { id: '1', title: 'B', priority: 'MEDIA' as const },
        { id: '2', title: 'A', priority: 'MEDIA' as const },
        { id: '3', title: 'C', priority: 'MEDIA' as const },
      ],
      criticalEntries: [],
      followUps: [],
    };

    const first = buildOperationalAttention(input, 2);
    const second = buildOperationalAttention(input, 2);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.map((item) => item.title)).toEqual(['A', 'B']);
  });
});
