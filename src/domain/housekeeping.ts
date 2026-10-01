import { ROLE_KEYS } from '@/lib/permissions';

export const HOUSEKEEPING_STATUSES = ['PENDIENTE', 'RECIBIDO', 'EN_GESTION', 'BLOQUEADO', 'RESUELTO', 'CANCELADO'] as const;
export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export const HOUSEKEEPING_ACTIONS = ['CONFIRMAR', 'INICIAR', 'ACLARAR', 'BLOQUEAR', 'RETOMAR', 'RESOLVER', 'CANCELAR', 'REABRIR'] as const;
export type HousekeepingAction = (typeof HOUSEKEEPING_ACTIONS)[number];

export const HOUSEKEEPING_LABELS: Record<HousekeepingStatus, string> = {
  PENDIENTE: 'Sin confirmar', RECIBIDO: 'Recibido', EN_GESTION: 'En gestión',
  BLOQUEADO: 'Bloqueado / requiere aclaración', RESUELTO: 'Resuelto', CANCELADO: 'Cancelado',
};

export const HOUSEKEEPING_ACTION_LABELS: Record<HousekeepingAction, string> = {
  CONFIRMAR: 'Confirmar recepción de prueba', INICIAR: 'Iniciar gestión',
  ACLARAR: 'Necesito aclaración', BLOQUEAR: 'Registrar impedimento', RETOMAR: 'Retomar gestión',
  RESOLVER: 'Registrar resultado', CANCELAR: 'Cancelar con motivo', REABRIR: 'Reabrir con motivo',
};

export function canAccessHousekeeping(roleKey: string): boolean {
  return roleKey === ROLE_KEYS.SYSTEM_ADMIN;
}

export function isHousekeepingClosed(status: HousekeepingStatus): boolean {
  return status === 'RESUELTO' || status === 'CANCELADO';
}

export function housekeepingActions(status: HousekeepingStatus, sourceChanged = false): HousekeepingAction[] {
  if (isHousekeepingClosed(status)) return ['REABRIR'];
  if (sourceChanged) return ['CONFIRMAR', 'ACLARAR', 'CANCELAR'];
  switch (status) {
    case 'PENDIENTE': return ['CONFIRMAR', 'ACLARAR', 'CANCELAR'];
    case 'RECIBIDO': return ['INICIAR', 'ACLARAR', 'BLOQUEAR', 'RESOLVER', 'CANCELAR'];
    case 'EN_GESTION': return ['ACLARAR', 'BLOQUEAR', 'RESOLVER', 'CANCELAR'];
    case 'BLOQUEADO': return ['CONFIRMAR', 'RETOMAR', 'CANCELAR'];
  }
  return [];
}

export function housekeepingTransition(status: HousekeepingStatus, action: HousekeepingAction, acknowledged: boolean): HousekeepingStatus {
  if (action === 'CONFIRMAR' && !isHousekeepingClosed(status)) return status === 'PENDIENTE' ? 'RECIBIDO' : status;
  if (!housekeepingActions(status).includes(action)) throw new Error('La acción no corresponde al estado actual.');
  switch (action) {
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
  return ['ACLARAR', 'BLOQUEAR', 'RESOLVER', 'CANCELAR', 'REABRIR'].includes(action);
}
