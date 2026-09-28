import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  EntryType,
  Priority,
  SupervisionVisibility,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { searchOperationalRecords } from '@/server/services/global-search';
import { getBookItems } from '@/server/services/book';
import type { CurrentUser } from '@/server/auth/current-user';

describe('identificadores humanos globales', () => {
  let receptionist: CurrentUser;
  let other: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Jaime Correlativo',
    });
    other = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción privada',
    });
    supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión IDs',
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
  it('el Libro busca tareas y alertas por el humanId global, no por correlativos locales antiguos', async () => {
    const task = await createTask(receptionist, {
      title: 'Tarea sólo por correlativo global',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });
    const alert = await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.ATENCION,
        status: AlertStatus.NUEVA,
        title: 'Alerta sólo por correlativo global',
        createdById: receptionist.id,
      },
    });

    const taskResult = await getBookItems({
      q: String(task.humanId),
      kinds: ['task'],
    });
    const alertResult = await getBookItems({
      q: `#${alert.humanId}`,
      kinds: ['alert'],
    });

    expect(taskResult.items).toHaveLength(1);
    expect(taskResult.items[0]).toMatchObject({
      id: task.id,
      ref: `#${task.humanId}`,
    });
    expect(alertResult.items).toHaveLength(1);
    expect(alertResult.items[0]).toMatchObject({
      id: alert.id,
      ref: `#${alert.humanId}`,
    });
  });

  it('no expone seguimientos privados de otra persona en la búsqueda global', async () => {
    const followUp = await createFollowUp(supervisor, {
      action: 'Revisión reservada de Supervisión',
      ownerId: supervisor.id,
      visibility: SupervisionVisibility.PRIVADO,
    });

    const ownResults = await searchOperationalRecords(supervisor, String(followUp.humanId));
    const foreignResults = await searchOperationalRecords(other, String(followUp.humanId));

    expect(ownResults.some((row) => row.humanId === followUp.humanId)).toBe(true);
    expect(foreignResults.some((row) => row.humanId === followUp.humanId)).toBe(false);
  });

  it('no reutiliza un número consumido por una transacción revertida', async () => {
    let burned = 0;

    await expect(
      prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ value: number }>>`
          SELECT nextval('human_operational_id_seq'::regclass)::integer AS "value"
        `;
        burned = rows[0]!.value;
        throw new Error('rollback intencional');
      }),
    ).rejects.toThrow('rollback intencional');

    const rows = await prisma.$queryRaw<Array<{ value: number }>>`
      SELECT nextval('human_operational_id_seq'::regclass)::integer AS "value"
    `;

    expect(rows[0]!.value).toBeGreaterThan(burned);
  });

});
