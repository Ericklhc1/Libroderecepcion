import type { PermissionKey } from '@/lib/permissions';

export type NavItem = {
  href: string;
  label: string;
  icon:
    | 'home'
    | 'book'
    | 'shift'
    | 'task'
    | 'incident'
    | 'alert'
    | 'followup'
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

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Inicio', icon: 'home', mobile: true },
  { href: '/libro', label: 'Libro operativo', icon: 'book', mobile: true },
  {
    href: '/turno',
    label: 'Turno',
    icon: 'shift',
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
    mobile: true,
  },
  {
    href: '/habitaciones',
    label: 'Habitaciones',
    icon: 'room',
    anyOf: ['room.view'],
    mobile: true,
  },
  { href: '/llaves', label: 'Llaves', icon: 'key', anyOf: ['room.view'] },
  { href: '/tareas', label: 'Tareas', icon: 'task' },
  { href: '/incidencias', label: 'Incidencias', icon: 'incident' },
  { href: '/alertas', label: 'Alertas', icon: 'alert', mobile: true },
  { href: '/seguimientos', label: 'Seguimientos', icon: 'followup' },
  { href: '/huespedes', label: 'Huéspedes y reservas', icon: 'guest', anyOf: ['guest.manage'] },
  { href: '/historial', label: 'Historial', icon: 'history' },
  { href: '/indicadores', label: 'Indicadores', icon: 'metrics', anyOf: ['metrics.view'] },
  {
    href: '/admin',
    label: 'Administración',
    icon: 'admin',
    anyOf: ['user.manage', 'role.manage', 'system.configure', 'audit.view'],
  },
];

export function visibleNavItems(permissions: PermissionKey[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.anyOf || item.anyOf.some((permission) => permissions.includes(permission)),
  );
}
