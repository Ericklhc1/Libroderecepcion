import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, Severity, ShiftType, TaskStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import { getBookItems } from '@/server/services/book';
import { createEntry, softDeleteEntry } from '@/server/services/entries';
import { changeTaskStatus, createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { createManualAlert } from '@/server/services/alerts';
import { defaultRange, getMetrics } from '@/server/services/metrics';
import type { CurrentUser } from '@/server/auth/current-user';

describe('libro operativo: búsqueda y filtros combinados', () => {
  let user: CurrentUser;
  let other: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Camila Vera' });
    other = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Diego Alarcón' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  async function seedBook() {
    const maintenance = await prisma.department.findUniqueOrThrow({
      where: { key: 'MANTENIMIENTO' },
    });

    const incident = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Aire acondicionado sin enfriar en habitación 318',
      description: 'Helen Whitaker reporta que no enfría desde las 22:00.',
      category: 'climatización',
      priority: Priority.ALTA,
      severity: Severity.ALTA,
      departmentId: maintenance.id,
      ownerId: other.id,
      tags: ['climatizacion'],
      requiresFollowUp: false,
    });

    const novedad = await createEntry(other, {
      type: EntryType.NOVEDAD,
      title: 'Codificador reiniciado',
      description: 'Error E-04 resuelto con reinicio del equipo.',
      priority: Priority.BAJA,
      tags: ['equipos'],
      requiresFollowUp: false,
    });

    const task = await createTask(user, {
      title: 'Reparar el equipo de habitación 318',
      priority: Priority.ALTA,
      tags: ['climatizacion'],
      checklist: [],
      entryId: incident.id,
      assigneeId: other.id,
    });

    const followUp = await createFollowUp(user, {
      entryId: incident.id,
      action: 'Coordinar visita del técnico a habitación 318',
    });

    const alert = await createManualAlert(user, {
      type: 'OTRO',
      level: 'INFORMATIVA',
      title: 'Verificar respuesta del técnico',
      message: 'Seguimiento operativo del caso de climatización.',
    });

    return { incident, novedad, task, followUp, alert, maintenance };
  }

  it('unifica registros, tareas, seguimientos y alertas en un solo flujo', async () => {
    await seedBook();
    const result = await getBookItems({});

    const kinds = new Set(result.items.map((item) => item.kind));
    expect(kinds).toEqual(new Set(['entry', 'task', 'followup', 'alert']));
    expect(result.items).toHaveLength(5);

    const times = result.items.map((item) => item.date.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filtra por clase de objeto', async () => {
    await seedBook();

    const soloTareas = await getBookItems({ kinds: ['task'] });
    expect(soloTareas.items.every((item) => item.kind === 'task')).toBe(true);
    expect(soloTareas.items).toHaveLength(1);

    const soloAlertas = await getBookItems({ kinds: ['alert'] });
    expect(soloAlertas.items).toHaveLength(1);
  });

  it('busca por título, descripción, categoría, etiqueta y responsable', async () => {
    await seedBook();

    const porCaso = await getBookItems({ q: 'aire acondicionado' });
    expect(porCaso.items).toHaveLength(3);
    expect(new Set(porCaso.items.map((item) => item.kind))).toEqual(
      new Set(['entry', 'task', 'followup']),
    );
    expect((await getBookItems({ q: 'E-04' })).items).toHaveLength(1);
    expect((await getBookItems({ q: 'climatizacion' })).items.length).toBeGreaterThanOrEqual(2);
    expect((await getBookItems({ q: 'Whitaker' })).items).toHaveLength(1);
    expect((await getBookItems({ q: 'Diego Alarcón' })).items.length).toBeGreaterThanOrEqual(2);
    expect((await getBookItems({ q: 'no-existe-en-ningun-registro' })).items).toHaveLength(0);
  });

  it('una habitación escrita como texto se encuentra sin relación PMS', async () => {
    const { incident, task, followUp } = await seedBook();

    const result = await getBookItems({ q: '318' });
    const ids = result.items.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining([incident.id, task.id, followUp.id]));
    expect(result.items.some((item) => item.title.includes('Codificador'))).toBe(false);
  });

  it('filtra por área, tipo, prioridad y responsable', async () => {
    const { maintenance, incident, task } = await seedBook();

    const porArea = await getBookItems({ departmentId: maintenance.id });
    expect(porArea.items.map((item) => item.id)).toContain(incident.id);
    expect(porArea.items.some((item) => item.title.includes('Codificador'))).toBe(false);

    expect((await getBookItems({ entryType: EntryType.INCIDENCIA, kinds: ['entry'] })).items)
      .toHaveLength(1);
    expect((await getBookItems({ priority: 'ALTA', kinds: ['entry'] })).items).toHaveLength(1);

    const deOther = await getBookItems({ ownerId: other.id, kinds: ['entry', 'task'] });
    expect(deOther.items.map((item) => item.id).sort()).toEqual([incident.id, task.id].sort());
  });

  it('combina varios filtros a la vez', async () => {
    const { maintenance } = await seedBook();

    const combinado = await getBookItems({
      q: 'aire',
      kinds: ['entry'],
      departmentId: maintenance.id,
      priority: 'ALTA',
      onlyOpen: true,
    });
    expect(combinado.items).toHaveLength(1);
    expect(combinado.items[0]?.title).toContain('Aire acondicionado');

    expect(
      (await getBookItems({ q: 'aire', priority: 'BAJA', kinds: ['entry'] })).items,
    ).toHaveLength(0);
  });

  it('muestra el turno, el responsable y el vencimiento de cada fila', async () => {
    const shift = await createShift({ userId: user.id, type: ShiftType.DIA });
    await openShiftAs(user, shift);

    await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Registro con turno y vencimiento',
      description: 'Verifica los metadatos que muestra el libro.',
      priority: Priority.MEDIA,
      ownerId: other.id,
      dueAt: new Date(Date.now() - 3600_000),
      tags: [],
      requiresFollowUp: false,
    });

    const result = await getBookItems({ kinds: ['entry'] });
    const row = result.items[0]!;

    expect(row.shiftLabel).toContain('DIA');
    expect(row.ownerName).toBe('Diego Alarcón');
    expect(row.creatorName).toBe('Camila Vera');
    expect(row.overdue).toBe(true);
    expect(row.tone).toBe('critico');
    expect(row.guestLabel).toBeNull();
  });

  it('oculta los registros eliminados salvo que se pidan expresamente', async () => {
    const { novedad } = await seedBook();
    await softDeleteEntry(supervisor, { id: novedad.id, reason: 'Registro duplicado.' });

    const normal = await getBookItems({ kinds: ['entry'] });
    expect(normal.items.map((item) => item.id)).not.toContain(novedad.id);

    const conEliminados = await getBookItems({ kinds: ['entry'], includeDeleted: true });
    const found = conEliminados.items.find((item) => item.id === novedad.id);
    expect(found?.deleted).toBe(true);
  });

  it('pagina los resultados', async () => {
    for (let index = 0; index < 12; index += 1) {
      await createEntry(user, {
        type: EntryType.NOVEDAD,
        title: `Registro de paginación número ${index}`,
        description: 'Generado para verificar la paginación del libro.',
        priority: Priority.BAJA,
        tags: [],
        requiresFollowUp: false,
      });
    }

    const first = await getBookItems({ kinds: ['entry'], pageSize: 10, page: 1 });
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);

    const second = await getBookItems({ kinds: ['entry'], pageSize: 10, page: 2 });
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(false);

    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(12);
  });
});

