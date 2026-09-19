import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { RolePermissionsForm } from '../admin-forms';
import { ROLE_KEYS } from '@/lib/permissions';

export const metadata = { title: 'Roles y permisos' };
export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  await requirePagePermission('role.manage');

  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { level: 'desc' },
    }),
    prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] }),
  ]);

  const groups = Array.from(
    permissions.reduce((map, permission) => {
      const list = map.get(permission.group) ?? [];
      list.push({ key: permission.key, name: permission.name });
      map.set(permission.group, list);
      return map;
    }, new Map<string, Array<{ key: string; name: string }>>()),
  ).map(([group, list]) => ({ group, permissions: list }));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Roles y permisos</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Los permisos se aplican en el servidor en cada acción; la interfaz sólo oculta lo que no
          corresponde. Los cambios quedan auditados.
        </p>
      </header>

      {roles.map((role) => (
        <Card key={role.id}>
          <CardHeader
            title={role.name}
            count={role.permissions.length}
            action={
              <span className="flex items-center gap-1.5">
                <Chip>{role._count.users} usuario(s)</Chip>
                {role.operational ? (
                  <Chip>Operativo</Chip>
                ) : (
                  <Chip>Fuera de la operación</Chip>
                )}
              </span>
            }
          />
          <div className="px-4 py-4">
            {role.description ? (
              <p className="mb-4 text-sm text-slate-600">{role.description}</p>
            ) : null}
            <RolePermissionsForm
              roleId={role.id}
              roleName={role.name}
              groups={groups}
              granted={role.permissions.map((rp) => rp.permission.key)}
              approvalRequired={role.permissions
                .filter((rp) => rp.requiresApproval)
                .map((rp) => rp.permission.key)}
              locked={role.key === ROLE_KEYS.SYSTEM_ADMIN}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
