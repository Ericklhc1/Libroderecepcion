import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS, type PermissionKey } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({
  user: { roleKey: 'RECEPCIONISTA', permissions: [] as PermissionKey[] },
  create: vi.fn(), change: vi.fn(), board: vi.fn(), sources: vi.fn(), gate: vi.fn(),
}));
vi.mock('@/server/auth/guard', () => ({ requireUser: async () => mocks.user, requirePageUser: async () => mocks.user }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('@/server/services/reception-operation-gate', () => ({ assertReceptionOperationPermission: mocks.gate }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/services/housekeeping', async (original) => {
  const real = await original<typeof import('@/server/services/housekeeping')>();
  return { ...real, createHousekeepingRequest: mocks.create, changeHousekeepingRequest: mocks.change, getHousekeepingBoard: mocks.board, getHousekeepingSources: mocks.sources };
});
import { createHousekeepingAction, changeHousekeepingAction } from '@/server/actions/housekeeping';
import { requireHousekeepingPageUser } from '@/server/auth/housekeeping';

describe('Housekeeping: página y acciones directas', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.roleKey = ROLE_KEYS.RECEPTIONIST; mocks.user.permissions = []; mocks.gate.mockResolvedValue(undefined); });
  it.each([ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.SUPERVISOR, ROLE_KEYS.MANAGEMENT, 'CUSTOM_ADMIN'])('rechaza la URL y las acciones para %s antes de leer o escribir', async (role) => {
    mocks.user.roleKey = role;
    await expect(requireHousekeepingPageUser()).rejects.toThrow('redirect:/sin-permisos');
    const create = await createHousekeepingAction(null, new FormData());
    const change = await changeHousekeepingAction(null, new FormData());
    expect(create.ok).toBe(false); expect(change.ok).toBe(false);
    expect(mocks.board).not.toHaveBeenCalled(); expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  });
  it('permite consultar, pero bloquea acciones directas con permiso de lectura', async () => {
    mocks.user.permissions = ['housekeeping.view'];
    await expect(requireHousekeepingPageUser()).resolves.toBe(mocks.user);
    expect((await createHousekeepingAction(null, new FormData())).ok).toBe(false);
    expect((await changeHousekeepingAction(null, new FormData())).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  });

  it('no permite que el permiso nuevo evite el bloqueo operativo de Recepción', async () => {
    mocks.user.permissions = ['housekeeping.manage'];
    mocks.gate.mockRejectedValue(new Error('Debes iniciar tu turno antes de operar.'));
    expect((await createHousekeepingAction(null, new FormData())).ok).toBe(false);
    expect((await changeHousekeepingAction(null, new FormData())).ok).toBe(false);
    expect(mocks.gate).toHaveBeenCalledWith(mocks.user, 'housekeeping.manage');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  });

});
