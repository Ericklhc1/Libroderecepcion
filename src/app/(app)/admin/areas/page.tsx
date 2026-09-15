import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { DepartmentDialog } from '../admin-forms';

export const metadata = { title: 'Áreas' };
export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  await requirePagePermission('system.configure');

  const departments = await prisma.department.findMany({
    include: { _count: { select: { entries: true, tasks: true, users: true } } },
    orderBy: { order: 'asc' },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Áreas</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Departamentos usados para clasificar registros, tareas y alertas. Las áreas con
            historial se desactivan en lugar de eliminarse.
          </p>
        </div>
        <DepartmentDialog />
      </header>

      <Card>
        <CardHeader title="Listado" count={departments.length} />
        <ul className="divide-y divide-slate-100">
          {departments.map((department) => (
            <li
              key={department.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-petrol-900">{department.name}</p>
                  <code className="text-xs text-slate-400">{department.key}</code>
                  {department.active ? (
                    <Badge tone="resuelto">Activa</Badge>
                  ) : (
                    <Badge tone="neutro">Inactiva</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  <Chip>{department._count.entries} registros</Chip>{' '}
                  <Chip>{department._count.tasks} tareas</Chip>{' '}
                  <Chip>{department._count.users} personas</Chip>
                </p>
              </div>
              <DepartmentDialog
                department={{
                  id: department.id,
                  key: department.key,
                  name: department.name,
                  order: department.order,
                  active: department.active,
                }}
              />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
