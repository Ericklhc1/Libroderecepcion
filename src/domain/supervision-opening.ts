export const SUPERVISION_OPERATIONAL_PRIMARY_REPORT = 'ACTIVIDAD' as const;

export const SUPERVISION_OPERATIONAL_FALLBACK_REPORTS = [
  'ENTRADAS',
  'IN_HOUSE',
  'SALIDAS',
] as const;

export const REQUIRED_SUPERVISION_AUDIT_REPORTS = [
  'AUDITORIA_FORMULARIO',
  'COBROS',
  'CARGOS_DIARIOS',
] as const;

/**
 * Lista informativa completa del núcleo de apertura.
 *
 * No significa que los siete archivos sean simultáneamente obligatorios:
 * ACTIVIDAD reemplaza a ENTRADAS + IN_HOUSE + SALIDAS como fotografía
 * operacional del día.
 */
export const REQUIRED_SUPERVISION_OPENING_REPORTS = [
  ...REQUIRED_SUPERVISION_AUDIT_REPORTS,
  SUPERVISION_OPERATIONAL_PRIMARY_REPORT,
  ...SUPERVISION_OPERATIONAL_FALLBACK_REPORTS,
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

export type RequiredSupervisionOpeningReport =
  (typeof REQUIRED_SUPERVISION_OPENING_REPORTS)[number];
