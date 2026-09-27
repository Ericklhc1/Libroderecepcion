import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { searchOperationalRecords } from '@/server/services/global-search';
import type { CurrentUser } from '@/server/auth/current-user';

describe('identificadores humanos globales', () => {
  let receptionist: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Jaime Correlativo',
    });
  });

  it('usa un solo espacio numérico sin reemplazar los IDs técnicos', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Prueba de correlativo global',
      description: 'Registro para comprobar compatibilidad.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    const task = await createTask(receptionist, {
      title: 'Tarea con correlativo global',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });

    expect(entry.humanId).toBeGreaterThanOrEqual(1000);
    expect(task.humanId).toBeGreaterThan(entry.humanId);
    expect(task.humanId).not.toBe(entry.humanId);

    expect(typeof entry.id).toBe('string');
    expect(typeof task.id).toBe('string');
    expect(entry.id).not.toBe(String(entry.humanId));
    expect(task.id).not.toBe(String(task.humanId));

    // Compatibilidad: los correlativos históricos locales siguen existiendo
    // como datos técnicos, pero ya no son la referencia visible.
    expect(entry.seq).toBeGreaterThan(0);
    expect(task.seq).toBeGreaterThan(0);
  });

  it('no duplica números bajo creaciones concurrentes entre tablas distintas', async () => {
    const creations = Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0
        ? prisma.operationalEntry.create({
            data: {
              type: EntryType.NOVEDAD,
              title: `Concurrente E${index}`,
              description: 'Prueba de concurrencia.',
              priority: Priority.MEDIA,
              createdById: receptionist.id,
            },
            select: { humanId: true },
          })
        : prisma.task.create({
            data: {
              title: `Concurrente T${index}`,
              priority: Priority.MEDIA,
              createdById: receptionist.id,
            },
            select: { humanId: true },
          }),
    );

    const rows = await Promise.all(creations);
    const ids = rows.map((row) => row.humanId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id >= 1000)).toBe(true);
  });

  it('resuelve #ID exacto primero y acepta búsqueda sin prefijo', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Multa pendiente de revisión',
      description: 'Seguimiento operacional del caso.',
      priority: Priority.ALTA,
      tags: ['multa'],
      requiresFollowUp: false,
    });

    const byHash = await searchOperationalRecords(receptionist, `#${entry.humanId}`);
    const byNumber = await searchOperationalRecords(receptionist, String(entry.humanId));

    expect(byHash[0]).toMatchObject({
      humanId: entry.humanId,
      entityType: 'OperationalEntry',
      entityId: entry.id,
    });
    expect(byNumber[0]?.humanId).toBe(entry.humanId);
  });

  it('busca por habitación, huésped, responsable y términos combinados', async () => {
    const guarantee = await prisma.guarantee.create({
      data: {
        guestName: 'Sofía Prueba',
        roomNumber: '617',
        reference: 'Garantía efectivo',
        kind: 'EFECTIVO',
        state: 'VIGENTE',
        amount: '50000',
        currency: 'CLP',
        createdById: receptionist.id,
      },
    });

    const results = await searchOperationalRecords(
      receptionist,
      '617 Sofía garantía',
    );

    expect(results.some((row) => row.humanId === guarantee.humanId)).toBe(true);

    const byResponsible = await searchOperationalRecords(receptionist, 'Jaime Correlativo');
    expect(byResponsible.some((row) => row.humanId === guarantee.humanId)).toBe(true);
  });
});
