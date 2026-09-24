import { EntryStatus, TaskStatus } from '@prisma/client';
import type {
  AlertLevel,
  AlertStatus,
  AlertType,
  AssignmentRole,
  AuditAction,
  EntryType,
  FollowUpStatus,
  GuaranteeStatus,
  HandoverLevel,
  HandoverStatus,
  Impact,
  NotificationType,
  Priority,
  ReservationStatus,
  Severity,
  TaskOrigin,
} from '@prisma/client';

/**
 * Semáforo visual del sistema. El tono nunca viaja solo: cada componente que
 * lo usa acompaña el color con texto y/o icono para no depender del color.
 */
export type Tone =
  | 'critico' // rojo: crítico o vencido
  | 'atencion' // naranja: requiere atención
  | 'pendiente' // amarillo: pendiente
  | 'curso' // azul: en curso
  | 'resuelto' // verde: resuelto
  | 'neutro'; // gris: cerrado o informativo

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  NOVEDAD: 'Novedad',
  INCIDENCIA: 'Incidencia',
  HUESPED: 'Información de huésped',
  RESERVA: 'Reserva',
  MANTENIMIENTO: 'Mantenimiento',
  CAJA: 'Caja',
  SEGURIDAD: 'Seguridad',
  HOUSEKEEPING: 'Housekeeping',
  AYB: 'A&B',
  SISTEMAS: 'Sistemas',
  OTRO: 'Otro',
};

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  ABIERTO: 'Abierto',
  EN_CURSO: 'En curso',
  EN_ESPERA: 'En espera',
  RESUELTO: 'Resuelto',
  CERRADO: 'Cerrado',
};

export const ENTRY_STATUS_TONE: Record<EntryStatus, Tone> = {
  ABIERTO: 'pendiente',
  EN_CURSO: 'curso',
  EN_ESPERA: 'atencion',
  RESUELTO: 'resuelto',
  CERRADO: 'neutro',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  BAJA: 'neutro',
  MEDIA: 'curso',
  ALTA: 'atencion',
  CRITICA: 'critico',
};

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  CRITICA: 4,
  ALTA: 3,
  MEDIA: 2,
  BAJA: 1,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  BAJA: 'neutro',
  MEDIA: 'pendiente',
  ALTA: 'atencion',
  CRITICA: 'critico',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  NINGUNO: 'Sin impacto',
  HUESPED: 'Huésped',
  OPERACION: 'Operación',
  ECONOMICO: 'Económico',
  REPUTACIONAL: 'Reputacional',
  SEGURIDAD: 'Seguridad',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDIENTE: 'Pendiente',
  ACEPTADA: 'Aceptada',
  EN_CURSO: 'En curso',
  BLOQUEADA: 'Bloqueada',
  REALIZADA: 'Realizada, pendiente de validar',
  DEVUELTA: 'Devuelta',
  VALIDADA: 'Validada',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
};

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  PENDIENTE: 'pendiente',
  ACEPTADA: 'curso',
  EN_CURSO: 'curso',
  BLOQUEADA: 'atencion',
  REALIZADA: 'pendiente',
  DEVUELTA: 'atencion',
  VALIDADA: 'resuelto',
  COMPLETADA: 'resuelto',
  CANCELADA: 'neutro',
};

export const TASK_OPEN_STATUSES: TaskStatus[] = [
  TaskStatus.PENDIENTE,
  TaskStatus.ACEPTADA,
  TaskStatus.EN_CURSO,
  TaskStatus.BLOQUEADA,
  TaskStatus.REALIZADA,
  TaskStatus.DEVUELTA,
];

export const ENTRY_OPEN_STATUSES: EntryStatus[] = [
  EntryStatus.ABIERTO,
  EntryStatus.EN_CURSO,
  EntryStatus.EN_ESPERA,
];

export const TASK_ORIGIN_LABEL: Record<TaskOrigin, string> = {
  MANUAL: 'Creación manual',
  REGISTRO: 'Registro operativo',
  INCIDENCIA: 'Incidencia',
  ENTREGA_TURNO: 'Entrega de turno',
  SEGUIMIENTO: 'Seguimiento',
  ALERTA: 'Alerta',
  RESERVA: 'Reserva',
};

export const FOLLOWUP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  PENDIENTE: 'Pendiente',
  CUMPLIDO: 'Cumplido',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
};

export const FOLLOWUP_STATUS_TONE: Record<FollowUpStatus, Tone> = {
  PENDIENTE: 'pendiente',
  CUMPLIDO: 'resuelto',
  VENCIDO: 'critico',
  CANCELADO: 'neutro',
};

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  GARANTIA_PENDIENTE: 'Garantía pendiente',
  GARANTIA_SIN_RESOLVER_EN_SALIDA: 'Garantía sin resolver en la salida',
  SALDO_PENDIENTE: 'Saldo pendiente de cobro',
  TARJETA_INVALIDA: 'Tarjeta inválida',
  PAGO_PENDIENTE: 'Pago pendiente',
  RESERVA_SIN_CONFIRMAR: 'Reserva sin confirmar',
  SOLICITUD_HUESPED_PENDIENTE: 'Solicitud de huésped pendiente',
  TAREA_VENCIDA: 'Tarea vencida',
  INCIDENCIA_CRITICA: 'Incidencia crítica',
  MANTENIMIENTO_SIN_RESOLVER: 'Mantenimiento sin resolver',
  SEGUIMIENTO_VENCIDO: 'Seguimiento vencido',
  ENTREGA_TURNO_PENDIENTE: 'Entrega de turno pendiente',
  HUESPED_VIP: 'Huésped VIP',
  SALIDA_ANTICIPADA: 'Salida anticipada',
  TRASLADO_PENDIENTE: 'Traslado pendiente',
  OTRO: 'Otra alerta',
};

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  INFORMATIVA: 'Informativa',
  ATENCION: 'Requiere atención',
  CRITICA: 'Crítica',
};

