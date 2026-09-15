/**
 * Catálogo único de permisos y roles del sistema.
 *
 * Los permisos se persisten en base de datos (tabla Permission) y se asocian a
 * roles (RolePermission), de modo que el Administrador de sistema puede
 * modificar la matriz sin desplegar código. Este archivo define el catálogo
 * base y la matriz inicial que aplica el seed.
 */

export const PERMISSIONS = {
  'entry.create': { group: 'Libro operativo', name: 'Crear registros' },
  'entry.edit': { group: 'Libro operativo', name: 'Editar registros' },
  'entry.delete': { group: 'Libro operativo', name: 'Eliminar registros' },
  'entry.close': { group: 'Libro operativo', name: 'Cerrar registros' },
  'entry.reopen': { group: 'Libro operativo', name: 'Reabrir registros' },
  'entry.restore': { group: 'Libro operativo', name: 'Restaurar registros eliminados' },

  'task.create': { group: 'Tareas', name: 'Crear tareas' },
  'task.assign': { group: 'Tareas', name: 'Asignar y reasignar tareas' },
  'task.edit': { group: 'Tareas', name: 'Editar tareas' },
  'task.close': { group: 'Tareas', name: 'Completar o cancelar tareas' },

  'incident.create': { group: 'Incidencias', name: 'Crear incidencias' },
  'incident.manage': { group: 'Incidencias', name: 'Gestionar incidencias' },
  'incident.close': { group: 'Incidencias', name: 'Cerrar incidencias' },

  'followup.create': { group: 'Seguimientos', name: 'Crear seguimientos' },
  'followup.manage': { group: 'Seguimientos', name: 'Gestionar seguimientos' },

  'alert.manage': { group: 'Alertas', name: 'Gestionar alertas' },

  'shift.start': { group: 'Turnos', name: 'Iniciar turno' },
  'shift.receive': { group: 'Turnos', name: 'Recibir turno' },
  'shift.handover': { group: 'Turnos', name: 'Entregar turno' },
  'shift.close': { group: 'Turnos', name: 'Cerrar turno' },
  'shift.manage': { group: 'Turnos', name: 'Programar y administrar turnos' },

  'nightaudit.run': { group: 'Auditoría nocturna', name: 'Controles y cierre nocturno' },

  'metrics.view': { group: 'Indicadores', name: 'Ver indicadores' },
  'audit.view': { group: 'Auditoría', name: 'Ver registro de auditoría' },

  'guest.manage': { group: 'Huéspedes y reservas', name: 'Gestionar referencias de huésped y reserva' },

  'user.manage': { group: 'Administración', name: 'Administrar usuarios' },
  'role.manage': { group: 'Administración', name: 'Administrar roles y permisos' },
  'system.configure': { group: 'Administración', name: 'Configurar el sistema' },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = {
  SYSTEM_ADMIN: 'ADMINISTRADOR_SISTEMA',
  SUPERVISOR: 'SUPERVISOR',
  RECEPTIONIST: 'RECEPCIONISTA',
  NIGHT_AUDITOR: 'AUDITOR_NOCTURNO',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

const OPERATIONAL_BASE: PermissionKey[] = [
  'entry.create',
  'entry.edit',
  'entry.close',
  'task.create',
  'task.edit',
  'task.close',
  'task.assign',
  'incident.create',
  'followup.create',
  'followup.manage',
  'alert.manage',
  'shift.start',
  'shift.receive',
  'shift.handover',
  'shift.close',
  'guest.manage',
  'metrics.view',
];

/**
 * Matriz inicial de permisos por rol.
 *
 * El Administrador de sistema concentra el control técnico y queda fuera de la
 * operación habitual: no recibe permisos de turno porque no debe participar en
 * el ciclo operativo (ver `operational: false` en el rol).
 */
export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  [ROLE_KEYS.SYSTEM_ADMIN]: ALL_PERMISSIONS.filter(
    (p) => !['shift.start', 'shift.receive', 'shift.handover'].includes(p),
  ),
  [ROLE_KEYS.SUPERVISOR]: [
    ...OPERATIONAL_BASE,
    'entry.reopen',
    'entry.delete',
    'incident.manage',
    'incident.close',
    'shift.manage',
    'audit.view',
  ],
  [ROLE_KEYS.RECEPTIONIST]: [...OPERATIONAL_BASE],
  [ROLE_KEYS.NIGHT_AUDITOR]: [
    ...OPERATIONAL_BASE,
    'incident.manage',
    'nightaudit.run',
  ],
};

export const ROLE_DEFINITIONS: Array<{
  key: RoleKey;
  name: string;
  description: string;
  level: number;
  operational: boolean;
}> = [
  {
    key: ROLE_KEYS.SYSTEM_ADMIN,
    name: 'Administrador de sistema',
    description:
      'Control técnico total: usuarios, roles, permisos, configuración, auditoría, eliminación y recuperación de registros. Fuera de la operación habitual.',
    level: 100,
    operational: false,
  },
  {
    key: ROLE_KEYS.SUPERVISOR,
    name: 'Supervisor',
    description:
      'Visión completa de la operación: reasigna, cierra y reabre asuntos, revisa entregas y consulta métricas e historial.',
    level: 60,
    operational: true,
  },
  {
    key: ROLE_KEYS.RECEPTIONIST,
    name: 'Recepcionista',
    description:
      'Operación diaria de recepción: turnos, novedades, incidencias, tareas, pendientes y entregas.',
    level: 30,
    operational: true,
  },
  {
    key: ROLE_KEYS.NIGHT_AUDITOR,
    name: 'Auditor nocturno',
    description:
      'Operación nocturna: controles, revisión de pendientes, conciliaciones, validación del cierre diario y anomalías nocturnas.',
    level: 40,
    operational: true,
  },
];
