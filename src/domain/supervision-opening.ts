export const REQUIRED_SUPERVISION_OPENING_REPORTS = [
  'AUDITORIA_FORMULARIO',
  'ACTIVIDAD',
  'ENTRADAS',
  'IN_HOUSE',
  'SALIDAS',
  'COBROS',
  'CARGOS_DIARIOS',
] as const;

export const OPTIONAL_SUPERVISION_OPENING_REPORTS = [
  'VENTAS_CANAL',
  'PRODUCCION_HABITACION',
  'REVENUE',
] as const;

export const SUPERVISION_REPORT_LABELS: Record<string, string> = {
  AUDITORIA_FORMULARIO: 'Formulario de auditoría',
  ACTIVIDAD: 'Habitaciones con actividad',
  ENTRADAS: 'Entradas / Check-ins',
  IN_HOUSE: 'In House',
  SALIDAS: 'Salidas / Check-outs',
  COBROS: 'Cobros',
  CARGOS_DIARIOS: 'Cargos diarios',
  VENTAS_CANAL: 'Ventas por canal',
  PRODUCCION_HABITACION: 'Producción por habitación',
  REVENUE: 'Revenue',
  CIERRE_CAJA: 'Cierre de caja',
  DESCONOCIDO: 'Informe no reconocido',
};