describe('indicadores', () => {
  let user: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('calcula cumplimiento de tareas en plazo y fuera de plazo', async () => {
    const onTime = await createTask(user, {
      title: 'Tarea completada en plazo',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: new Date(Date.now() + 3600_000),
    });
    const late = await createTask(user, {
      title: 'Tarea completada con retraso',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: new Date(Date.now() - 3600_000),
    });
    await createTask(user, {
      title: 'Tarea vencida sin completar',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: new Date(Date.now() - 7200_000),
    });

    await changeTaskStatus(user, { id: onTime.id, status: TaskStatus.COMPLETADA });
    await changeTaskStatus(user, { id: late.id, status: TaskStatus.COMPLETADA });

    const metrics = await getMetrics(defaultRange(30));

    expect(metrics.tasks.completed).toBe(2);
    expect(metrics.tasks.completedOnTime).toBe(1);
    expect(metrics.tasks.completedLate).toBe(1);
    expect(metrics.tasks.onTimeRate).toBe(50);
    expect(metrics.tasks.overdue).toBe(1);
    expect(metrics.tasks.open).toBe(1);
  });

  it('mide incidencias abiertas y el tiempo medio de resolución', async () => {
    const opened = new Date(Date.now() - 4 * 3600_000);
    const incident = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Incidencia que se cerrará',
      description: 'Se usa para medir el tiempo de resolución.',
      priority: Priority.ALTA,
      severity: Severity.ALTA,
      occurredAt: opened,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Incidencia que permanece abierta',
      description: 'Debe contarse entre las abiertas.',
      priority: Priority.MEDIA,
      severity: Severity.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });

    await prisma.operationalEntry.update({
      where: { id: incident.id },
      data: { status: 'CERRADO', closedAt: new Date(), resolution: 'Resuelta.' },
    });

    const metrics = await getMetrics(defaultRange(30));
    expect(metrics.incidents.open).toBe(1);
    expect(metrics.incidents.closedInRange).toBe(1);
    expect(metrics.incidents.avgResolutionHours).toBeGreaterThan(3.5);
    expect(metrics.incidents.avgResolutionHours).toBeLessThan(4.5);
  });

  it('agrupa incidencias por área', async () => {
    const maintenance = await prisma.department.findUniqueOrThrow({
      where: { key: 'MANTENIMIENTO' },
    });
    for (let index = 0; index < 2; index += 1) {
      await createEntry(user, {
        type: EntryType.INCIDENCIA,
        title: `Incidencia de mantenimiento ${index}`,
        description: 'Agrupación por área.',
        priority: Priority.MEDIA,
        severity: Severity.MEDIA,
        departmentId: maintenance.id,
        tags: [],
        requiresFollowUp: false,
      });
    }

    const metrics = await getMetrics(defaultRange(30));
    expect(metrics.incidents.byDepartment[0]).toEqual({ department: 'Mantenimiento', count: 2 });
  });
});
