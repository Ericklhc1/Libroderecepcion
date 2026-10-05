import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Badge, Chip } from '@/components/ui/badge';
import { CardScroll, DisclosureCard, EmptyState } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import type { RawSearchParams } from '@/lib/search-params';
import {
  CreateUserDialog,
  DeleteUserDialog,
  EditUserDialog,
  ResetPasswordDialog,
  RestoreUserForm,
} from '../admin-forms';
import { formatDateTime } from '@/lib/format';
import { displayUsername } from '@/domain/username';
import { credentialsRecipient } from '@/server/mail';
import { ongoingOrFutureScheduleSlots } from '@/server/services/schedule-admin-safety';

export const metadata = { title: 'Usuarios' };
export const dynamic = 'force-dynamic';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('user.manage');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const estado = typeof params.estado === 'string' ? params.estado : '';
  const rol = typeof params.rol === 'string' ? params.rol : '';

  // La casilla de credenciales ahora sale de la base, así que entra en el
  // mismo Promise.all en vez de encadenar una espera más.
  const [users, roles, departments, credentialsMailTo] = await Promise.all([
    prisma.user.findMany({
      include: {
        role: true,
        department: { select: { name: true } },
        scheduleCollaborator: { select: {
          active: true,
          memberships: { select: { active: true, department: { select: { id: true, name: true, active: true } } }, orderBy: { department: { name: 'asc' } } },
          _count: { select: { slots: { where: ongoingOrFutureScheduleSlots() } } },
        } },
      },
      orderBy: [{ deletedAt: 'asc' }, { role: { level: 'desc' } }, { name: 'asc' }],
    }),
    prisma.role.findMany({ orderBy: { level: 'desc' } }),
    prisma.department.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    credentialsRecipient(),
  ]);

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const visibleUsers = users.filter((user) => {
    const statusMatches =
      !estado ||
      (estado === 'activas' && user.active && !user.deletedAt) ||
      (estado === 'inactivas' && !user.active && !user.deletedAt) ||
      (estado === 'eliminadas' && Boolean(user.deletedAt));
    const roleMatches = !rol || user.roleId === rol;
    const text = [
      user.name,
      user.username,
      user.role.name,
      user.department?.name,
      ...(user.scheduleCollaborator?.memberships.map((membership) => membership.department.name) ?? []),
      user.email,
      user.phone,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return statusMatches && roleMatches && (!q || text.includes(q));
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Usuarios</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            El estado de la cuenta es global. Al desactivar o cambiar el rol se revocan sus sesiones.
            El área principal y las pertenencias de horarios tienen efectos distintos.
          </p>
        </div>
        <CreateUserDialog
          roles={roleOptions}
          departments={departmentOptions}
          credentialsMailTo={credentialsMailTo}
        />
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar nombre, usuario, correo, rol, área…"
        clearHref="/admin/usuarios"
      >
        <label className="min-w-[11rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
          <select name="estado" defaultValue={estado} className="input-base w-full">
            <option value="">Todos</option>
            <option value="activas">Activas</option>
            <option value="inactivas">Inactivas</option>
            <option value="eliminadas">Eliminadas</option>
          </select>
        </label>
        <label className="min-w-[13rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Rol</span>
          <select name="rol" defaultValue={rol} className="input-base w-full">
            <option value="">Todos</option>
            {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </label>
      </ListFilterBar>

      <DisclosureCard title="Cuentas" description="Usuarios activos, desactivados y sus acciones administrativas." count={visibleUsers.length} defaultOpen>
        
        {visibleUsers.length === 0 ? (
          <EmptyState message="No hay usuarios." />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleUsers.map((user) => (
              <li
                key={user.id}
                className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${
                  user.deletedAt ? 'bg-slate-50' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-petrol-900">{user.name}</p>
                    <span className="text-sm font-medium text-petrol-600">
                      {displayUsername(user.username)}
                    </span>
                    <Chip>{user.role.name}</Chip>
                    {!user.role.operational ? <Chip>Fuera de operación</Chip> : null}
                    {user.hiddenFromSelectors ? <Chip>Oculto</Chip> : null}
                    {user.active ? (
                      <Badge tone="resuelto">Cuenta activa</Badge>
                    ) : (
                      <Badge tone="neutro">Cuenta inactiva</Badge>
                    )}
                    {user.deletedAt ? <Badge tone="critico">Eliminada</Badge> : null}
                    {user.isDemo ? <Chip>Demo</Chip> : null}
                    {user.mustChangePassword ? <Chip>Debe cambiar contraseña</Chip> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Área principal: {user.department?.name ?? 'Sin área principal'}
                    {user.email ? ` · ${user.email}` : ' · sin correo'}
                    {user.email && !user.emailNotificationsEnabled ? ' · avisos por correo desactivados' : ''}
                    {user.phone ? ` · ${user.phone}` : ''} · último ingreso{' '}
                    {formatDateTime(user.lastLoginAt)}
                    {user.lockedUntil && user.lockedUntil > new Date()
                      ? ` · bloqueada hasta ${formatDateTime(user.lockedUntil)}`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Pertenencias de horarios: {user.scheduleCollaborator?.memberships.length
                      ? user.scheduleCollaborator.memberships.map((membership) => `${membership.department.name}${membership.active ? '' : ' (retirada)'}${membership.department.active ? '' : ' (área inactiva)'}`).join(' · ')
                      : 'ninguna'}.
                    {' '}{user.scheduleCollaborator ? `Perfil de horarios ${user.scheduleCollaborator.active ? 'activo' : 'inactivo'}.` : 'Sin perfil de horarios.'}
                    {' '}{user.scheduleCollaborator?._count.slots ?? 0} asignaciones vigentes o futuras en todas las áreas (incluye borradores).
                  </p>
                  {user.deletionReason ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Motivo de eliminación: {user.deletionReason}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-1.5 no-print">
                  {user.deletedAt ? (
                    <RestoreUserForm userId={user.id} />
                  ) : (
                    <>
                      <EditUserDialog
                        user={{
                          id: user.id,
                          name: user.name,
                          roleId: user.roleId,
                          departmentId: user.departmentId,
                          email: user.email,
                          emailNotificationsEnabled: user.emailNotificationsEnabled,
                          hiddenFromSelectors: user.hiddenFromSelectors,
                          phone: user.phone,
                          active: user.active,
                          scheduleAreas: user.scheduleCollaborator?.memberships.filter((membership) => membership.active).map((membership) => membership.department.name) ?? [],
                          scheduleAssignmentCount: user.scheduleCollaborator?._count.slots ?? 0,
                        }}
                        roles={roleOptions}
                        departments={user.departmentId && !departmentOptions.some((department) => department.value === user.departmentId)
                          ? [...departmentOptions, { value: user.departmentId, label: `${user.department?.name ?? 'Área principal'} (inactiva)` }]
                          : departmentOptions}
                      />
                      <ResetPasswordDialog userId={user.id} name={user.name} />
                      <DeleteUserDialog userId={user.id} name={user.name} scheduleAssignmentCount={user.scheduleCollaborator?._count.slots ?? 0} />
                    </>
                  )}
                </div>
              </li>
            ))}
            </ul>
          </CardScroll>
        )}
      </DisclosureCard>
    </div>
  );
}
