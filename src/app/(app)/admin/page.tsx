import Link from 'next/link';
import {
  Bug,
  Building2,
  ClipboardList,
  KeyRound,
  Mail,
  Eraser,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, StatTile } from '@/components/ui/card';
import { RunMaintenanceForm } from './admin-forms';
import {
  hasTechnicalAdminAccess,
  type PermissionKey,
} from '@/lib/permissions';

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
    href: '/admin/fronti',
    title: 'Fronti',
    description: 'Modelo, memoria, comportamiento, capacidades y diagnóstico del asistente.',
    permission: 'system.configure',
    icon: Sparkles,
  },
  {
    href: '/admin/parametros',
    title: 'Parámetros',
    description: 'Configuración del sistema y reglas operativas.',
    permission: 'system.configure',
    icon: Settings,
  },
  {
    href: '/admin/diagnostico',
    title: 'Diagnóstico y reparación',
    description: 'Detectar errores de ejecución, duplicados e inconsistencias y aplicar reparaciones seguras.',
    permission: 'system.configure',
    icon: Bug,
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
    title: 'Historial de turnos',
    description: 'Consultar trazabilidad y archivar turnos ya finalizados.',
    permission: 'shift.manage',
    icon: ClipboardList,
  },
  {
    href: '/admin/puesta-en-cero',
    title: 'Dejar el sistema en cero',
    description: 'Borrar los datos de prueba para empezar a operar limpio.',
    permission: 'system.configure',
    icon: Eraser,
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
  if (!hasTechnicalAdminAccess(user.permissions)) {
    if (user.permissions.includes('audit.view')) redirect('/admin/auditoria');
    if (user.permissions.includes('shift.manage')) redirect('/admin/turnos');
    redirect('/sin-permisos');
  }
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

      {/*
        Antes acá se explicaba un comando de consola para purgar la demo. Ya no
        hace falta: «Dejar el sistema en cero» hace lo mismo desde la pantalla,
        con la cuenta de lo que va a borrar delante y sin abrir una terminal
        contra la base de producción.
      */}
    </div>
  );
}
