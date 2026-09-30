import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, Severity } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createTask } from '@/server/services/tasks';
import { createEntry } from '@/server/services/entries';
import { getManagementCockpit } from '@/server/services/management';
import { canFrontiUseTool } from '@/server/ai/fronti-v2/tool-registry';

describe('cockpit estratégico de Gerencia', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('convierte excepciones operativas reales en decisiones trazables', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Gerencia',
    });

    await createTask(supervisor, {
      title: 'Resolver pendiente vencido',
      priority: Priority.ALTA,
      dueAt: new Date(Date.now() - 60 * 60_000),
      tags: [],
      checklist: [],
    });

    await createEntry(supervisor, {
      type: EntryType.INCIDENCIA,
      title: 'Incidencia crítica de prueba',
      description: 'Debe aparecer como señal de decisión gerencial.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });

    const cockpit = await getManagementCockpit(30);

    expect(cockpit.execution.overdueTasks).toBe(1);
    expect(cockpit.execution.criticalOpenIncidents).toBe(1);
    expect(cockpit.decisions.map((item) => item.id)).toEqual(
      expect.arrayContaining(['critical-incidents', 'tasks-overdue']),
    );

    const critical = cockpit.decisions.find((item) => item.id === 'critical-incidents');
    expect(critical?.href).toBe('/libro?clase=entry&tipo=INCIDENCIA');
    expect(critical?.action).toMatch(/responsable/i);
  });

  it('normaliza el rango a 7, 30 o 90 días y compara contra el período anterior', async () => {
    const seven = await getManagementCockpit(7);
    const invalid = await getManagementCockpit(21);
    const ninety = await getManagementCockpit(90);

    expect(seven.period.days).toBe(7);
    expect(invalid.period.days).toBe(30);
    expect(ninety.period.days).toBe(90);
    expect(seven.period.previous.to.getTime()).toBeLessThan(seven.period.current.from.getTime());
    expect(seven.trends.length).toBeGreaterThanOrEqual(5);
  });

  it('declara fuentes estratégicas faltantes en vez de inventar KPI comerciales o financieros', async () => {
    const cockpit = await getManagementCockpit();

    expect(cockpit.sources.operational).toBe('connected');
    expect(cockpit.sources.reservations).toBe('connected');
    expect(cockpit.sources.cash).toBe('connected');

    for (const source of [
      cockpit.sources.commercialPms,
      cockpit.sources.finance,
      cockpit.sources.labor,
      cockpit.sources.guestVoice,
      cockpit.sources.benchmark,
    ]) {
      expect(source).toBe('not_connected');
    }
  });

  it('Fronti puede leer llaves para Gerencia sin conceder permiso de inventario', async () => {
    const management = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });

    expect(management.permissions).toContain('management.dashboard.view');
    expect(management.permissions).not.toContain('key.inventory');
    expect(canFrontiUseTool(management, 'consultar_llaves')).toBe(true);
  });
});
