export type NotificationFeedItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFeedSnapshot = {
  unread: number;
  items: NotificationFeedItem[];
  /**
   * Comunicados obligatorios que esta persona aún no confirmó.
   * Sólo viajan los IDs: si cambian, el layout se refresca y el gate obtiene
   * el contenido completo desde servidor.
   */
  blockingAnnouncementIds: string[];
  generatedAt: string;
};

export const NOTIFICATION_WIDGET_LABELS: Record<string, string> = {
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

export const URGENT_NOTIFICATION_TYPES = new Set([
  'INCIDENCIA_CRITICA',
  'TAREA_VENCIDA',
  'ACCION_REQUERIDA',
]);
