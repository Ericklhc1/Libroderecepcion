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
 * qué ocurre ahora, qué queda pendiente, qué pasa en cada habitación, qué se
 * entrega al siguiente turno y qué debe revisar el Supervisor.
 *
 * Tareas, incidencias, seguimientos y alertas no son destinos del menú: son
 * clases de un mismo flujo y se consultan desde el Libro operativo, desde
 * Inicio, desde la ficha de la habitación y desde Supervisión. Sus páginas
 * siguen existiendo como vista secundaria (pestañas del libro), porque cada
 * una aporta acciones propias que no se pueden perder.
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
    href: '/turno',
    label: 'Turno',
    icon: 'shift',
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
    mobile: true,
  },
  {
    href: '/supervision',
    label: 'Supervisión',
    icon: 'supervision',
    anyOf: ['supervision.view', 'incident.manage', 'shift.manage'],
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
