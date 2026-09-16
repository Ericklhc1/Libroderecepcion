import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
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

export const metadata = { title: 'Usuarios' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  await requirePagePermission('user.manage');

  // La casilla de credenciales ahora sale de la base, así que entra en el
  // mismo Promise.all en vez de encadenar una espera más.
  const [users, roles, departments, credentialsMailTo] = await Promise.all([
    prisma.user.findMany({
      include: { role: true, department: { select: { name: true } } },
      orderBy: [{ deletedAt: 'asc' }, { role: { level: 'desc' } }, { name: 'asc' }],
    }),
    prisma.role.findMany({ orderBy: { level: 'desc' } }),
    prisma.department.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    credentialsRecipient(),
  ]);

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));

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
            Al desactivar o cambiar el rol de un usuario se revocan sus sesiones activas.
          </p>
        </div>
        <CreateUserDialog
          roles={roleOptions}
          departments={departmentOptions}
          credentialsMailTo={credentialsMailTo}
        />
      </header>

      <Card>
        <CardHeader title="Cuentas" count={users.length} />
        {users.length === 0 ? (
          <EmptyState message="No hay usuarios." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.map((user) => (
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
                    {user.active ? (
                      <Badge tone="resuelto">Activa</Badge>
                    ) : (
                      <Badge tone="neutro">Inactiva</Badge>
                    )}
                    {user.deletedAt ? <Badge tone="critico">Eliminada</Badge> : null}
                    {user.isDemo ? <Chip>Demo</Chip> : null}
                    {user.mustChangePassword ? <Chip>Debe cambiar contraseña</Chip> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {user.department?.name ?? 'Sin área'}
                    {user.phone ? ` · ${user.phone}` : ''} · último ingreso{' '}
                    {formatDateTime(user.lastLoginAt)}
                    {user.lockedUntil && user.lockedUntil > new Date()
                      ? ` · bloqueada hasta ${formatDateTime(user.lockedUntil)}`
                      : ''}
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
                          phone: user.phone,
                          active: user.active,
                        }}
                        roles={roleOptions}
                        departments={departmentOptions}
                      />
                      <ResetPasswordDialog userId={user.id} name={user.name} />
                      <DeleteUserDialog userId={user.id} name={user.name} />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
