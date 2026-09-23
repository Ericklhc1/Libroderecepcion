import {
  TECHNICAL_ADMIN_PERMISSIONS,
  type PermissionKey,
} from '@/lib/permissions';

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
  anyOf?: PermissionKey[];
  mobile?: boolean;
};

export type NavGroup = { title: string | null; items: NavItem[] };

const PRIMARY: NavItem[] = [
  { href: '/', label: 'Inicio', icon: 'home', mobile: true },
  {
    href: '/libro?clase=entry',
    label: 'Novedades',
    icon: 'book',
    mobile: true,
  },
  {
    href: '/caja',
    label: 'Caja',
    icon: 'key',
    anyOf: ['cash.view'],
    mobile: true,
  },
  {
    href: '/turno',
    label: 'Mi turno',
    icon: 'shift',
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
    mobile: true,
  },
  {
    href: '/llaves',
    label: 'Llaves',
    icon: 'key',
    anyOf: ['key.assign', 'key.inventory', 'key.stock'],
    mobile: true,
  },
  {
    href: '/supervision',
    label: 'Centro de Supervisión',
    icon: 'supervision',
    anyOf: ['supervision.center.view'],
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
    anyOf: [...TECHNICAL_ADMIN_PERMISSIONS],
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

export function visibleNavGroups(permissions: PermissionKey[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => allowed(item, permissions)),
  })).filter((group) => group.items.length > 0);
}
