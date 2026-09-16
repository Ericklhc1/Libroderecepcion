import Link from 'next/link';
import {
  Building2,
  ClipboardList,
  KeyRound,
  Mail,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, StatTile } from '@/components/ui/card';
import { RunMaintenanceForm } from './admin-forms';
import type { PermissionKey } from '@/lib/permissions';

export const metadata = { title: 'Administración' };
export const dynamic = 'force-dynamic';

const SECTIONS: Array<{
  href: string;
  title: string;
  description: string;
  permission: PermissionKey;
  icon: typeof Users;
}> = [
  {
    href: '/admin/usuarios',
    title: 'Usuarios',
    description: 'Crear, editar, desactivar y restablecer contraseñas.',
    permission: 'user.manage',
    icon: Users,
  },
  {
    href: '/admin/roles',
    title: 'Roles y permisos',
    description: 'Matriz de permisos por rol, aplicada en el servidor.',
    permission: 'role.manage',
    icon: ShieldCheck,
  },
  {
    href: '/admin/areas',
    title: 'Áreas',
    description: 'Departamentos operativos del hotel.',
    permission: 'system.configure',
    icon: Building2,
  },
  {
    href: '/admin/parametros',
    title: 'Parámetros',
    description: 'Configuración del sistema y reglas operativas.',
    permission: 'system.configure',
    icon: Settings,
  },
  {
    href: '/admin/correo',
    title: 'Correo',
    description: 'Servidor de salida, casilla del hotel y envío de prueba.',
    permission: 'system.configure',
    icon: Mail,
  },
  {
    href: '/admin/turnos',
    title: 'Programación de turnos',
    description: 'Asignar personal a los turnos de cada día.',
    permission: 'shift.manage',
    icon: ClipboardList,
  },
  {
    href: '/admin/auditoria',
    title: 'Auditoría',
    description: 'Registro completo de cambios con usuario, fecha y valores.',
    permission: 'audit.view',
    icon: KeyRound,
  },
  {
    href: '/admin/eliminados',
    title: 'Registros eliminados',
    description: 'Recuperación de registros con eliminación lógica.',
    permission: 'entry.restore',
    icon: Trash2,
  },
];

export default async function AdminPage() {
  const user = await requirePageUser();
  const allowed = SECTIONS.filter((section) =>
    user.permissions.includes(section.permission),
  );
  if (allowed.length === 0) redirect('/sin-permisos');

  const [users, activeSessions, deletedEntries, deletedTasks, auditCount] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.operationalEntry.count({ where: { NOT: { deletedAt: null } } }),
    prisma.task.count({ where: { NOT: { deletedAt: null } } }),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Administración</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Control técnico del sistema. El rol Administrador de sistema se mantiene fuera de la
          operación habitual de turnos.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Usuarios" value={users} />
        <StatTile label="Sesiones activas" value={activeSessions} />
        <StatTile label="Registros eliminados" value={deletedEntries + deletedTasks} />
        <StatTile label="Eventos de auditoría" value={auditCount} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {allowed.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="card flex items-start gap-3 px-4 py-4 transition-colors hover:bg-slate-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-50 text-petrol-700">
                <Icon className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-medium text-petrol-900">{section.title}</span>
                <span className="block text-sm text-slate-600">{section.description}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {user.permissions.includes('system.configure') ? (
        <Card>
          <CardHeader title="Mantenimiento" />
          <div className="space-y-3 px-4 py-4">
            <p className="flex items-start gap-2 text-sm text-slate-600">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              Recalcula las alertas automáticas y los estados derivados (seguimientos vencidos,
              tareas vencidas, entregas sin confirmar). El sistema también lo hace solo al abrir el
              panel principal.
            </p>
            <RunMaintenanceForm />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Datos demo" />
        <div className="space-y-2 px-4 py-4 text-sm text-slate-600">
          <p>
            Los datos de demostración están marcados internamente y se eliminan con un solo
            comando cuando el hotel entre en producción:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-petrol-900 px-3 py-2 text-xs text-petrol-50">
            npx tsx scripts/create-admin.ts &quot;Nombre&quot; correo@hotel.com
            &quot;ContraseñaSegura1&quot;{'\n'}npm run demo:purge
          </pre>
          <p className="text-xs text-slate-500">
            La purga exige que exista al menos un Administrador de sistema real, de modo que el
            sistema nunca queda sin acceso administrativo.
          </p>
        </div>
      </Card>
    </div>
  );
}
