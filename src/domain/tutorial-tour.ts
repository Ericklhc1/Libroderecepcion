import type { PermissionKey } from '@/lib/permissions';

export type TutorialStep = {
  id: string;
  title: string;
  description: string;
  route?: string;
  target?: string;
  anyOf?: PermissionKey[];
};

const ROUTE_TARGET = '[data-tour="route-title"], main h1';

/**
 * Decide si el recorrido debe mover al usuario a la ruta del paso actual.
 *
 * `usePathname()` no incluye query string, por lo que primero comparamos sólo
 * el pathname de la ruta del tutorial. Cuando el usuario elige «Ahora no», el
 * recorrido queda completamente pasivo: no navega ni secuestra la pantalla.
 */
export function shouldNavigateTutorial(
  dismissed: boolean,
  pathname: string,
  route?: string,
  suspended = false,
): boolean {
  if (dismissed || suspended || !route) return false;

  const routePath = route.split(/[?#]/, 1)[0] || '/';
  if (routePath === '/') return pathname !== '/';

  return pathname !== routePath && !pathname.startsWith(`${routePath}/`);
}

/**
 * Recorrido de producto v1.5.0.
 *
 * El Libro gira alrededor de Turnos + Novedades + Caja + Llaves + Supervisión.
 * PMS, estadías y reservas quedan como contexto legado opcional.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'inicio',
    title: 'Inicio: tu radar del turno',
    description:
      'Aquí ves lo urgente y lo que necesita atención ahora. No tienes que recorrer todo el sistema para saber por dónde empezar.',
    route: '/',
    target: ROUTE_TARGET,
  },
  {
    id: 'acciones-rapidas',
    title: 'Acciones rápidas',
    description:
      'Registra una novedad o incidencia sin abandonar lo que estabas revisando.',
    target: '[data-tour="quick-actions"]',
  },
  {
    id: 'busqueda',
    title: 'Búsqueda global',
    description:
      'Busca novedades, tareas, responsables y referencias operativas del Libro.',
    target: '[data-tour="global-search"]',
  },
  {
    id: 'libro',
    title: 'Novedades',
    description:
      'Es el núcleo operativo: registra qué pasó, qué queda pendiente, quién responde y cómo se resolvió. Cualquier habitación o referencia se escribe como contexto libre cuando aporta valor.',
    route: '/libro?clase=entry',
    target: ROUTE_TARGET,
  },
  {
    id: 'caja',
    title: 'Caja',
    description:
      'Aquí vive la custodia financiera: fondo fijo, garantías, ingresos, egresos, transferencias, arqueos y diferencias. No depende del PMS.',
    route: '/caja',
    target: ROUTE_TARGET,
    anyOf: ['cash.view'],
  },
  {
    id: 'turno',
    title: 'Mi turno',
    description:
      'Mi turno organiza inicio, continuidad, entrega y cierre. La entrega resume Novedades, tareas, seguimientos y alertas; Caja conserva su propio control de custodia.',
    route: '/turno',
    target: ROUTE_TARGET,
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
  },
  {
    id: 'llaves',
    title: 'Llaves',
    description:
      'Inventario físico por pisos 4, 5 y 6. Entregas, devoluciones, extravíos y conteos funcionan sin PMS, reserva ni estadía.',
    route: '/llaves',
    target: ROUTE_TARGET,
    anyOf: ['key.assign', 'key.inventory', 'key.stock'],
  },
  {
    id: 'supervision',
    title: 'Centro de Supervisión',
    description:
      'Concentra excepciones de Novedades, Caja y Turnos, además de tareas, seguimientos, auditorías y controles del Supervisor.',
    route: '/supervision',
    target: ROUTE_TARGET,
    anyOf: ['supervision.center.view'],
  },
  {
    id: 'auditoria',
    title: 'Auditoría',
    description:
      'Consulta el rastro de cambios con fecha, responsable y motivo. Es una vista de control y no modifica el historial.',
    route: '/admin/auditoria',
    target: ROUTE_TARGET,
    anyOf: ['audit.view'],
  },
  {
    id: 'administracion',
    title: 'Administración',
    description:
      'Usuarios, roles, parámetros y configuración técnica viven aquí. Sólo aparece con permisos administrativos.',
    route: '/admin',
    target: ROUTE_TARGET,
    anyOf: ['user.manage', 'role.manage', 'system.configure'],
  },
  {
    id: 'ayuda',
    title: 'Ayuda y recorridos',
    description:
      'Si olvidas un procedimiento, abre la ayuda. Puedes volver a iniciar este recorrido cuando quieras.',
    target: '[data-tour="help-center"]',
  },
];

export function guidedTourSteps(permissions: PermissionKey[]): TutorialStep[] {
  return TUTORIAL_STEPS.filter(
    (step) => !step.anyOf || step.anyOf.some((permission) => permissions.includes(permission)),
  );
}
