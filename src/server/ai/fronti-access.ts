import 'server-only';

export type FrontiAccessSubject = {
  isSystemAdmin: boolean;
  frontiAccessEnabled: boolean;
};

/**
 * Fronti se despliega de forma gradual por usuario.
 *
 * - Administrador de sistema: siempre habilitado.
 * - Resto: requiere flag personal + disponibilidad global.
 */
export function canUseFronti(
  user: FrontiAccessSubject,
  globallyEnabled: boolean,
): boolean {
  if (user.isSystemAdmin) return true;
  return globallyEnabled && user.frontiAccessEnabled;
}
