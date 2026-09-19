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

  /*
    Ver sin poder tocar. Existen porque antes ver la ficha de un huésped
    exigía `guest.manage`, que además permite EDITARLO, y ver Supervisión
    exigía gestionar incidencias. Un rol de consulta no puede necesitar
    permisos de escritura para mirar.
  */
  'guest.view': { group: 'Huéspedes y reservas', name: 'Consultar huéspedes y reservas' },
  'guest.manage': { group: 'Huéspedes y reservas', name: 'Gestionar referencias de huésped y reserva' },
  'supervision.view': { group: 'Supervisión', name: 'Consultar el tablero de supervisión' },

  'room.view': { group: 'Habitaciones y llaves', name: 'Ver el estado de habitaciones' },
  'room.manage': { group: 'Habitaciones y llaves', name: 'Confirmar salidas y check-in' },
  'key.assign': { group: 'Habitaciones y llaves', name: 'Entregar y recibir llaves' },
  'key.stock': { group: 'Habitaciones y llaves', name: 'Administrar el stock de llaves' },
  'pms.import': { group: 'Habitaciones y llaves', name: 'Importar informes del PMS' },
  /*
    Reparación, no operación: elimina lógicamente una estadía incoherente para
    desatascar un conflicto de llaves. Es del Administrador de sistema y no lo
    deja como responsable de ninguna llegada ni salida.
  */
  'stay.delete': { group: 'Habitaciones y llaves', name: 'Eliminar una estadía para resolver conflictos' },
  /*
    Reparación también, pero de la habitación entera: colapsa las estadías
    duplicadas que impiden confirmar un check-in o un check-out. La tienen el
    Administrador de sistema y el Supervisor, porque el atasco ocurre en el
    mesón y hay que poder resolverlo sin esperar al administrador.
  */
  'room.reset': { group: 'Habitaciones y llaves', name: 'Resetear una habitación atascada' },
  'conflict.resolve_all': {
    group: 'Supervisión',
    name: 'Resolver todos los conflictos operativos',
  },

  /*
    Emitir comunicados obligatorios, que BLOQUEAN la pantalla hasta que se
    confirme la lectura. Es del Supervisor: es él quien tiene que poder parar
    el mesón para decir algo. Confirmar no necesita permiso, sólo sesión.
  */
  'announcement.manage': { group: 'Supervisión', name: 'Emitir comunicados obligatorios' },

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
  MANAGEMENT: 'GERENCIA',
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
  'guest.view',
  'guest.manage',
  'metrics.view',
  'room.view',
  'room.manage',
  'key.assign',
  'pms.import',
];

/**
 * Matriz inicial de permisos por rol.
 *
 * El Administrador de sistema concentra el control técnico y queda fuera de la
 * operación habitual: no recibe permisos de turno porque no debe participar en
 * el ciclo operativo (ver `operational: false` en el rol).
 */
export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  /*
    El Administrador de sistema queda fuera de la **operación habitual**: no
    inicia, recibe ni entrega turno, no confirma salidas ni entradas, y no
    entrega llaves. Esas son las acciones en que aparecería como responsable
    operativo de algo, y es justo lo que no debe ocurrir.

    Sí importa los informes del PMS. Cargar los tres informes del día no es
    operar: es alimentar el sistema con su fuente de datos, más cerca de la
    configuración que del mesón. Excluirlo dejaba un callejón sin salida —la
    persona que instala el hotel no podía cargar el primer día de datos— sin
    proteger nada, porque la importación no asigna a nadie como responsable.
  */
  [ROLE_KEYS.SYSTEM_ADMIN]: ALL_PERMISSIONS.filter(
    (p) =>
      ![
        'shift.start',
        'shift.receive',
        'shift.handover',
        'room.manage',
        'key.assign',
      ].includes(p),
  ),
  [ROLE_KEYS.SUPERVISOR]: [
    ...OPERATIONAL_BASE,
    'entry.reopen',
    'entry.delete',
    'incident.manage',
    'incident.close',
    'shift.manage',
    'audit.view',
    'key.stock',
    'room.reset',
    'conflict.resolve_all',
    'announcement.manage',
    'supervision.view',
  ],
  [ROLE_KEYS.RECEPTIONIST]: [...OPERATIONAL_BASE],
  /*
    El Auditor nocturno es un perfil DE RECEPCIÓN, y por eso NO lleva
    `supervision.view`. Lo llevaba, y con eso le aparecía la pestaña de
    Supervisión: Supervisión es la pantalla de quien revisa el trabajo del
    mesón, no la de quien está en el mesón.

    Conserva `incident.manage`, que es otra cosa: de noche hay que poder
    registrar y mover una incidencia sin despertar a nadie.
  */
  [ROLE_KEYS.NIGHT_AUDITOR]: [
    ...OPERATIONAL_BASE,
    'incident.manage',
    'nightaudit.run',
  ],
  /*
    Gerencia SÓLO CONSULTA. Ni un permiso de escritura: no crea, no edita, no
    cierra, no asigna, no opera turnos ni llaves.

    Lo que sí puede hacer es actuar sobre aquello de lo que es RESPONSABLE, y
    eso no se concede con un permiso —sería un permiso sobre todo— sino
    comprobando la propiedad del registro concreto en el servidor. Vive en
    `canActOnOwned` y lo aplican las acciones una por una.

    `operational: true` en el rol, porque tiene que poder figurar como
    responsable. No puede tomar turnos igualmente: le faltan `shift.start`,
    `shift.receive` y `shift.handover`.
  */
  [ROLE_KEYS.MANAGEMENT]: [
    'guest.view',
    'supervision.view',
    'metrics.view',
    'room.view',
    'audit.view',
    // Excepción expresa: reparación masiva auditada, no operación de mesón.
    'conflict.resolve_all',
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
    key: ROLE_KEYS.MANAGEMENT,
    name: 'Gerencia de operaciones',
    description:
      'Consulta toda la operación sin intervenirla. Puede actuar únicamente sobre lo que se le asigne como responsable, y sólo el Supervisor puede asignárselo.',
    level: 70,
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
