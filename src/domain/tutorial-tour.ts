import type { PermissionKey } from '@/lib/permissions';

export type TutorialStep = {
  id: string;
  title: string;
  description: string;
  route?: string;
  /** Selector del elemento que se debe señalar cuando la pantalla esté lista. */
  target?: string;
  /** Se incluye si la persona tiene al menos uno de estos permisos. */
  anyOf?: PermissionKey[];
};

const ROUTE_TARGET = '[data-tour="route-title"], main h1';

/**
 * Recorrido de producto, no manual técnico.
 *
 * La persona ve módulos independientes, aunque por debajo compartan contexto.
 * El tutorial explica qué pregunta responde cada módulo y deja que el propio
 * sistema muestre las relaciones entre reserva, habitación, caja, llaves y
 * Libro sin exponer la arquitectura interna.
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
      'Esta barra te acompaña en cualquier pantalla. Úsala para registrar una novedad, incidencia o tarea sin abandonar lo que estabas revisando.',
    target: '[data-tour="quick-actions"]',
  },
  {
    id: 'busqueda',
    title: 'Búsqueda global',
    description:
      'Busca por habitación, número de reserva, huésped, registro, tarea o usuario. Es la puerta más corta cuando ya sabes qué estás buscando.',
    target: '[data-tour="global-search"]',
  },
  {
    id: 'libro',
    title: 'Libro operativo',
    description:
      'Es el embudo de novedades: incidencias, tareas, seguimientos y alertas aparecen en una misma línea de trabajo sin perder su propia trazabilidad.',
    route: '/libro',
    target: ROUTE_TARGET,
  },
  {
    id: 'habitaciones',
    title: 'Habitaciones',
    description:
      'Aquí ves la situación física de cada habitación. La ficha reúne la estadía vigente, llaves, salida o llegada pendiente y el contexto de su reserva.',
    route: '/habitaciones',
    target: ROUTE_TARGET,
    anyOf: ['room.view'],
  },
  {
    id: 'huespedes-reservas',
    title: 'Huéspedes & reservas',
    description:
      'Aquí vive la ficha de cada huésped y reserva. Fechas, habitación, garantías, saldos y actividad conectada se reflejan desde este contexto donde haga falta.',
    route: '/huespedes',
    target: ROUTE_TARGET,
    anyOf: ['guest.view', 'guest.manage'],
  },
  {
    id: 'carga-reservas',
    title: 'Cargar información de Huéspedes & reservas',
    description:
      'Aquí adjuntas y revisas los PDF de actividad. Nada se aplica sin revisión; al confirmar, reservas, habitaciones, llaves y demás vistas reciben el contexto que les corresponde.',
    route: '/huespedes/importar',
    target: ROUTE_TARGET,
    anyOf: ['pms.import'],
  },
  {
    id: 'caja',
    title: 'Caja',
    description:
      'Caja muestra el dinero real del turno: entradas, egresos, garantías en efectivo y arqueos. Los movimientos vinculados a una reserva aparecen también en su ficha.',
    route: '/caja',
    target: ROUTE_TARGET,
    anyOf: ['room.view'],
  },
  {
    id: 'turno',
    title: 'Turno',
    description:
      'Turno se concentra en abrir, recibir, entregar y cerrar. Al final reúne lo ocurrido para que el relevo y la impresión sean una fotografía clara de la jornada.',
    route: '/turno',
    target: ROUTE_TARGET,
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
  },
  {
    id: 'llaves',
    title: 'Llaves',
    description:
      'Aquí administras el inventario físico. Las llaves se relacionan con la estadía y toman huésped y reserva desde el contexto ya existente: no hay que volver a escribirlos.',
    route: '/llaves',
    target: ROUTE_TARGET,
    anyOf: ['room.view'],
  },
  {
    id: 'supervision',
    title: 'Supervisión',
    description:
      'La bandeja de Supervisión concentra excepciones, garantías, multas, alertas y elementos que requieren revisión o decisión de jefatura.',
    route: '/supervision',
    target: ROUTE_TARGET,
    anyOf: ['supervision.view', 'shift.manage'],
  },
  {
    id: 'historial',
    title: 'Historial',
    description:
      'Cuando necesitas saber qué pasó y cuándo, entra aquí. La operación se conserva para que las correcciones no borren el rastro anterior.',
    route: '/historial',
    target: ROUTE_TARGET,
  },
  {
    id: 'indicadores',
    title: 'Indicadores',
    description:
      'Esta vista resume la operación para seguimiento: sirve para leer tendencias sin sustituir el detalle que vive en cada módulo.',
    route: '/indicadores',
    target: ROUTE_TARGET,
    anyOf: ['metrics.view'],
  },
  {
    id: 'administracion',
    title: 'Administración',
    description:
      'Usuarios, roles, parámetros, auditoría y configuración técnica viven aquí. Sólo aparece cuando tu rol tiene una responsabilidad administrativa.',
    route: '/admin',
    target: ROUTE_TARGET,
    anyOf: ['user.manage', 'role.manage', 'system.configure', 'audit.view'],
  },
  {
    id: 'ayuda',
    title: 'Ayuda y recorridos',
    description:
      'Si olvidas un procedimiento, abre la ayuda. Y desde Mi perfil puedes volver a iniciar este recorrido cuando quieras.',
    target: '[data-tour="help-center"]',
  },
];

export function guidedTourSteps(permissions: PermissionKey[]): TutorialStep[] {
  return TUTORIAL_STEPS.filter(
    (step) => !step.anyOf || step.anyOf.some((permission) => permissions.includes(permission)),
  );
}
