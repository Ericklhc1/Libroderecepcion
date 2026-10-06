import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ users: vi.fn(), roles: vi.fn(), departments: vi.fn(), guard: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: mocks.users }, role: { findMany: mocks.roles }, department: { findMany: mocks.departments } } }));
vi.mock('@/server/auth/guard', () => ({ requirePagePermission: mocks.guard }));
vi.mock('@/server/mail', () => ({ credentialsRecipient: async () => 'prueba@example.invalid' }));
vi.mock('@/server/services/schedule-admin-safety', () => ({ ongoingOrFutureScheduleSlots: () => ({ cancelledAt: null }) }));
vi.mock('@/server/actions/admin', () => ({ createUserAction: vi.fn(), deleteUserAction: vi.fn(), resetUserPasswordAction: vi.fn(), restoreUserAction: vi.fn(), runMaintenanceAction: vi.fn(), saveDepartmentAction: vi.fn(), saveSettingAction: vi.fn(), updateRolePermissionsAction: vi.fn(), updateUserAction: vi.fn() }));
vi.mock('@/server/actions/shifts', () => ({ scheduleShiftAction: vi.fn() }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ children, title, description }: { children: ReactNode; title: string; description?: string }) => <section><h2>{title}</h2><p>{description}</p>{children}</section> }));
vi.mock('@/components/ui/form', async (original) => ({ ...(await original<Record<string, unknown>>()), ActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form> }));

import DepartmentsPage from '@/app/(app)/admin/areas/page';
import UsersPage from '@/app/(app)/admin/usuarios/page';

const account = () => ({
  id: 'user-1', name: 'Persona sintética', username: 'persona', roleId: 'role-1',
  role: { id: 'role-1', name: 'Recepcionista', operational: true },
  departmentId: 'area-1', department: { name: 'Recepción' }, email: null, phone: null,
  emailNotificationsEnabled: true, hiddenFromSelectors: false, active: true, deletedAt: null,
  isDemo: false, mustChangePassword: false, lastLoginAt: null, lockedUntil: null, deletionReason: null,
  scheduleCollaborator: { active: true, memberships: [
    { active: true, department: { id: 'area-2', name: 'Housekeeping', active: true } },
    { active: false, department: { id: 'area-3', name: 'Mantenimiento', active: false } },
  ], _count: { slots: 3 } },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.users.mockResolvedValue([account()]);
  mocks.roles.mockResolvedValue([{ id: 'role-1', name: 'Recepcionista' }]);
  mocks.departments.mockResolvedValue([{ id: 'area-1', key: 'RECEPCION', name: 'Recepción', order: 1, active: true, _count: { entries: 2, tasks: 4, users: 1, scheduleMemberships: 3 } }]);
});

describe('Administración: alcance visible de cuentas y pertenencias', () => {
  it('separa las cuentas de área principal de las pertenencias de horarios', async () => {
    const html = renderToStaticMarkup(await DepartmentsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('1 cuentas con esta área principal');
    expect(html).toContain('3 pertenencias de horarios activas');
    expect(html).toContain('no equivalen a cuentas habilitadas');
    expect(html).toContain('bloqueará la desactivación si hay asignaciones vigentes o futuras');
    expect(mocks.guard).toHaveBeenCalledWith('system.configure');
    expect(mocks.departments).toHaveBeenCalledWith(expect.objectContaining({ include: { _count: { select: expect.objectContaining({ users: true, scheduleMemberships: { where: { active: true } } }) } } }));
  });

  it('muestra área principal, pertenencias, perfil y cuenta global antes de editar o eliminar', async () => {
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Área principal: Recepción');
    expect(html).toContain('Housekeeping · Mantenimiento (retirada) (área inactiva)');
    expect(html).toContain('Perfil de horarios activo.');
    expect(html).toContain('Cuenta activa en todo el sistema');
    expect(html).toContain('3 asignaciones vigentes o futuras al abrir esta página');
    expect(html).toContain('Cambiar el área principal no añade ni retira estas pertenencias');
    expect(html).toContain('Eliminación lógica de la cuenta en todas sus áreas');
    expect(html).toContain('href="/equipo"');
    expect(mocks.guard).toHaveBeenCalledWith('user.manage');
  });

  it('encuentra una cuenta por pertenencia adicional sin confundir su área principal', async () => {
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({ q: 'Housekeeping' }) }));
    expect(html).toContain('Persona sintética');
    expect(html).toContain('Área principal: Recepción');
  });

  it('preserva en el selector un área principal inactiva para evitar cambios involuntarios', async () => {
    mocks.departments.mockResolvedValue([{ id: 'area-2', name: 'Housekeeping' }]);
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<option value="area-1" selected="">Recepción (inactiva)</option>');
  });

  it('distingue una cuenta sin perfil y sin pertenencias de una inactiva', async () => {
    mocks.users.mockResolvedValue([{ ...account(), scheduleCollaborator: null, active: false, department: null, departmentId: null }]);
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Cuenta inactiva');
    expect(html).toContain('Sin área principal');
    expect(html).toContain('Pertenencias de horarios: ninguna.');
    expect(html).toContain('Sin perfil de horarios.');
    expect(html).toContain('0 asignaciones vigentes o futuras');
  });
});
