/** Temporary availability control, independent of account/role permissions. */
export const MAINTENANCE_SETTING_KEY = 'system.maintenance' as const;
export const MAINTENANCE_MESSAGE = 'Trabajos de mantenimiento programados por actualizaciones importantes.';
export const MAINTENANCE_DEFAULT = { enabled: false, message: MAINTENANCE_MESSAGE, startedAt: null } as const;

export type MaintenanceState = {
  enabled: boolean;
  message: string;
  startedAt: string | null;
  revision: string;
  valid: boolean;
};
