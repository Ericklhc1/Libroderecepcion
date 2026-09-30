import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EntryStatus,
  EntryType,
  FineStatus,
  GuaranteeState,
  KeyStatus,
  Priority,
  TaskStatus,
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
import { getRoomOperationsMonitor } from '@/server/services/room-operations';

describe('Novedades / habitación', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('cubre el catálogo operativo completo de 89 habitaciones', async () => {
    const monitor = await getRoomOperationsMonitor();
    expect(monitor).toHaveLength(89);
    expect(monitor[0]?.roomNumber).toBe('401');
    expect(monitor.at(-1)?.roomNumber).toBe('630');
  });

  it('muestra sólo continuidad activa y retira cada objeto al quedar resuelto', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor monitor habitaciones',
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '512' } });

    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Aire acondicionado pendiente',
      description: 'Revisar equipo antes del siguiente turno.',
      roomId: room.id,
      priority: Priority.ALTA,
      tags: [],
      requiresFollowUp: false,
    });

    const task = await createTask(user, {
      title: 'Reponer control remoto',
      roomId: room.id,
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });

    const guarantee = await prisma.guarantee.create({
      data: {
        guestName: 'Huésped monitor',
        roomNumber: '512',
        kind: 'EFECTIVO',
        state: GuaranteeState.VIGENTE,
        amount: '80000',
        currency: 'CLP',
        createdById: user.id,
      },
    });

    const fine = await prisma.fine.create({
      data: {
        roomId: room.id,
        reservationCode: 'MON-512',
        guestName: 'Huésped monitor',
        reason: 'Daño pendiente de decisión',
        status: FineStatus.REGISTRADA,
        createdById: user.id,
      },
    });

    const key = await prisma.roomKey.findFirstOrThrow({
      where: { roomId: room.id, type: 'PRINCIPAL' },
    });
    await prisma.roomKey.update({
      where: { id: key.id },
      data: { status: KeyStatus.EXTRAVIADA },
    });

    let row = (await getRoomOperationsMonitor()).find((item) => item.roomNumber === '512');
    expect(row).toBeDefined();
    expect(row?.matters.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['NOVEDAD', 'TAREA', 'GARANTIA', 'MULTA', 'LLAVE']),
    );

    await prisma.$transaction([
      prisma.operationalEntry.update({
        where: { id: entry.id },
        data: { status: EntryStatus.RESUELTO },
      }),
      prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.COMPLETADA, completedAt: new Date() },
      }),
      prisma.guarantee.update({
        where: { id: guarantee.id },
        data: { state: GuaranteeState.DEVUELTA, returnedAt: new Date(), returnedById: user.id },
      }),
      prisma.fine.update({
        where: { id: fine.id },
        data: { status: FineStatus.COBRADA },
      }),
      prisma.roomKey.update({
        where: { id: key.id },
        data: { status: KeyStatus.DISPONIBLE },
      }),
    ]);

    row = (await getRoomOperationsMonitor()).find((item) => item.roomNumber === '512');
    expect(row?.matters).toEqual([]);

    expect(await prisma.operationalEntry.findUnique({ where: { id: entry.id } })).not.toBeNull();
    expect(await prisma.guarantee.findUnique({ where: { id: guarantee.id } })).not.toBeNull();
    expect(await prisma.fine.findUnique({ where: { id: fine.id } })).not.toBeNull();
  });

  it('una Incidencia hereda su habitación a la tarea automática', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor incidencia habitación',
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '617' } });

    const entry = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Filtración en baño',
      description: 'Agua visible junto a la ducha.',
      roomId: room.id,
      priority: Priority.ALTA,
      severity: 'ALTA',
      tags: [],
      requiresFollowUp: true,
    });

    const { ensureIncidentWorkflow } = await import('@/server/services/incident-workflow');
    await ensureIncidentWorkflow(entry.id);

    const task = await prisma.task.findFirstOrThrow({ where: { entryId: entry.id } });
    expect(task.roomId).toBe(room.id);
  });
});
