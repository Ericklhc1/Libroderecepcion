import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertLevel, AlertType, EntryType, Priority } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createManualAlert } from '@/server/services/alerts';
import { searchOperationalRecords } from '@/server/services/global-search';
import type { CurrentUser } from '@/server/auth/current-user';

describe('identificador humano global', () => {
  let receptionist: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción IDs globales',
    });
  });

  it('asigna un único correlativo compartido entre módulos', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Novedad con ID humano',
      description: 'Prueba del correlativo global.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    const task = await createTask(receptionist, {
      title: 'Tarea con ID humano',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });
    const alert = await createManualAlert(receptionist, {
      type: AlertType.OTRO,
      level: AlertLevel.ATENCION,
      title: 'Alerta con ID humano',
    });

    const ids = [entry.humanId, task.humanId, alert.humanId];
    expect(ids.every((id) => Number.isInteger(id) && id >= 1000)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(task.humanId).toBeGreaterThan(entry.humanId);
    expect(alert.humanId).toBeGreaterThan(task.humanId);
  });

  it('mantiene unicidad con escrituras concurrentes', async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        prisma.task.create({
          data: {
            title: `Tarea concurrente ${index + 1}`,
            priority: Priority.MEDIA,
            createdById: receptionist.id,
          },
          select: { id: true, humanId: true },
        }),
      ),
    );

    const ids = created.map((row) => row.humanId);
    expect(new Set(ids).size).toBe(created.length);
  });

  it('resuelve #ID exacto sin conocer el módulo', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Multa pendiente de revisión',
      description: 'Habitación 617.',
      priority: Priority.ALTA,
      tags: [],
      requiresFollowUp: false,
    });
    const task = await createTask(receptionist, {
      title: 'Revisar caja del turno',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });

    const byHash = await searchOperationalRecords(receptionist, `#${task.humanId}`);
    expect(byHash[0]).toMatchObject({
      humanId: task.humanId,
      entityType: 'Task',
      entityId: task.id,
    });

    const byPlain = await searchOperationalRecords(receptionist, String(entry.humanId));
    expect(byPlain[0]).toMatchObject({
      humanId: entry.humanId,
      entityType: 'OperationalEntry',
      entityId: entry.id,
    });
  });

  it('busca por texto relacionado sin prefijos técnicos', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Multa pendiente en habitación 617',
      description: 'Revisar antecedente antes del cierre.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });

    const results = await searchOperationalRecords(receptionist, 'multa 617');
    expect(results.some((row) => row.entityId === entry.id)).toBe(true);
  });
});
