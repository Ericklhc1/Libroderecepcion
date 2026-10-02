import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Priority } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createTask } from '@/server/services/tasks';
import { buildSupervisorReport, reportDateRange } from '@/server/services/supervisor-reports';

describe('informes de Supervisión', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('separa actividad del período de pendientes que siguen vigentes', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión informes',
    });
    const task = await createTask(supervisor, {
      title: 'Pendiente antiguo todavía vigente',
      priority: Priority.ALTA,
      checklist: [],
      tags: [],
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { createdAt: new Date('2026-09-01T12:00:00.000Z') },
    });

    const report = await buildSupervisorReport(supervisor,
      'estado',
      reportDateRange('2026-09-27', '2026-09-27'),
    );

    expect(report.title).toBe('Informe de actividad y estado operativo');
    expect(report.summary).toContain('Actividad del período · tareas creadas: 0');
    expect(
      report.summary.some((line) =>
        line.includes('Estado vigente ahora') && line.includes('tareas abiertas 1'),
      ),
    ).toBe(true);
    expect(report.lines).toContain('ESTADO VIGENTE AHORA');
  });
});
