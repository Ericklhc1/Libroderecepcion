import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  cashApprovalRequired,
  listCashApproverIds,
} from '@/server/services/cash-permission-policy';

describe('matriz granular de Caja', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
    await prisma.rolePermission.updateMany({
      data: { requiresApproval: false },
    });
  });

  it('tener permiso no implica autorización por defecto', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    expect(await cashApprovalRequired(user, 'cash.manual_in')).toBe(false);
    expect(await cashApprovalRequired(user, 'cash.manual_out')).toBe(false);
  });

  it('puede exigir autorización por rol y operación sin quitar el permiso', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'cash.manual_out' },
      select: { id: true },
    });

    await prisma.rolePermission.update({
      where: {
        roleId_permissionId: {
          roleId: user.roleId,
          permissionId: permission.id,
        },
      },
      data: { requiresApproval: true },
    });

    expect(user.permissions).toContain('cash.manual_out');
    expect(await cashApprovalRequired(user, 'cash.manual_out')).toBe(true);
    expect(await cashApprovalRequired(user, 'cash.manual_in')).toBe(false);
  });

  it('quien puede aprobar no se pide autorización a sí mismo', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'cash.manual_out' },
      select: { id: true },
    });

    await prisma.rolePermission.update({
      where: {
        roleId_permissionId: {
          roleId: supervisor.roleId,
          permissionId: permission.id,
        },
      },
      data: { requiresApproval: true },
    });

    expect(supervisor.permissions).toContain('cash.approve');
    expect(await cashApprovalRequired(supervisor, 'cash.manual_out')).toBe(false);
  });

  it('los autorizadores salen de la propia matriz de permisos', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const ids = await listCashApproverIds();
    expect(ids).toContain(supervisor.id);
  });
});
