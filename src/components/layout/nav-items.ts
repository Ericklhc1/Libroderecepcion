import type { PermissionKey } from '@/lib/permissions';

export type NavItem = {
  href: string;
  label: string;
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
    | 'admin';
  /** Se muestra si el usuario tiene al menos uno de estos permisos. */
  anyOf?: PermissionKey[];
  /** Aparece en la barra inferior móvil. */
  mobile?: boolean;
};

export type NavGroup = {
  /** `null` en el grupo principal: no necesita encabezado. */
  title: string | null;
  items: NavItem[];
};

/**
 * La navegación responde a cinco preguntas operativas, en este orden:
 * qué ocurre ahora, qué queda pendiente, qué pasa en cada habitación, qué hay
 * físicamente en caja, qué se entrega al siguiente turno y qué debe revisar el
 * Supervisor.
 */
const PRIMARY: NavItem[] = [
  { href: '/', label: 'Inicio', icon: 'home', mobile: true },
  { href: '/libro', label: 'Libro operativo', icon: 'book', mobile: true },
  {
    href: '/habitaciones',
    label: 'Habitaciones',
    icon: 'room',
    anyOf: ['room.view'],
    mobile: true,
  },
  {
    href: '/caja',
    label: 'Caja',
    icon: 'key',
    anyOf: ['room.view'],
    mobile: true,
  },
  {
    href: '/turno',
    label: 'Turno',
    icon: 'shift',
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
    mobile: true,
  },
  /*
    Supervisión la ve quien SUPERVISA, no quien opera.

    `incident.manage` estaba en esta lista y era el error: ese permiso lo
    tiene el mesón —de noche hay que poder mover una incidencia— así que la
    pestaña le aparecía a perfiles de recepción. Gestionar una incidencia y
    supervisar el turno de otro no son lo mismo.
  */
  {
    href: '/supervision',
    label: 'Supervisión',
    icon: 'supervision',
    anyOf: ['supervision.view', 'shift.manage'],
    mobile: true,
  },
];

/** Consultas de apoyo: se usan a diario, pero no son el flujo principal. */
const SECONDARY: NavItem[] = [
  { href: '/llaves', label: 'Llaves', icon: 'key', anyOf: ['room.view'] },
  {
    href: '/huespedes',
    label: 'Huéspedes y reservas',
    icon: 'guest',
    anyOf: ['guest.view', 'guest.manage'],
  },
  { href: '/historial', label: 'Historial', icon: 'history' },
  { href: '/indicadores', label: 'Indicadores', icon: 'metrics', anyOf: ['metrics.view'] },
];

const SYSTEM: NavItem[] = [
  {
    href: '/admin',
    label: 'Administración',
    icon: 'admin',
    anyOf: ['user.manage', 'role.manage', 'system.configure', 'audit.view'],
  },
];

export const NAV_GROUPS: NavGroup[] = [
  { title: null, items: PRIMARY },
  { title: 'Consulta', items: SECONDARY },
  { title: 'Sistema', items: SYSTEM },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

function allowed(item: NavItem, permissions: PermissionKey[]): boolean {
  return !item.anyOf || item.anyOf.some((permission) => permissions.includes(permission));
}

export function visibleNavItems(permissions: PermissionKey[]): NavItem[] {
  return NAV_ITEMS.filter((item) => allowed(item, permissions));
}

/** Los grupos que quedan vacíos tras aplicar permisos no se muestran. */
export function visibleNavGroups(permissions: PermissionKey[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => allowed(item, permissions)),
  })).filter((group) => group.items.length > 0);
}
