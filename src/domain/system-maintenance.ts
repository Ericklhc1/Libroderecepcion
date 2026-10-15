/** Temporary availability control, independent of account/role permissions. */
export const MAINTENANCE_SETTING_KEY = 'system.maintenance' as const;
export const MAINTENANCE_MESSAGE = 'Trabajos de mantenimiento programados por actualizaciones importantes.';
export const SYSTEM_CLOSURE_MESSAGE = 'Gracias por el trabajo compartido. Para finalizar, cierra y envía tu turno.';
export const SYSTEM_CLOSED_MESSAGE = 'El sistema está fuera de servicio. La información se conserva y la administración permanece disponible.';
export const SYSTEM_CLOSURE_CONFIRMATION = 'DEJAR ACCESO SOLO A SYSADMIN' as const;
export const REQUIRED_CLOSURE_HUMAN_IDS = [1725, 1715, 1700, 1693, 1680, 1673] as const;

export type SystemClosureBackup = {
  filename: string;
  digest: string;
  fingerprint: string;
  verificationNonce: string;
  createdAt: string;
  createdById: string;
  verifiedAt: string | null;
  verifiedById: string | null;
};

export type SystemClosureState = {
  phase: 'CLOSING' | 'LOCKED';
  startedAt: string;
  startedById: string;
  pendingShiftIds: string[];
  backup: SystemClosureBackup | null;
  lockedAt: string | null;
  lockedById: string | null;
};

export const MAINTENANCE_DEFAULT = { enabled: false, message: MAINTENANCE_MESSAGE, startedAt: null, closure: null } as const;

export type MaintenanceState = {
  enabled: boolean;
  message: string;
  startedAt: string | null;
  closure: SystemClosureState | null;
  revision: string;
  valid: boolean;
};
