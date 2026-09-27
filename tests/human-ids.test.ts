import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, TaskStatus } from '@prisma/client';
import {
  createUser,
  prisma,
  resetOperationalData,
  ROLE_KEYS,
  seedCatalog,
} from './helpers';
import { searchOperationalRecords } from '@/server/services/global-search';

describe('identificadores humanos globales', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('usa una sola secuencia entre módulos y conserva los IDs técnicos', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Jaime Prueba',
    });

    const entry = await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Multa pendiente',
        description: 'Revisar garantía en caja.',
        priority: Priority.ALTA,
        createdById: user.id,
        ownerId: user.id,
      },
    });

    const tasks = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        prisma.task.create({
          data: {
            title: `Tarea concurrente ${index + 1}`,
            status: TaskStatus.PENDIENTE,
            priority: Priority.MEDIA,
            createdById: user.id,
            assigneeId: user.id,
          },
        }),
      ),
    );

    const ids = [entry.humanId, ...tasks.map((task) => task.humanId)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id >= 1000)).toBe(true);
    expect(entry.id).toMatch(/^c|-/);

    const after = await prisma.task.create({
      data: {
        title: 'Creada después',
        status: TaskStatus.PENDIENTE,
        priority: Priority.MEDIA,
        createdById: user.id,
        assigneeId: user.id,
      },
    });
    expect(after.humanId).toBeGreaterThan(Math.max(...ids));
  });

  it('busca por #ID, habitación, persona y combinaciones sin prefijo de módulo', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Sofía Recepción',
    });
    const room = await prisma.room.upsert({
      where: { number: '617' },
      update: { active: true },
      create: { number: '617', floor: 6 },
    });
    const guest = await prisma.guestReference.create({
      data: { fullName: 'Huésped Buscar', roomNumber: '617' },
    });
    const entry = await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Multa pendiente',
        description: 'Garantía pendiente de revisar en caja.',
        priority: Priority.ALTA,
        createdById: user.id,
        ownerId: user.id,
        roomId: room.id,
        guestId: guest.id,
      },
    });

    const byId = await searchOperationalRecords(user, `#${entry.humanId}`);
    expect(byId[0]).toEqual(
      expect.objectContaining({
        humanId: entry.humanId,
        entity: 'OperationalEntry',
        room: '617',
      }),
    );

    const byRoom = await searchOperationalRecords(user, '617');
    expect(byRoom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ humanId: entry.humanId, room: '617' }),
      ]),
    );

    const byPerson = await searchOperationalRecords(user, 'Sofía');
    expect(byPerson.map((row) => row.humanId)).toContain(entry.humanId);

    const combined = await searchOperationalRecords(user, 'garantia caja');
    expect(combined.map((row) => row.humanId)).toContain(entry.humanId);
  });

  it('no numera comentarios ni microacciones', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Comment' AND column_name = 'humanId'
    `;
    expect(columns).toHaveLength(0);
  });
});
