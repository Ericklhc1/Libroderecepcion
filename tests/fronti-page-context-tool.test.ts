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

  it('entiende el filtro actual de Central de Reservas sin inventar otro estado', async () => {
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      username: 'fronti-context-admin',
    });
    const page = resolveFrontiPageContext({
      pathname: '/central-reservas',
      search: '?vista=24h&q=nadie',
    });

    const result = (await executeFrontiPageContextTool(admin, page)) as {
      page: { moduleKey: string; sectionKey: string; filters: Record<string, string> };
      snapshot: {
        view: string;
        query: string | null;
        counts: { visible: number };
        reservations: unknown[];
      };
    };

    expect(result.page.moduleKey).toBe('central-reservas');
    expect(result.page.sectionKey).toBe('24h');
    expect(result.page.filters.q).toBe('nadie');
    expect(result.snapshot.view).toBe('24h');
    expect(result.snapshot.query).toBe('nadie');
    expect(result.snapshot.counts.visible).toBe(0);
    expect(result.snapshot.reservations).toEqual([]);
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
});
