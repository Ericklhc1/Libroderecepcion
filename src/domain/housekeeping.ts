import { ROLE_KEYS, type PermissionKey } from '@/lib/permissions';

export const HOUSEKEEPING_ACCESS_PERMISSIONS: PermissionKey[] = ['housekeeping.view', 'housekeeping.manage', 'housekeeping.request', 'housekeeping.work', 'housekeeping.assign', 'housekeeping.inspect', 'housekeeping.plan', 'housekeeping.view.all'];

export const HOUSEKEEPING_STATUSES = ['PENDIENTE', 'RECIBIDO', 'EN_GESTION', 'BLOQUEADO', 'RESUELTO', 'CANCELADO'] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export const HOUSEKEEPING_ACTIONS = ['TOMAR', 'DERIVAR', 'CONFIRMAR', 'INICIAR', 'ACLARAR', 'BLOQUEAR', 'RETOMAR', 'RESOLVER', 'CANCELAR', 'REABRIR'] as const;
export type HousekeepingAction = (typeof HOUSEKEEPING_ACTIONS)[number];

export const HOUSEKEEPING_LABELS: Record<HousekeepingStatus, string> = {
  PENDIENTE: 'Sin confirmar', RECIBIDO: 'Recibido', EN_GESTION: 'En gestión',
  BLOQUEADO: 'Bloqueado / requiere aclaración', RESUELTO: 'Resuelto', CANCELADO: 'Cancelado',
};

export const HOUSEKEEPING_ACTION_LABELS: Record<HousekeepingAction, string> = {
  TOMAR: 'Tomar y comenzar', DERIVAR: 'Derivar / relevar',
  CONFIRMAR: 'Confirmar recepción', INICIAR: 'Iniciar gestión',
  ACLARAR: 'Necesito aclaración', BLOQUEAR: 'Registrar impedimento', RETOMAR: 'Retomar gestión',
  RESOLVER: 'Registrar resultado', CANCELAR: 'Cancelar con motivo', REABRIR: 'Reabrir con motivo',
};

export type HousekeepingAccess = { roleKey: string; permissions: readonly PermissionKey[] };

export function canManageHousekeeping(user: HousekeepingAccess): boolean {
  return user.roleKey === ROLE_KEYS.SYSTEM_ADMIN || user.permissions.includes('housekeeping.manage');
}

export function canAccessHousekeeping(user: HousekeepingAccess): boolean {
  return canManageHousekeeping(user) || HOUSEKEEPING_ACCESS_PERMISSIONS.some(p => user.permissions.includes(p));
}

export function isHousekeepingClosed(status: HousekeepingStatus): boolean {
  return status === 'RESUELTO' || status === 'CANCELADO';
}

export function housekeepingActions(status: HousekeepingStatus, sourceChanged = false): HousekeepingAction[] {
  if (isHousekeepingClosed(status)) return ['REABRIR'];
  if (sourceChanged) return ['CONFIRMAR', 'ACLARAR', 'CANCELAR'];
  switch (status) {
    case 'PENDIENTE': return ['TOMAR', 'DERIVAR', 'CONFIRMAR', 'ACLARAR', 'CANCELAR'];
    case 'RECIBIDO': return ['DERIVAR', 'INICIAR', 'ACLARAR', 'BLOQUEAR', 'RESOLVER', 'CANCELAR'];
    case 'EN_GESTION': return ['DERIVAR', 'ACLARAR', 'BLOQUEAR', 'RESOLVER', 'CANCELAR'];
    case 'BLOQUEADO': return ['DERIVAR', 'CONFIRMAR', 'RETOMAR', 'CANCELAR'];
  }
  return [];
}

export function housekeepingTransition(status: HousekeepingStatus, action: HousekeepingAction, acknowledged: boolean): HousekeepingStatus {
  if (action === 'CONFIRMAR' && !isHousekeepingClosed(status)) return status === 'PENDIENTE' ? 'RECIBIDO' : status;
  if (!housekeepingActions(status).includes(action)) throw new Error('La acción no corresponde al estado actual.');
  switch (action) {
    case 'TOMAR': return 'EN_GESTION';
    case 'DERIVAR': return 'PENDIENTE';
    case 'INICIAR': case 'RETOMAR':
      if (!acknowledged) throw new Error('Confirma primero la recepción del aviso.');
      return 'EN_GESTION';
    case 'ACLARAR': case 'BLOQUEAR': return 'BLOQUEADO';
    case 'RESOLVER':
      if (!acknowledged) throw new Error('Confirma primero la recepción del aviso.');
      return 'RESUELTO';
    case 'CANCELAR': return 'CANCELADO';
    case 'REABRIR': return 'PENDIENTE';
  }
  throw new Error('La acción no corresponde al estado actual.');
}

export function housekeepingNeedsNote(action: HousekeepingAction): boolean {
  return ['DERIVAR', 'ACLARAR', 'BLOQUEAR', 'RESOLVER', 'CANCELAR', 'REABRIR'].includes(action);
}
