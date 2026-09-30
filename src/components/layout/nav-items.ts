import {
  TECHNICAL_ADMIN_PERMISSIONS,
  type PermissionKey,
} from '@/lib/permissions';

export type NavSubItem = {
  href: string;
  label: string;
  description?: string;
  anyOf?: PermissionKey[];
};

export type NavMenuSection = {
  title: string;
  items: NavSubItem[];
};

export type NavItem = {
  href: string;
  label: string;
  /** Etiqueta corta explícita para la barra móvil; nunca se deriva cortando palabras. */
  mobileLabel?: string;
  icon:
    | 'home'
    | 'book'
    | 'shift'
    | 'supervision'
    | 'guest'
    | 'history'
    | 'metrics'
    | 'room'
    | 'key'
    | 'cash'
    | 'alarm'
    | 'admin';
  anyOf?: PermissionKey[];
  mobile?: boolean;
  /** Navegación secundaria de escritorio. Nunca concede permisos. */
  menu?: NavMenuSection[];
};

export type NavGroup = { title: string | null; items: NavItem[] };

const PRIMARY: NavItem[] = [
  { href: '/', label: 'Inicio', icon: 'home', mobile: true },
  {
    href: '/libro?clase=entry',
    label: 'Novedades',
    icon: 'book',
    mobile: true,
    menu: [
      {
        title: 'Operación',
        items: [
          {
            href: '/libro?clase=entry',
            label: 'Novedades',
            description: 'Pendientes que continúan entre turnos.',
          },
          {
            href: '/libro?clase=entry&tipo=INCIDENCIA',
            label: 'Incidencias',
            description: 'Casos que requieren gestión y resolución.',
          },
          {
            href: '/libro/habitaciones',
            label: 'Habitaciones',
            description: 'Monitor de contexto operativo de las 89 habitaciones.',
          },
          {
            href: '/libro?clase=task',
            label: 'Mis tareas',
            description: 'Trabajo operativo asignado a tu cuenta.',
          },
        ],
      },
      {
        title: 'Continuidad',
        items: [
          { href: '/tareas', label: 'Tareas', description: 'Vista especializada de tareas.' },
          {
            href: '/seguimientos',
            label: 'Seguimientos',
            description: 'Continuidad personal y de Supervisión.',
          },
          {
            href: '/alertas',
            label: 'Alertas',
            description: 'Llamadas de atención programables vinculadas a la operación.',
          },
        ],
      },
      {
        title: 'Consulta',
        items: [
          {
            href: '/historial',
            label: 'Historial',
            description: 'Registros resueltos y consulta histórica.',
          },
          {
            href: '/notificaciones',
            label: 'Notificaciones',
            description: 'Avisos que recibió tu cuenta.',
          },
        ],
      },
    ],
  },
  {
    href: '/caja',
    label: 'Caja',
    icon: 'cash',
    anyOf: ['cash.view'],
    mobile: true,
    menu: [
      {
        title: 'Caja',
        items: [
          { href: '/caja', label: 'Vista completa', description: 'Estado de la Caja y fondos.' },
          {
            href: '/caja?seccion=garantias',
            label: 'Garantías',
            description: 'Custodia, devolución y cobro.',
          },
          {
            href: '/caja?seccion=movimientos',
            label: 'Movimientos',
            description: 'Ingresos, egresos y transferencias.',
          },
          {
            href: '/caja?seccion=auditorias',
            label: 'Arqueos',
            description: 'Conteos e historial imprimible.',
          },
        ],
      },
      {
        title: 'Servicios',
        items: [
          {
            href: '/caja?seccion=gimnasio',
            label: 'Gimnasio',
            description: 'Folios emitidos y anulados.',
          },
          {
            href: '/caja?seccion=estacionamiento',
            label: 'Estacionamiento',
            description: 'Tickets e historial.',
          },
        ],
      },
    ],
  },
  {
    href: '/turno',
    label: 'Mi turno',
    mobileLabel: 'Turno',
    icon: 'shift',
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
    mobile: true,
    menu: [
      {
        title: 'Turno',
        items: [
          {
            href: '/turno',
            label: 'Estado y continuidad',
            description: 'Recepción, operación, entrega y cierre.',
          },
          {
            href: '/turno#abrir-turno',
            label: 'Abrir / recibir',
            description: 'Punto de entrada cuando corresponde relevo.',
            anyOf: ['shift.start', 'shift.receive'],
          },
        ],
      },
      {
        title: 'Consulta',
        items: [
          {
            href: '/admin/turnos',
            label: 'Historial de turnos',
            description: 'Trazabilidad y regularización autorizada.',
            anyOf: ['shift.manage'],
          },
        ],
      },
    ],
  },
  {
    href: '/llaves',
    label: 'Llaves',
    icon: 'key',
    anyOf: ['key.assign', 'key.inventory', 'key.stock'],
    mobile: true,
    menu: [
      {
        title: 'Inventario físico',
        items: [
          { href: '/llaves?piso=todos', label: 'Todos los pisos', description: 'Consulta de las 89 habitaciones.' },
          { href: '/llaves?piso=4', label: 'Piso 4', description: 'Habitaciones 401–429.' },
          { href: '/llaves?piso=5', label: 'Piso 5', description: 'Habitaciones 501–530.' },
          { href: '/llaves?piso=6', label: 'Piso 6', description: 'Habitaciones 601–630.' },
        ],
      },
    ],
  },
  {
    href: '/alertas',
    label: 'Alertas',
    mobileLabel: 'Alertas',
    icon: 'alarm',
    menu: [
      {
        title: 'Atención',
        items: [
          {
            href: '/alertas',
            label: 'Alertas programadas',
            description: 'Timers y alertas personales, grupales o globales.',
          },
          {
            href: '/notificaciones',
            label: 'Notificaciones',
            description: 'Avisos que abren el objeto original.',
          },
        ],
      },
    ],
  },
  {
    href: '/supervision',
    label: 'Centro de Supervisión',
    icon: 'supervision',
    anyOf: ['supervision.center.view'],
    menu: [
      {
        title: 'Dirección operativa',
        items: [
          {
            href: '/supervision',
            label: 'Centro de Supervisión',
            description: 'Pendientes, controles y continuidad.',
          },
          {
            href: '/supervision/tablero',
            label: 'Tablero de asignación',
            description: 'Distribución y seguimiento del trabajo.',
          },
        ],
      },
      {
        title: 'Control',
        items: [
          {
            href: '/supervision/auditorias',
            label: 'Auditorías',
            description: 'Auditorías sorpresa y medidas correctivas.',
          },
          {
            href: '/supervision/informes',
            label: 'Informes',
            description: 'Estado, gimnasio y multas.',
          },
          {
            href: '/supervision/salud',
            label: 'Salud operativa',
            description: 'Señales técnicas y de flujo observadas.',
          },
        ],
      },
      {
        title: 'Gestión',
        items: [
          {
            href: '/supervision/rendimiento',
            label: 'Rendimiento',
            description: 'Indicadores del equipo sin rankings.',
            anyOf: ['supervision.performance.view'],
          },
        ],
      },
    ],
  },
];

