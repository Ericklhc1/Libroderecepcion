import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, SupervisionVisibility } from '@prisma/client';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { searchOperationalRecords } from '@/server/services/global-search';
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
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción IDs' });
    other = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción privada' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisión IDs' });
  });

  it('no duplica IDs cuando módulos distintos crean registros en paralelo', async () => {
    const creates = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0
        ? createEntry(receptionist, {
            type: EntryType.NOVEDAD,
            title: `Novedad concurrente ${index}`,
            description: 'Prueba de secuencia global.',
            priority: Priority.MEDIA,
            tags: [],
            requiresFollowUp: false,
          })
        : createTask(receptionist, {
            title: `Tarea concurrente ${index}`,
            priority: Priority.MEDIA,
            tags: [],
            checklist: [],
          }),
    );

    const rows = await Promise.all(creates);
    const ids = rows.map((row) => row.humanId);

    expect(ids.every((id) => Number.isInteger(id) && id >= 1000)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resuelve #ID y número desnudo como coincidencia exacta prioritaria', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Revisar garantía de la habitación 617',
      description: 'Referencia de búsqueda global.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    await createTask(receptionist, {
      title: `Tarea relacionada con ${entry.humanId}`,
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });

    for (const query of [String(entry.humanId), `#${entry.humanId}`]) {
      const results = await searchOperationalRecords(receptionist, query);
      expect(results[0]?.humanId).toBe(entry.humanId);
      expect(results[0]?.entityType).toBe('OperationalEntry');
    }
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
