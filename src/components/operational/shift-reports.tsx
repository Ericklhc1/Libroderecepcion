import type { ShiftReportsState } from '@/server/services/pms-import';

/**
 * Compatibilidad temporal del módulo Turno.
 *
 * La carga de informes dejó de pertenecer al turno: ahora vive en
 * «Huéspedes & reservas», que es el núcleo de datos de la estadía. Se conserva
 * este componente vacío mientras retiramos la consulta antigua de la página de
 * turno en un cambio posterior, sin romper imports ni mezclar responsabilidades.
 */
export function ShiftReports(_props: {
  state: ShiftReportsState;
  canImport: boolean;
}) {
  return null;
}
