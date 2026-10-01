import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({
  user: { roleKey: 'RECEPCIONISTA' },
  create: vi.fn(), change: vi.fn(), board: vi.fn(), sources: vi.fn(),
}));
vi.mock('@/server/auth/guard', () => ({ requireUser: async () => mocks.user, requirePageUser: async () => mocks.user }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/services/housekeeping', async (original) => {
  const real = await original<typeof import('@/server/services/housekeeping')>();
  return { ...real, createHousekeepingRequest: mocks.create, changeHousekeepingRequest: mocks.change, getHousekeepingBoard: mocks.board, getHousekeepingSources: mocks.sources };
});
import { createHousekeepingAction, changeHousekeepingAction } from '@/server/actions/housekeeping';
import { requireHousekeepingPageUser } from '@/server/auth/housekeeping';

describe('Housekeeping: página y acciones directas', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.roleKey = ROLE_KEYS.RECEPTIONIST; });
  it.each([ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.SUPERVISOR, ROLE_KEYS.MANAGEMENT, 'CUSTOM_ADMIN'])('rechaza la URL y las acciones para %s antes de leer o escribir', async (role) => {
    mocks.user.roleKey = role;
    await expect(requireHousekeepingPageUser()).rejects.toThrow('redirect:/sin-permisos');
    const create = await createHousekeepingAction(null, new FormData());
    const change = await changeHousekeepingAction(null, new FormData());
    expect(create.ok).toBe(false); expect(change.ok).toBe(false);
    expect(mocks.board).not.toHaveBeenCalled(); expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  });
});
