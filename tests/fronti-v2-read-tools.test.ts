import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditAction, EntryType, Priority, TaskStatus } from '@prisma/client';
import { ROLE_KEYS } from '@/lib/permissions';
import { executeFrontiV2ReadTool } from '@/server/ai/fronti-v2/read-tools';
import {
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('FRONTI v2 alpha · herramientas de lectura', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('lee novedades reales del Libro', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'frontitest',
    });
    const entry = await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Prueba Fronti',
        description: 'Registro visible para el agente.',
        priority: Priority.ALTA,
        createdById: receptionist.id,
        ownerId: receptionist.id,
      },
    });

    const response = await executeFrontiV2ReadTool(
      receptionist,
      'consultar_novedades',
      { limit: 10, onlyOpen: true },
    );
    expect(response.handled).toBe(true);
    const result = response.result as { items: Array<{ id: string; ref: string; title: string }> };
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: entry.id,
          ref: `#${entry.seq}`,
          title: 'Prueba Fronti',
        }),
      ]),
    );
  });

  it('respeta el alcance mías en tareas', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const other = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const mine = await prisma.task.create({
      data: {
        title: 'Mi tarea Fronti',
        status: TaskStatus.PENDIENTE,
        priority: Priority.MEDIA,
        createdById: receptionist.id,
        assigneeId: receptionist.id,
      },
    });
    await prisma.task.create({
      data: {
        title: 'Tarea ajena',
        status: TaskStatus.PENDIENTE,
        priority: Priority.MEDIA,
        createdById: other.id,
        assigneeId: other.id,
      },
    });

    const response = await executeFrontiV2ReadTool(
      receptionist,
      'consultar_tareas',
      { scope: 'mias', limit: 20 },
    );
    const result = response.result as { scope: string; items: Array<{ id: string }> };
    expect(result.scope).toBe('mias');
    expect(result.items.map((item) => item.id)).toEqual([mine.id]);
  });

  it('bloquea Auditoría para Recepción y la permite al Administrador', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    await prisma.auditLog.create({
      data: {
        entity: 'FrontiAlphaTest',
        entityId: '1',
        action: AuditAction.CONFIGURAR,
        summary: 'Evento de prueba para FRONTI.',
        userId: admin.id,
      },
    });

    await expect(
      executeFrontiV2ReadTool(receptionist, 'consultar_auditoria', {
        limit: 10,
        entity: null,
      }),
    ).rejects.toThrow('No tienes permiso');

    const response = await executeFrontiV2ReadTool(admin, 'consultar_auditoria', {
      limit: 10,
      entity: 'FrontiAlphaTest',
    });
    const result = response.result as { items: Array<{ entity: string; summary: string }> };
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        entity: 'FrontiAlphaTest',
        summary: 'Evento de prueba para FRONTI.',
      }),
    );
  });

  it('nunca entrega configuración técnica a quien no tiene system.configure', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    await expect(
      executeFrontiV2ReadTool(
        receptionist,
        'consultar_configuracion_operativa',
        { category: null },
      ),
    ).rejects.toThrow('No tienes permiso');

    const response = await executeFrontiV2ReadTool(
      admin,
      'consultar_configuracion_operativa',
      { category: 'caja' },
    );
    const result = response.result as {
      items: Array<{ key: string; category: string }>;
    };
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.category === 'caja')).toBe(true);
    expect(result.items.some((item) => item.key.startsWith('cash.'))).toBe(true);
  });
});
