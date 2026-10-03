import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority } from '@prisma/client';
import { ROLE_KEYS } from '@/lib/permissions';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import {
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('Fronti contextual · lector vivo de pantalla', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('lee directamente la entidad abierta en Novedades', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'fronti-context-entry',
    });
    const entry = await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Pendiente contextual',
        description: 'Fronti debe saber qué registro está abierto.',
        priority: Priority.ALTA,
        createdById: receptionist.id,
        ownerId: receptionist.id,
      },
    });

    const page = resolveFrontiPageContext({
      pathname: '/libro/' + entry.id,
      title: 'Pendiente contextual',
    });
    const result = (await executeFrontiPageContextTool(receptionist, page)) as {
      page: { moduleKey: string; entityType: string; entityId: string };
      snapshot: { found: boolean; ref: string; title: string; priority: string };
    };

    expect(result.page).toEqual(
      expect.objectContaining({
        moduleKey: 'novedades',
        entityType: 'OperationalEntry',
        entityId: entry.id,
      }),
    );
    expect(result.snapshot).toEqual(
      expect.objectContaining({
        found: true,
        ref: '#' + entry.humanId,
        title: 'Pendiente contextual',
        priority: Priority.ALTA,
      }),
    );
  });

  it('lee el monitor operacional de una habitación sin consultar estado PMS', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'fronti-context-room-monitor',
    });
    const room = await prisma.room.findFirstOrThrow({ where: { number: '512' } });
    const entry = await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Contexto de habitación',
        description: 'Debe aparecer en el monitor de la 512.',
        priority: Priority.ALTA,
        createdById: receptionist.id,
        roomId: room.id,
      },
    });

    const page = resolveFrontiPageContext({
      pathname: '/novedades/habitacion',
      search: '?habitacion=512',
    });
    const result = (await executeFrontiPageContextTool(receptionist, page)) as {
      page: { moduleKey: string; filters: Record<string, string> };
      snapshot: {
        summary: { total: number };
        selectedRoom: {
          room: { number: string };
          entries: Array<{ id: string }>;
        };
        note: string;
      };
    };

    expect(result.page.moduleKey).toBe('novedades-habitacion');
    expect(result.page.filters.habitacion).toBe('512');
    expect(result.snapshot.summary.total).toBe(89);
    expect(result.snapshot.selectedRoom.room.number).toBe('512');
    expect(result.snapshot.selectedRoom.entries.map((item) => item.id)).toContain(entry.id);
    expect(result.snapshot.note).toMatch(/no representa ocupación/i);
  });

  it('Central de Reservas sólo conserva una redirección de compatibilidad', async () => {
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      username: 'fronti-context-legacy-central',
    });
    const page = resolveFrontiPageContext({ pathname: '/central-reservas' });
    const result = (await executeFrontiPageContextTool(admin, page)) as {
      snapshot: { legacy: boolean; redirectTo: string; note: string };
    };

    expect(result.snapshot.legacy).toBe(true);
    expect(result.snapshot.redirectTo).toBe('/novedades/habitacion');
    expect(result.snapshot.note).toContain('FNSrooms');
    expect(JSON.stringify(result.snapshot)).not.toMatch(/checkIn|checkOut|balanceDue|reservations/);
  });

  it('no abre contexto administrativo a Recepción', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'fronti-context-denied',
    });
    const page = resolveFrontiPageContext({ pathname: '/admin/diagnostico' });

    await expect(executeFrontiPageContextTool(receptionist, page)).rejects.toThrow(
      'No tienes permisos administrativos',
    );
  });

  it('la pantalla de llaves puede filtrar por piso usando la proyección real del inventario', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'fronti-context-keys',
    });
    const page = resolveFrontiPageContext({
      pathname: '/llaves',
      search: '?piso=4',
    });

    const result = (await executeFrontiPageContextTool(receptionist, page)) as {
      snapshot: {
        floor: string;
        keys: Array<{ roomNumber: string | null }>;
      };
    };

    expect(result.snapshot.floor).toBe('4');
    expect(
      result.snapshot.keys.every(
        (key) => !key.roomNumber || key.roomNumber.startsWith('4'),
      ),
    ).toBe(true);
  });

  it('respeta la vista seleccionada de Coordinación al dar contexto a Fronti', async () => {
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      username: 'fronti-context-coordination-view',
    });
    const area = await prisma.department.findUniqueOrThrow({ where: { key: 'MANTENIMIENTO' } });
    const clarification = await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Aclaración contextual',
        description: 'Visible sólo en la vista de aclaraciones.',
        priority: Priority.MEDIA,
        departmentId: area.id,
        createdById: admin.id,
        ownerId: admin.id,
        status: 'EN_ESPERA',
        workAssignedAt: new Date(),
        workAcknowledgedAt: new Date(),
        workAcknowledgedById: admin.id,
        workNextAction: 'Aclaración requerida: confirmar acceso',
      },
    });
    await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Pendiente normal fuera del filtro',
        description: 'No debe entrar al contexto de esta pantalla.',
        priority: Priority.MEDIA,
        departmentId: area.id,
        createdById: admin.id,
        ownerId: admin.id,
      },
    });
    const page = resolveFrontiPageContext({
      pathname: '/coordinacion',
      search: '?vista=clarification',
    });
    const result = (await executeFrontiPageContextTool(admin, page)) as {
      snapshot: { rows: Array<{ id: string }> };
    };
    expect(result.snapshot.rows.map((row) => row.id)).toEqual([clarification.id]);
  });

});
