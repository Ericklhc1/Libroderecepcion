const FINISHED = new Set(['COMPLETADA','VALIDADA','RESUELTO','CERRADO','CUMPLIDO','CANCELADO','CANCELADA']);
const CANCELLED = new Set(['CANCELADO','CANCELADA']);
export function shiftChangeResultLabel(status: string) {
  if (CANCELLED.has(status)) return 'Registro conservado tras cancelación';
  if (FINISHED.has(status)) return 'Resultado registrado';
  if (['REALIZADA','POR_REVISAR'].includes(status)) return 'Resultado por revisar';
  return 'Último intento histórico';
}
export function summarizeShiftChange(input: {createdAt: Date; updatedAt: Date; assignedAt?: Date | null; completedAt?: Date | null; status: string}, since: Date) {
  const labels: string[] = [];
  if (input.createdAt > since && !FINISHED.has(input.status)) labels.push('Nuevo pendiente');
  if (input.assignedAt && input.assignedAt > since) labels.push('Responsable actualizado');
  if (input.completedAt && input.completedAt > since && !CANCELLED.has(input.status)) labels.push(shiftChangeResultLabel(input.status));
  if (!labels.length) labels.push(FINISHED.has(input.status) ? 'Estado final actualizado' : 'Seguimiento actualizado');
  return labels;
}
