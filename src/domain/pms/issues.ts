/**
 * Clasifica los problemas detectados al leer una fila del PMS.
 *
 * Las advertencias financieras NO deben borrar de la operación una estadía
 * cuya identidad ya es inequívoca. Si no se pudo leer un importe, la estancia
 * igualmente puede existir y el monto queda pendiente de revisión.
 *
 * Los demás problemas siguen siendo bloqueantes: habitación ausente, estado
 * desconocido, fecha ilegible, etc.
 */
const NON_BLOCKING_PREFIXES = [
  'No se pudo interpretar el importe total',
  'No se pudo interpretar el importe pendiente',
];

export function isBlockingPmsIssue(issue: string): boolean {
  return !NON_BLOCKING_PREFIXES.some((prefix) => issue.startsWith(prefix));
}

export function hasBlockingPmsIssues(issues: string[]): boolean {
  return issues.some(isBlockingPmsIssue);
}
