import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, Severity } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { getSupervisionData } from '@/server/services/supervision';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Supervisión reúne las excepciones que antes había que ir a buscar a cuatro
 * páginas. No define entidades nuevas: consulta los mismos modelos, así que
 * lo que se prueba es que cada bloque recoja exactamente lo que debe.
 */
describe('mesa de supervisión', () => {
  let supervisor: CurrentUser;
  let receptionist: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    // Deja el inventario como lo siembra el catálogo: otro archivo de pruebas
    // pudo dejar una llave extra, y eso sería un conflicto que no es de acá.
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción tarde' });
  });

  const rowsOf = (blocks: Awaited<ReturnType<typeof getSupervisionData>>['blocks'], key: string) =>
    blocks.find((block) => block.key === key)?.rows ?? [];

  it('parte vacía cuando no hay nada que intervenir', async () => {
    const { total, blocks } = await getSupervisionData();
    expect(total).toBe(0);
    // Los bloques existen siempre: la pantalla no cambia de forma.
    expect(blocks.map((block) => block.key)).toContain('sin-responsable');
  });

  it('recoge la incidencia crítica abierta', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { number: '408' } });
    const entry = await createEntry(receptionist, {
      type: EntryType.INCIDENCIA,
      title: 'Fuga de agua en el baño',
      description: 'El huésped reporta agua en el piso.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });

    const rows = rowsOf((await getSupervisionData()).blocks, 'incidencias');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ref).toBe(`#${entry.seq}`);
    // Enlaza al registro del libro, no a un módulo aparte.
    expect(rows[0]!.href).toBe(`/libro/${entry.id}`);
    expect(rows[0]!.detail).toContain('Sin responsable');
  });

  it('recoge la tarea vencida y no la que aún no vence', async () => {
    const vencida = await createTask(receptionist, {
      title: 'Reponer llaves del stock',
      priority: Priority.ALTA,
      dueAt: new Date(Date.now() - 3 * 3_600_000),
      tags: [],
      checklist: [],
    });
    await createTask(receptionist, {
      title: 'Revisar caja al cierre',
      priority: Priority.MEDIA,
      dueAt: new Date(Date.now() + 6 * 3_600_000),
      tags: [],
      checklist: [],
    });

    const rows = rowsOf((await getSupervisionData()).blocks, 'tareas');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ref).toBe(`T#${vencida.seq}`);
    expect(rows[0]!.meta).toContain('vencida hace 3 h');
  });

  it('lista sin responsable sólo lo que sigue abierto y sin dueño', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { number: '414' } });
    const huerfana = await createEntry(receptionist, {
      type: EntryType.MANTENIMIENTO,
      title: 'Cerradura dura',
      description: 'Cuesta girar la llave.',
      priority: Priority.MEDIA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });
    const asignada = await createEntry(receptionist, {
      type: EntryType.MANTENIMIENTO,
      title: 'Aire acondicionado con ruido',
      description: 'Ruido constante.',
      priority: Priority.MEDIA,
      roomId: room.id,
      ownerId: supervisor.id,
      tags: [],
      requiresFollowUp: false,
    });

    const refs = rowsOf((await getSupervisionData()).blocks, 'sin-responsable').map((r) => r.ref);
    expect(refs).toContain(`#${huerfana.seq}`);
    expect(refs).not.toContain(`#${asignada.seq}`);
  });

  it('el registro eliminado lógicamente sale de la revisión', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { number: '515' } });
    const entry = await createEntry(receptionist, {
      type: EntryType.INCIDENCIA,
      title: 'Caja fuerte bloqueada',
      description: 'No abre con el código del huésped.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });
    expect(rowsOf((await getSupervisionData()).blocks, 'incidencias')).toHaveLength(1);

    await prisma.operationalEntry.update({
      where: { id: entry.id },
      data: { deletedAt: new Date(), deletedById: supervisor.id, deletionReason: 'duplicada' },
    });
    expect(rowsOf((await getSupervisionData()).blocks, 'incidencias')).toHaveLength(0);
  });

  it('no proyecta conflictos PMS ni de llaves', async () => {
    const keys = (await getSupervisionData()).blocks.map((block) => block.key);
    expect(keys).not.toContain('conflictos-llaves');
    expect(keys).not.toContain('conflictos-habitacion');
    expect(keys).not.toContain('salidas');
    expect(keys).not.toContain('llaves-pendientes');
    expect(keys).not.toContain('multas');
  });
});