export const ALERT_LEVEL_TONE: Record<AlertLevel, Tone> = {
  INFORMATIVA: 'neutro',
  ATENCION: 'atencion',
  CRITICA: 'critico',
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  NUEVA: 'Nueva',
  VISTA: 'Vista',
  POSPUESTA: 'Pospuesta',
  RESUELTA: 'Resuelta',
};

export const ALERT_STATUS_TONE: Record<AlertStatus, Tone> = {
  NUEVA: 'critico',
  VISTA: 'atencion',
  POSPUESTA: 'pendiente',
  RESUELTA: 'resuelto',
};

export const HANDOVER_STATUS_LABEL: Record<HandoverStatus, string> = {
  BORRADOR: 'En preparación',
  ENVIADA: 'Enviada',
  RECIBIDA: 'Recibida',
  ANULADA: 'Anulada',
};

export const HANDOVER_STATUS_TONE: Record<HandoverStatus, Tone> = {
  BORRADOR: 'pendiente',
  ENVIADA: 'curso',
  RECIBIDA: 'resuelto',
  ANULADA: 'neutro',
};

export const HANDOVER_LEVEL_LABEL: Record<HandoverLevel, string> = {
  URGENTE: 'Urgente',
  IMPORTANTE: 'Importante',
  INFORMATIVO: 'Informativo',
};

export const HANDOVER_LEVEL_TONE: Record<HandoverLevel, Tone> = {
  URGENTE: 'critico',
  IMPORTANTE: 'atencion',
  INFORMATIVO: 'neutro',
};

export const ASSIGNMENT_ROLE_LABEL: Record<AssignmentRole, string> = {
  TITULAR: 'Titular',
  APOYO: 'Apoyo',
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  EN_CASA: 'En casa',
  SALIDA: 'Salida',
  NO_SHOW: 'No show',
  CANCELADA: 'Cancelada',
};

export const GUARANTEE_STATUS_LABEL: Record<GuaranteeStatus, string> = {
  NO_REQUIERE: 'No requiere',
  PENDIENTE: 'Pendiente',
  VALIDADA: 'Validada',
  RECHAZADA: 'Rechazada',
};

/** Tono del resumen de garantía de la reserva. Lo usan Huéspedes y la ficha
 *  de habitación, así que vive aquí y no duplicado en cada pantalla. */
export const GUARANTEE_STATUS_TONE: Record<GuaranteeStatus, Tone> = {
  NO_REQUIERE: 'neutro',
  PENDIENTE: 'atencion',
  VALIDADA: 'resuelto',
  RECHAZADA: 'critico',
};

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  CREAR: 'Creación',
  EDITAR: 'Edición',
  CAMBIO_ESTADO: 'Cambio de estado',
  CAMBIO_RESPONSABLE: 'Cambio de responsable',
  CAMBIO_PRIORIDAD: 'Cambio de prioridad',
  CERRAR: 'Cierre',
  REABRIR: 'Reapertura',
  ELIMINAR: 'Eliminación',
  RESTAURAR: 'Restauración',
  COMENTAR: 'Comentario',
  TURNO_INICIAR: 'Inicio de turno',
  TURNO_RECIBIR: 'Recepción de turno',
  TURNO_ENTREGAR: 'Entrega de turno',
  TURNO_CERRAR: 'Cierre de turno',
  LOGIN: 'Inicio de sesión',
  LOGIN_FALLIDO: 'Intento de sesión fallido',
  LOGOUT: 'Cierre de sesión',
  CONFIGURAR: 'Configuración',
  PERMISOS: 'Cambio de permisos',
};

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  TAREA_ASIGNADA: 'Tarea asignada',
  RESPONSABLE_CAMBIADO: 'Responsable cambiado',
  VENCIMIENTO_PROXIMO: 'Vencimiento próximo',
  TAREA_VENCIDA: 'Tarea vencida',
  INCIDENCIA_CRITICA: 'Incidencia crítica',
  ENTREGA_DISPONIBLE: 'Entrega disponible',
  COMENTARIO: 'Nuevo comentario',
  MENCION: 'Te mencionaron',
  ACCION_REQUERIDA: 'Acción requerida',
  ACTUALIZACION_OPERATIVA: 'Actualización operativa',
  FRONTI_HALLAZGO: 'Hallazgo de Fronti',
  CHAT_MENSAJE: 'Nuevo mensaje',
};

/** Vencido = tiene fecha límite pasada y sigue abierto. */
export function isOverdue(
  dueAt: Date | null | undefined,
  open: boolean,
  now: Date = new Date(),
): boolean {
  if (!dueAt || !open) return false;
  return dueAt.getTime() < now.getTime();
}
