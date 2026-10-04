import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {CurrentUser} from '@/server/auth/current-user';
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
  let reader: CurrentUser;
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    reader=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
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

    const cockpit = await getManagementCockpit(reader,30);

    expect(cockpit.execution.overdueTasks).toBe(1);
    expect(cockpit.execution.criticalOpenIncidents).toBe(1);
    expect(cockpit.decisions.map((item) => item.id)).toEqual(
      expect.arrayContaining(['critical-incidents', 'tasks-overdue']),
    );

    const critical = cockpit.decisions.find((item) => item.id === 'critical-incidents');
    expect(critical?.href).toBe('/libro?clase=entry&tipo=INCIDENCIA');
    expect(critical?.action).toMatch(/responsable/i);
    expect(critical?.evidence).toHaveLength(1);
    expect(critical?.evidence[0]?.label).toMatch(/Incidencia #/);
    expect(critical?.evidence[0]?.href).toMatch(/^\/libro\//);

    const overdue = cockpit.decisions.find((item) => item.id === 'tasks-overdue');
    expect(overdue?.evidence).toHaveLength(1);
    expect(overdue?.evidence[0]?.href).toMatch(/^\/tareas\//);
  });

  it('normaliza el rango a 7, 30 o 90 días y compara contra el período anterior', async () => {
    const seven = await getManagementCockpit(reader,7);
    const invalid = await getManagementCockpit(reader,21);
    const ninety = await getManagementCockpit(reader,90);

    expect(seven.period.days).toBe(7);
    expect(invalid.period.days).toBe(30);
    expect(ninety.period.days).toBe(90);
    expect(seven.period.previous.to.getTime()).toBeLessThan(seven.period.current.from.getTime());
    expect(seven.trends.length).toBeGreaterThanOrEqual(5);
  });

  it('mantiene Gerencia sobre evidencia operativa de AROH y contexto por habitación', async () => {
    const cockpit = await getManagementCockpit(reader);

    expect(cockpit.sources.operational).toBe('connected');
    expect(cockpit.sources.roomContext).toBe('connected');
    expect(cockpit.sources.cash).toBe('connected');
    expect(cockpit.sources.keys).toBe('connected');
    expect(cockpit.sources.audits).toBe('connected');
    expect(cockpit.roomFocus.totalRooms).toBe(89);
  });

  it('Fronti puede leer llaves para Gerencia sin conceder permiso de inventario', async () => {
    const management = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });

    expect(management.permissions).toContain('management.dashboard.view');
    expect(management.permissions).not.toContain('key.inventory');
    expect(canFrontiUseTool(management, 'consultar_llaves')).toBe(true);
  });
});
