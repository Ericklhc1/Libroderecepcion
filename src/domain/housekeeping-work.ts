import { ROLE_KEYS, type PermissionKey } from '@/lib/permissions';
import type { HousekeepingAccess } from './housekeeping';

export const HK_WORK_KINDS = ['LIMPIEZA', 'ZONA_COMUN', 'REPOSICION', 'REVISION', 'ATENCION'] as const;
export type HkWorkKind = (typeof HK_WORK_KINDS)[number];
export const HK_KIND_LABELS: Record<HkWorkKind, string> = { LIMPIEZA: 'Limpieza de habitación', ZONA_COMUN: 'Limpieza de zona común', REPOSICION: 'Reposición', REVISION: 'Revisión / trabajo crítico', ATENCION: 'Atención especial' };
export const HK_WORK_ACTIONS = ['RECIBIR', 'ASIGNAR', 'COMENZAR', 'IMPEDIMENTO', 'RETOMAR', 'TERMINAR', 'APROBAR', 'CORREGIR', 'CANCELAR', 'REABRIR', 'MANTENIMIENTO', 'RECONFIRMAR'] as const;
export type HkWorkAction = (typeof HK_WORK_ACTIONS)[number];
export const HK_WORK_LABELS: Record<string, string> = { PENDIENTE: 'Pendiente', RECIBIDO: 'Recibido', EN_GESTION: 'En proceso', BLOQUEADO: 'Con impedimento', POR_REVISAR: 'Por revisar', RESUELTO: 'Terminado', CANCELADO: 'Cancelado' };
export const HK_ACTION_LABELS: Record<HkWorkAction, string> = { RECIBIR: 'Confirmar recepción', ASIGNAR: 'Asignar / reasignar', COMENZAR: 'Comenzar', IMPEDIMENTO: 'Informar impedimento', RETOMAR: 'Retomar', TERMINAR: 'Marcar terminado', APROBAR: 'Aprobar revisión', CORREGIR: 'Devolver para corregir', CANCELAR: 'Cancelar', REABRIR: 'Reabrir', MANTENIMIENTO: 'Solicitar Mantenimiento', RECONFIRMAR: 'Aceptar instrucción actualizada' };
export const HK_ACTION_PERMISSION: Record<HkWorkAction, PermissionKey> = { RECIBIR: 'housekeeping.work', ASIGNAR: 'housekeeping.assign', COMENZAR: 'housekeeping.work', IMPEDIMENTO: 'housekeeping.work', RETOMAR: 'housekeeping.work', TERMINAR: 'housekeeping.work', APROBAR: 'housekeeping.inspect', CORREGIR: 'housekeeping.inspect', CANCELAR: 'housekeeping.assign', REABRIR: 'housekeeping.assign', MANTENIMIENTO: 'housekeeping.assign', RECONFIRMAR: 'housekeeping.assign' };
export function hkHas(user: HousekeepingAccess, permission: PermissionKey): boolean {
  return user.roleKey === ROLE_KEYS.SYSTEM_ADMIN || user.permissions.includes(permission) || (permission !== 'housekeeping.view.all' && permission !== 'housekeeping.plan' && user.permissions.includes('housekeeping.manage'));
}
export function hkInspectionRequired(kind: HkWorkKind, requested = false): boolean { return requested || kind === 'LIMPIEZA' || kind === 'REVISION'; }
export function hkAllowedActions(status: string, assigned: boolean, sourceChanged = false): HkWorkAction[] {
  if (status === 'RESUELTO' || status === 'CANCELADO') return ['REABRIR'];
  if (sourceChanged) return ['RECONFIRMAR', 'IMPEDIMENTO', 'CANCELAR'];
  if (status === 'POR_REVISAR') return ['APROBAR', 'CORREGIR', 'IMPEDIMENTO', 'CANCELAR'];
  if (status === 'BLOQUEADO') return ['ASIGNAR', ...(assigned ? ['RETOMAR' as const] : []), 'MANTENIMIENTO', 'CANCELAR'];
  if (status === 'EN_GESTION') return ['ASIGNAR', 'IMPEDIMENTO', 'RETOMAR', 'TERMINAR', 'CANCELAR'];
  return ['ASIGNAR', ...(assigned ? [...(status === 'PENDIENTE' ? ['RECIBIR' as const] : []), 'COMENZAR' as const, 'IMPEDIMENTO' as const] : []), 'CANCELAR'];
}
export function hkNextStatus(status: string, action: HkWorkAction, requiresInspection: boolean): string {
  if (!hkAllowedActions(status, true).includes(action) && action !== 'RECONFIRMAR') throw new Error('Esta acción no corresponde al estado del trabajo.');
  if (action === 'RECIBIR') return 'RECIBIDO';
  if (action === 'ASIGNAR') return status === 'BLOQUEADO' ? 'BLOQUEADO' : 'PENDIENTE';
  if (action === 'REABRIR' || action === 'CORREGIR') return 'PENDIENTE';
  if (action === 'COMENZAR' || action === 'RETOMAR') return 'EN_GESTION';
  if (action === 'IMPEDIMENTO') return 'BLOQUEADO';
  if (action === 'TERMINAR') return requiresInspection ? 'POR_REVISAR' : 'RESUELTO';
  if (action === 'APROBAR') return 'RESUELTO';
  if (action === 'CANCELAR') return 'CANCELADO';
  return status;
}
export const HK_NOTE_REQUIRED: HkWorkAction[] = ['ASIGNAR', 'IMPEDIMENTO', 'RETOMAR', 'TERMINAR', 'APROBAR', 'CORREGIR', 'CANCELAR', 'REABRIR', 'MANTENIMIENTO', 'RECONFIRMAR'];

/** Area-only accounts must not inherit Reception's generic book/home readers. */
export function isHkFocused(user: HousekeepingAccess): boolean {
  return user.roleKey !== ROLE_KEYS.SYSTEM_ADMIN && user.permissions.some(p=>p.startsWith('housekeeping.')) && !user.permissions.some(p=>['entry.create','entry.edit','entry.close','task.create','shift.start','shift.manage','supervision.view','management.dashboard.view','system.configure','cash.view','room.manage','incident.create','incident.manage'].includes(p));
}

/** Navigation, help and onboarding share the same area-only reading scope. */
export function hkNavigationAllowed(permissions: PermissionKey[], route?: string): boolean {
  if (!isHkFocused({ roleKey: '', permissions }) || !route) return true;
  const path = route.split('?')[0] ?? '';
  return !['/', '/libro', '/tareas', '/seguimientos', '/historial', '/novedades/habitacion', '/alertas'].some(blocked => path === blocked || (blocked !== '/' && path.startsWith(`${blocked}/`)));
}
