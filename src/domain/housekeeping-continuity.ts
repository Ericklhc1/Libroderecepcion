/** Context returned by the existing maintenance record, never a commercial room state. */
export type MaintenanceContext = { status:string; resolution?:string|null; deletedAt?:Date|null };
export function maintenanceAllowsContinuation(entry:MaintenanceContext|null):boolean {
  return !entry || (!entry.deletedAt && ['RESUELTO','CERRADO'].includes(entry.status) && !!entry.resolution?.trim());
}
export function hkNextAction(work:{status:string;assignedToId:string|null;acknowledgedAt:Date|null;maintenanceEntry:MaintenanceContext|null}):string {
  if (work.status==='CANCELADO') return 'Consultar el motivo de cancelación y decidir si corresponde reabrir.';
  if (work.status==='RESUELTO') return work.maintenanceEntry&&!maintenanceAllowsContinuation(work.maintenanceEntry)
    ? 'El trabajo conserva su resultado. Supervisión debe revisar la incidencia de Mantenimiento que volvió a requerir atención.'
    : 'Resultado disponible para Recepción y las personas autorizadas.';
  if (!work.assignedToId) return 'Asignar una persona habilitada del área.';
  if (work.maintenanceEntry&&!maintenanceAllowsContinuation(work.maintenanceEntry)) return work.maintenanceEntry.deletedAt
    ? 'La incidencia fue archivada. Coordinación debe revisarla antes de continuar.'
    : 'Mantenimiento debe informar el resultado antes de continuar este trabajo.';
  if (work.status==='BLOQUEADO') return work.maintenanceEntry
    ? 'Revisar el resultado de Mantenimiento y retomar con una observación.'
    : 'Resolver el impedimento y registrar cómo se continuará.';
  if (work.status==='POR_REVISAR') return 'Otra persona habilitada debe revisar el trabajo y aprobar o pedir una corrección.';
  if (!work.acknowledgedAt) return 'Confirmar recepción y comenzar el trabajo asignado.';
  return work.status==='EN_GESTION' ? 'Finalizar indicando lo realizado o informar un impedimento.' : 'Comenzar el trabajo asignado.';
}
export const HK_MAINTENANCE_EVENT_LABELS:Record<string,string> = {
  MANTENIMIENTO_RESULTADO:'Resultado de Mantenimiento',
  MANTENIMIENTO_REABIERTO:'Mantenimiento vuelve a requerir atención',
  MANTENIMIENTO_AVANCE:'Avance de Mantenimiento',
};
