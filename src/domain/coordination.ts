import { hotelWallDateTime } from './time';
export const RECEIPT_MINUTES = 30;
export const COORDINATION_PAGE_SIZE = 25;
export const COORDINATION_MAX_PAGE = 100;
export type CoordinationKind = 'entry' | 'task' | 'housekeeping' | 'followup';
export function receiptDueAt(assignedAt: Date | null, startsAt: Date | null = null): Date | null {
  if (!assignedAt) return null;
  return new Date(Math.max(assignedAt.getTime(), startsAt?.getTime() ?? 0) + RECEIPT_MINUTES * 60000);
}
export function elapsedMinutes(from: Date | null, to: Date | null): number | null {
  return from && to && to >= from ? Math.round((to.getTime() - from.getTime()) / 60000) : null;
}
export function nextWorkAction(status: string, owner: string | null, received: Date | null, note?: string | null): string {
  if (['RESUELTO','CERRADO','VALIDADA','COMPLETADA','CANCELADA','CANCELADO'].includes(status)) return 'Consultar resultado';
  if (['POR_REVISAR','REALIZADA'].includes(status)) return 'Validar el resultado';
  if (!owner) return 'Asignar responsable';
  if (['BLOQUEADO','BLOQUEADA'].includes(status)) return note || 'Resolver el impedimento';
  if (!received) return note || 'Confirmar recepción';
  return note || (['ABIERTO','PENDIENTE','RECIBIDO','ACEPTADA'].includes(status) ? 'Comenzar la atención' : 'Registrar el resultado');
}

/** A day-only plan becomes available at the start of that hotel-local day. */
export function hkReceiptAvailableAt(workDate: string | null): Date | null {
  return workDate ? hotelWallDateTime(workDate, 0, 0) : null;
}