const MANAGEMENT: NavItem[] = [
  {
    href: '/gerencia',
    label: 'Gerencia',
    icon: 'metrics',
    anyOf: ['management.dashboard.view'],
  },
];

const SECONDARY: NavItem[] = [
  {
    href: '/admin/auditoria',
    label: 'Auditoría',
    icon: 'history',
    anyOf: ['audit.view'],
  },
];

const SYSTEM: NavItem[] = [
  {
    href: '/admin',
    label: 'Administración',
    icon: 'admin',
    anyOf: [...TECHNICAL_ADMIN_PERMISSIONS, 'support.view'],
    menu: [
      {
        title: 'Administración',
        items: [
          {
            href: '/admin',
            label: 'Inicio de Administración',
            description: 'Accesos técnicos disponibles para tu rol.',
          },
          {
            href: '/admin/usuarios',
            label: 'Usuarios',
            description: 'Cuentas y perfiles.',
            anyOf: ['user.manage'],
          },
          {
            href: '/admin/roles',
            label: 'Roles y permisos',
            description: 'Matriz de autorizaciones.',
            anyOf: ['role.manage'],
          },
          {
            href: '/admin/soporte',
            label: 'Reportes y solicitudes',
            description: 'Bandeja de problemas y funciones solicitadas.',
            anyOf: ['support.view'],
          },
        ],
      },
      {
        title: 'Configuración',
        items: [
          {
            href: '/admin/parametros',
            label: 'Parámetros',
            description: 'Configuración general y operativa.',
            anyOf: ['system.configure'],
          },
          {
            href: '/admin/correo',
            label: 'Correo',
            description: 'Servidor de salida y destinatarios.',
            anyOf: ['system.configure'],
          },
          {
            href: '/admin/fronti',
            label: 'Fronti',
            description: 'Configuración vigente del asistente.',
            anyOf: ['system.configure'],
          },
        ],
      },
    ],
  },
];

export const NAV_GROUPS: NavGroup[] = [
  { title: null, items: PRIMARY },
  { title: 'Dirección', items: MANAGEMENT },
  { title: 'Consulta', items: SECONDARY },
  { title: 'Sistema', items: SYSTEM },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

function allowed(item: { anyOf?: PermissionKey[] }, permissions: PermissionKey[]): boolean {
  return !item.anyOf || item.anyOf.some((permission) => permissions.includes(permission));
}

function visibleMenu(
  menu: NavMenuSection[] | undefined,
  permissions: PermissionKey[],
): NavMenuSection[] | undefined {
  if (!menu) return undefined;

  const sections = menu
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => allowed(item, permissions)),
    }))
    .filter((section) => section.items.length > 0);

  return sections.length > 0 ? sections : undefined;
}

export function visibleNavItems(permissions: PermissionKey[]): NavItem[] {
  return NAV_ITEMS.filter((item) => allowed(item, permissions)).map((item) => ({
    ...item,
    menu: visibleMenu(item.menu, permissions),
  }));
}

export function visibleNavGroups(permissions: PermissionKey[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) => allowed(item, permissions))
      .map((item) => ({
        ...item,
        menu: visibleMenu(item.menu, permissions),
      })),
  })).filter((group) => group.items.length > 0);
}
