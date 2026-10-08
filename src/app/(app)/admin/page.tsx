import { taskFollowUpReadWhere } from '@/server/services/followup-access';
import {auditFollowUpReadWhere} from '@/server/services/followup-access';
import { scheduleAuditVisibility } from '@/server/services/schedule-access';
import Link from 'next/link';
import {
  Bug,
  Building2,
  ClipboardList,
  KeyRound,
  Mail,
  Inbox,
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
import { housekeepingAuditVisibility } from '@/server/services/housekeeping';
import { DisclosureCard, StatTile } from '@/components/ui/card';
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
    title: 'Personas y acceso',
    description: 'Cuentas, acceso efectivo, áreas y estado global de cada persona.',
    permission: 'user.manage',
    icon: Users,
  },
  {
    href: '/admin/roles',
    title: 'Roles y reglas de acceso',
    description: 'Permisos reales por rol y configuración guiada por actividad.',
    permission: 'role.manage',
    icon: ShieldCheck,
  },
  {
    href: '/admin/areas',
    title: 'Departamentos',
    description: 'Estructura operativa configurable del hotel.',
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
    href: '/admin/soporte',
    title: 'Reportes y solicitudes',
    description: 'Bandeja interna de problemas y funciones solicitadas desde AROH.',
    permission: 'support.view',
    icon: Inbox,
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
    href: '/admin/limpieza',
    title: 'Limpiar datos individuales',
    description: 'Mensajes de Fronti, notificaciones, Caja y trabajos HK, con confirmación y auditoría. Sólo SysAdmin.',
    permission: 'system.configure',
    icon: Trash2,
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

const ADMIN_GROUPS = [
  {
    id: 'departamentos',
    title: 'Departamentos',
    description: 'Estructura del hotel. Configurar aquí no ejecuta trabajo diario.',
    hrefs: ['/admin/areas'],
  },
  {
    id: 'personas',
    title: 'Personas y acceso',
    description: 'Cuentas, roles, permisos, alcance y excepciones.',
    hrefs: ['/admin/usuarios', '/admin/roles'],
  },
  {
    id: 'reglas',
    title: 'Reglas de trabajo',
    description: 'Parámetros, comunicaciones y comportamiento de Fronti.',
    hrefs: ['/admin/parametros', '/admin/correo', '/admin/fronti'],
  },
  {
    id: 'estado',
    title: 'Estado operativo',
    description: 'Diagnóstico, soporte y trazabilidad del sistema.',
    hrefs: ['/admin/diagnostico', '/admin/soporte', '/admin/turnos', '/admin/auditoria', '/admin/eliminados', '/admin/limpieza', '/admin/puesta-en-cero'],
  },
] as const;

export default async function AdminPage() {
  const user = await requirePageUser();
  if (!hasTechnicalAdminAccess(user.permissions)) {
    if (user.permissions.includes('support.view')) redirect('/admin/soporte');
    if (user.permissions.includes('audit.view')) redirect('/admin/auditoria');
    if (user.permissions.includes('shift.manage')) redirect('/admin/turnos');
    redirect('/sin-permisos');
  }
  const allowed = SECTIONS.filter((section) =>
    user.permissions.includes(section.permission) && (section.href !== '/admin/limpieza' || user.isSystemAdmin),
  );
  if (allowed.length === 0) redirect('/sin-permisos');

  const [users, activeSessions, deletedEntries, deletedTasks, auditCount] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.operationalEntry.count({ where: { NOT: { deletedAt: null } } }),
    prisma.task.count({ where: { AND: [taskFollowUpReadWhere(user)], NOT: { deletedAt: null } } }),
    prisma.auditLog.count({ where: { AND: [housekeepingAuditVisibility(user), await scheduleAuditVisibility(user),auditFollowUpReadWhere(user)] } }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Administración</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Control técnico y operativo del sistema. Las acciones conservan su autoría y auditoría.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Usuarios" value={users} />
        <StatTile label="Sesiones activas" value={activeSessions} />
        <StatTile label="Registros eliminados" value={deletedEntries + deletedTasks} />
        <StatTile label="Eventos de auditoría" value={auditCount} />
      </div>

      {user.isSystemAdmin ? (
        <Link href="/admin/mantenimiento" className="block rounded-lg border border-amber-200 bg-white p-4">
          <span className="block font-semibold text-petrol-900">Modo mantenimiento</span>
          <span className="text-sm text-slate-600">Pausar temporalmente la operación del personal y reabrir al terminar.</span>
        </Link>
      ) : null}

      {ADMIN_GROUPS.map((group) => {
        const sections = allowed.filter((section) => group.hrefs.some((href) => href === section.href));
        if (sections.length === 0) return null;
        return (
          <DisclosureCard
            key={group.id}
            title={group.title}
            defaultOpen
            description={group.description}
            count={sections.length}
          >
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <Link
                    key={section.href}
                    href={section.href}
                    className="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-4 transition-colors hover:bg-slate-50"
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
          </DisclosureCard>
        );
      })}

      {user.permissions.includes('system.configure') ? (
        <DisclosureCard
          title="Mantenimiento"
          description="Acciones técnicas que normalmente no necesitas tener abiertas."
        >
          <div className="space-y-3 p-4">
            <p className="flex items-start gap-2 text-sm text-slate-600">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              Recalcula las alertas automáticas y los estados derivados (seguimientos vencidos,
              tareas vencidas, entregas sin confirmar). El sistema también lo hace solo al abrir el
              panel principal.
            </p>
            <RunMaintenanceForm />
          </div>
        </DisclosureCard>
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
