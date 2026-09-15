/** Etiquetas de los movimientos de llave, para el historial. */
export const KEY_ACTION_LABELS = {
  CREADA: 'Agregada al inventario',
  ASIGNADA: 'Entregada al huésped',
  DEVUELTA: 'Devuelta',
  COPIA_ENTREGADA: 'Copia adicional entregada',
  COPIA_RECUPERADA: 'Copia recuperada',
  MARCADA_PENDIENTE_DEVOLUCION: 'Marcada pendiente de devolución',
  MARCADA_EXTRAVIADA: 'Marcada extraviada',
  MARCADA_FUERA_DE_SERVICIO: 'Marcada fuera de servicio',
  REINTEGRADA: 'Reintegrada al stock',
} as const satisfies Record<string, string>;
