import type { PermissionKey } from '@/lib/permissions';
import { HOUSEKEEPING_ACCESS_PERMISSIONS } from '@/domain/housekeeping';
import { hkNavigationAllowed } from '@/domain/housekeeping-work';

export const TUTORIAL_MODULE_KEYS = [
  'novedades',
  'habitaciones',
  'caja',
  'turno',
  'llaves',
  'alertas',
  'housekeeping',
  'inventario',
  'equipo',
  'supervision',
  'gerencia',
  'auditoria',
  'administracion',
] as const;

export type TutorialModuleKey = (typeof TUTORIAL_MODULE_KEYS)[number];

export type TutorialModule = {
  key: TutorialModuleKey;
  label: string;
  route: string;
  anyOf?: PermissionKey[];
};

export type TutorialStep = {
  id: string;
  title: string;
  description: string;
  route?: string;
  target?: string;
  anyOf?: PermissionKey[];
  module?: TutorialModuleKey;
};

const ROUTE_TARGET = '[data-tour="route-title"], main h1';

export const TUTORIAL_MODULES: TutorialModule[] = [
  { key: 'novedades', label: 'Novedades', route: '/libro?clase=entry' },
  { key: 'habitaciones', label: 'Novedades / habitación', route: '/novedades/habitacion' },
  { key: 'caja', label: 'Caja', route: '/caja', anyOf: ['cash.view'] },
  {
    key: 'turno',
    label: 'Mi turno',
    route: '/turno',
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
  },
  {
    key: 'llaves',
    label: 'Llaves',
    route: '/llaves',
    anyOf: ['key.assign', 'key.inventory', 'key.stock'],
  },
  { key: 'alertas', label: 'Avisos', route: '/notificaciones' },
  { key: 'housekeeping', label: 'Housekeeping', route: '/housekeeping', anyOf: HOUSEKEEPING_ACCESS_PERMISSIONS },
  { key: 'inventario', label: 'Inventario', route: '/inventario', anyOf: ['inventory.view', 'inventory.move', 'inventory.manage', 'laundry.manage'] },
  { key: 'equipo', label: 'Equipo y horarios', route: '/equipo', anyOf: ['schedule.self.view', 'schedule.view', 'schedule.view.all', 'schedule.manage', 'schedule.publish', 'schedule.catalog.manage', 'schedule.extra.approve', 'schedule.configure'] },
  {
    key: 'supervision',
    label: 'Centro de Supervisión',
    route: '/supervision',
    anyOf: ['supervision.center.view'],
  },
  {
    key: 'gerencia',
    label: 'Gerencia',
    route: '/gerencia',
    anyOf: ['management.dashboard.view'],
  },
  {
    key: 'auditoria',
    label: 'Auditoría',
    route: '/admin/auditoria',
    anyOf: ['audit.view'],
  },
  {
    key: 'administracion',
    label: 'Administración',
    route: '/admin',
    anyOf: ['user.manage', 'role.manage', 'system.configure', 'support.view'],
  },
];

function allowed(
  item: { anyOf?: PermissionKey[]; route?: string },
  permissions: PermissionKey[],
): boolean {
  return hkNavigationAllowed(permissions, item.route) && (!item.anyOf || item.anyOf.some((permission) => permissions.includes(permission)));
}

export function isTutorialModuleKey(value: string): value is TutorialModuleKey {
  return (TUTORIAL_MODULE_KEYS as readonly string[]).includes(value);
}

export function enabledTutorialModules(permissions: PermissionKey[]): TutorialModuleKey[] {
  return TUTORIAL_MODULES.filter((module) => allowed(module, permissions)).map(
    (module) => module.key,
  );
}

export function visibleTutorialModules(permissions: PermissionKey[]): TutorialModule[] {
  return TUTORIAL_MODULES.filter((module) => allowed(module, permissions));
}

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
 * Recorrido general del primer ingreso.
 *
 * Es deliberadamente breve: presenta el mapa del producto. La capacitación
 * profunda vive en MODULE_TUTORIAL_STEPS y vuelve a aparecer sólo cuando un
 * módulo nuevo se habilita para la cuenta.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'coordinacion', title: 'Responsables y continuidad', description: 'Consulta los pendientes de tus áreas, confirma qué recibiste y deja la siguiente acción para quien continúa. El resultado se registra en el trabajo original.', route: '/coordinacion', target: ROUTE_TARGET },
  { id: 'equipo', module: 'equipo', title: 'Equipo y horarios', description: 'Calendario de personal por área, colaboradores, glosa, cobertura, cambios y extras. Publicar no acredita asistencia ni cambia el turno operativo.', route: '/equipo', target: ROUTE_TARGET, anyOf: ['schedule.self.view', 'schedule.view', 'schedule.view.all', 'schedule.manage', 'schedule.publish', 'schedule.catalog.manage', 'schedule.extra.approve', 'schedule.configure'] },
  {
    id: 'inicio',
    title: 'Mi jornada: tu entrada operativa',
    description:
      'Aquí ves lo urgente, vencido y pendiente y entras al recorrido que corresponde a tu rol. AROH organiza continuidad; FNSrooms sigue siendo el PMS.',
    route: '/',
    target: ROUTE_TARGET,
  },
  {
    id: 'acciones-modulo',
    title: 'Acciones dentro de cada módulo',
    description:
      'Cada función vive donde corresponde. Novedad, tarea, alerta, Caja y controles conservan su propia trazabilidad: no se duplican para aparentar integración.',
    route: '/libro?clase=entry',
    target: '[data-tour="module-actions"], [data-tour="route-title"], main h1',
  },
  {
    id: 'busqueda',
    title: 'Búsqueda global',
    description:
      'Busca #ID, habitación, huésped, responsable o texto. Los identificadores humanos te permiten saltar al objeto concreto.',
    target: '[data-tour="global-search"]',
  },
  {
    id: 'libro',
    module: 'novedades',
    title: 'Novedades',
    description:
      'El núcleo operativo registra qué pasó, qué queda pendiente, quién responde y cómo se resolvió. Tareas, seguimientos y alertas son objetos distintos, vinculables.',
    route: '/libro?clase=entry',
    target: ROUTE_TARGET,
  },
  {
    id: 'novedades-habitacion',
    module: 'habitaciones',
    title: 'Novedades / habitación',
    description:
      'Las 89 habitaciones son un monitor de contexto operacional. Al tocar una habitación ves directamente sus novedades, tareas, alertas, garantías y el reflejo histórico de folios de Caja.',
    route: '/novedades/habitacion',
    target: ROUTE_TARGET,
  },
  {
    id: 'caja',
    module: 'caja',
    title: 'Caja',
    description:
      'Fondo fijo, garantías, movimientos, arqueos, diferencias, gimnasio y estacionamiento viven aquí. Caja es la fuente de verdad financiera.',
    route: '/caja',
    target: ROUTE_TARGET,
    anyOf: ['cash.view'],
  },
  {
    id: 'turno',
    module: 'turno',
    title: 'Mi turno',
    description:
      'Inicio, recepción, continuidad, entrega y cierre siguen un ciclo formal. La operación se bloquea cuando el turno no está ACTIVO.',
    route: '/turno',
    target: ROUTE_TARGET,
    anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
  },
  {
    id: 'llaves',
    module: 'llaves',
    title: 'Llaves',
    description:
      'Inventario físico por pisos 4, 5 y 6, con faltantes, fuera de servicio y trazabilidad. No depende del PMS.',
    route: '/llaves',
    target: ROUTE_TARGET,
    anyOf: ['key.assign', 'key.inventory', 'key.stock'],
  },
  {
    id: 'avisos-recibidos',
    module: 'alertas',
    title: 'Avisos recibidos',
    description: 'Desde Avisos puedes abrir el asunto que originó cada cambio, programar un recordatorio o retomar un pendiente. Leer un aviso no resuelve el asunto ni cambia sus permisos.',
    route: '/notificaciones',
    target: ROUTE_TARGET,
  },
  {
    id: 'alertas',
    module: 'alertas',
    title: 'Recordarme / avisar',
    description:
      'Una alerta es una llamada de atención programable. Una notificación sólo avisa y te lleva al objeto original; no crea una segunda tarea ni una segunda novedad.',
    route: '/alertas',
    target: ROUTE_TARGET,
  },
  {
    id: 'housekeeping', module: 'housekeeping', title: 'Housekeeping',
    description: 'Organiza el trabajo del día: solicita, asigna, ejecuta y revisa según tu cargo y área. Una limpieza terminada requiere inspección de otra persona antes de aprobarse.',
    route: '/housekeeping', target: ROUTE_TARGET, anyOf: HOUSEKEEPING_ACCESS_PERMISSIONS,
  },
  {
    id: 'inventario',
    module: 'inventario',
    title: 'Inventario y lavandería',
    description: 'Consulta el stock común, sus ubicaciones y movimientos desde una sola fuente. Lavandería utiliza ese mismo inventario y mantiene folios, entregas, recepciones y diferencias trazables.',
    route: '/inventario',
    target: ROUTE_TARGET,
    anyOf: ['inventory.view', 'inventory.move', 'inventory.manage', 'laundry.manage'],
  },
  {
    id: 'supervision',
    module: 'supervision',
    title: 'Centro de Supervisión',
    description:
      'Concentra pendientes, asignación, auditorías, medidas correctivas, informes, salud operativa y rendimiento sin rankings.',
    route: '/supervision',
    target: ROUTE_TARGET,
    anyOf: ['supervision.center.view'],
  },
  {
    id: 'gerencia',
    module: 'gerencia',
    title: 'Gerencia',
    description:
      'No muestra una pista vaga: explica qué está mal, enseña el registro que lo demuestra, permite abrirlo directamente y Fronti sugiere una acción sobre esos hechos.',
    route: '/gerencia',
    target: ROUTE_TARGET,
    anyOf: ['management.dashboard.view'],
  },
  {
    id: 'auditoria',
    module: 'auditoria',
    title: 'Auditoría',
    description:
      'Consulta quién cambió qué, cuándo y por qué. El historial es trazabilidad; nunca se reescribe para “corregir” el pasado.',
    route: '/admin/auditoria',
    target: ROUTE_TARGET,
    anyOf: ['audit.view'],
  },
  {
    id: 'administracion',
    module: 'administracion',
    title: 'Administración',
    description:
      'Usuarios, roles, permisos, soporte y configuración técnica viven aquí. Al habilitar un módulo nuevo a una cuenta, AROH le ofrece automáticamente su tutorial.',
    route: '/admin',
    target: ROUTE_TARGET,
    anyOf: ['user.manage', 'role.manage', 'system.configure', 'support.view'],
  },
  {
    id: 'ayuda',
    title: 'Ayuda y tutoriales por módulo',
    description:
      'La Ayuda documenta las funciones reales del sistema y permite volver a iniciar el recorrido general o el tutorial de cualquier módulo disponible para tu cuenta.',
    target: '[data-tour="help-center"]',
  },
];

export const MODULE_TUTORIAL_STEPS: Record<TutorialModuleKey, TutorialStep[]> = {
  inventario: [
    {
      id: 'mod-inventario-stock',
      module: 'inventario',
      title: 'Una sola fuente de existencias',
      description: 'Artículos, ubicaciones y saldos viven en Inventario. Un carro o material asignado a una persona sigue formando parte del stock común: la asignación cambia la custodia, no crea ni descuenta una copia.',
      route: '/inventario',
      target: ROUTE_TARGET,
      anyOf: ['inventory.view', 'inventory.move', 'inventory.manage', 'laundry.manage'],
    },
    {
      id: 'mod-inventario-movimientos',
      module: 'inventario',
      title: 'Mueve material con trazabilidad',
      description: 'Los traslados registran origen, destino, cantidad y motivo. Quien opera sólo puede mover dentro de su alcance; administrar categorías, artículos, ubicaciones y valorización requiere el permiso específico.',
      route: '/inventario',
      target: ROUTE_TARGET,
      anyOf: ['inventory.move', 'inventory.manage'],
    },
    {
      id: 'mod-inventario-lavanderia',
      module: 'inventario',
      title: 'Lavandería reutiliza el inventario',
      description: 'Los folios de lavandería registran entrega, recepción parcial y diferencias contra las mismas existencias. No existe un segundo stock paralelo.',
      route: '/lavanderia',
      target: ROUTE_TARGET,
      anyOf: ['laundry.manage'],
    },
  ],
  equipo: [
    { id: 'mod-equipo-calendario', module: 'equipo', title: 'Planifica por área', description: 'Añade usuarios existentes al área y define su referencia semanal en horas. La jornada se computa completa. Crea una malla y programa por casillas o revisa una carga. Los bloques de ocho días y la semana calendario tienen vistas independientes.', route: '/equipo', target: ROUTE_TARGET },
    { id: 'mod-equipo-cambios', module: 'equipo', title: 'Revisa antes de cambiar', description: 'Mover, reasignar, intercambiar y agregar cobertura tienen efectos distintos. El servidor comprueba pertenencia, solapamientos y descanso configurado. Una asignación anterior permanece en el historial.', route: '/equipo', target: ROUTE_TARGET },
    { id: 'mod-equipo-publicar', module: 'equipo', title: 'Publicar y recibir el horario', description: 'Los borradores están reservados a quienes administran o publican el área. Publicar avisa a las cuentas vinculadas y deja pendiente confirmar recepción. Los extras requieren aprobación y la malla no acredita asistencia ni abre Recepción o Caja.', route: '/equipo', target: ROUTE_TARGET },
  ],
  housekeeping: [
    {
      id: 'mod-housekeeping-recepcion', module: 'housekeeping', title: 'Ubica tu trabajo del día',
      description: 'Selecciona fecha y área. Recepción solicita; la supervisora organiza disponibilidad y asignaciones; cada mucama ejecuta sus trabajos. La novedad vinculada conserva su contenido original.',
      route: '/housekeeping', target: ROUTE_TARGET,
    },
    {
      id: 'mod-housekeeping-resultado', module: 'housekeeping', title: 'Termina, inspecciona y da continuidad',
      description: 'Comienza tu asignación, registra impedimentos y marca terminado con un resultado. Otra persona habilitada inspecciona la limpieza y aprueba o devuelve para corregir. El relevo conserva pendientes y llaves; Fronti propone y tú confirmas.',
      route: '/housekeeping', target: ROUTE_TARGET,
    },
  ],
  novedades: [
    {
      id: 'mod-novedades-registro',
      module: 'novedades',
      title: 'Novedades: registra el hecho una sola vez',
      description:
        'Crea la novedad o incidencia con contexto, prioridad, habitación si corresponde y responsable. No la dupliques como alerta o tarea para “dar visibilidad”.',
      route: '/libro?clase=entry',
      target: '[data-tour="module-actions"], [data-tour="route-title"], main h1',
    },
    {
      id: 'mod-novedades-continuidad',
      module: 'novedades',
      title: 'Convierte el hecho en trabajo cuando haga falta',
      description:
        'Tarea = trabajo concreto. Seguimiento = continuidad. Alerta = llamada de atención programada. Notificación = aviso. Los cuatro pueden apuntar al mismo origen sin duplicarlo.',
      route: '/libro?clase=entry',
      target: ROUTE_TARGET,
    },
    {
      id: 'mod-novedades-id',
      module: 'novedades',
      title: 'Usa el #ID para volver al origen',
      description:
        'Los objetos operativos usan identificadores humanos globales. Cuando Fronti, Supervisión o Gerencia señalan algo, el objetivo es poder abrir ese registro exacto.',
      route: '/libro?clase=entry',
      target: '[data-tour="global-search"], [data-tour="route-title"], main h1',
    },
  ],
  habitaciones: [
    {
      id: 'mod-habitaciones-mapa',
      module: 'habitaciones',
      title: 'Las 89 habitaciones son contexto, no PMS',
      description:
        'El mapa 401–429, 501–530 y 601–630 concentra actividad operacional por habitación. No modela ocupación, check-in ni check-out.',
      route: '/novedades/habitacion',
      target: ROUTE_TARGET,
    },
    {
      id: 'mod-habitaciones-detalle',
      module: 'habitaciones',
      title: 'Toca una habitación y ve el detalle',
      description:
        'Al seleccionar una habitación, AROH abre el panel de detalle visible con sus novedades, tareas, seguimientos, alertas y garantías, con enlaces hacia cada objeto.',
      route: '/novedades/habitacion',
      target: '#detalle-habitacion, [data-tour="route-title"], main h1',
    },
    {
      id: 'mod-habitaciones-folios',
      module: 'habitaciones',
      title: 'Gym y estacionamiento: reflejo histórico',
      description:
        'Los folios de gimnasio y estacionamiento aparecen durante 30 días como reflejo. La fuente de verdad sigue siendo Caja y el folio abre su registro allí.',
      route: '/novedades/habitacion',
      target: ROUTE_TARGET,
    },
  ],
  caja: [
    {
      id: 'mod-caja-conceptos',
      module: 'caja',
      title: 'Caja separa conceptos',
      description:
        'Fondo fijo, garantías bajo custodia y movimientos operacionales no son lo mismo. AROH los mantiene separados para que un saldo aparente no esconda una diferencia real.',
      route: '/caja',
      target: ROUTE_TARGET,
      anyOf: ['cash.view'],
    },
    {
      id: 'mod-caja-arqueo',
      module: 'caja',
      title: 'Arquea y deja la diferencia visible',
      description:
        'El arqueo compara esperado versus contado. Si no coincide, la diferencia queda trazada; no se borra ni se corrige maquillando el historial.',
      route: '/caja?seccion=auditorias',
      target: ROUTE_TARGET,
      anyOf: ['cash.view'],
    },
    {
      id: 'mod-caja-servicios',
      module: 'caja',
      title: 'Gimnasio y estacionamiento también nacen en Caja',
      description:
        'Emite folios de gimnasio y tickets de estacionamiento con habitación y contexto. Estacionamiento usa ID Reserva; Novedades / habitación sólo refleja estos registros por 30 días.',
      route: '/caja?seccion=gimnasio',
      target: ROUTE_TARGET,
      anyOf: ['cash.view'],
    },
  ],
  turno: [
    {
      id: 'mod-turno-recibir',
      module: 'turno',
      title: 'Primero recibe la continuidad',
      description:
        'El turno saliente debe cerrar. Después, quien recibe abre la entrega pendiente, recuenta Caja y valida la recepción antes de iniciar el siguiente turno.',
      route: '/turno',
      target: ROUTE_TARGET,
      anyOf: ['shift.start', 'shift.receive', 'shift.manage'],
    },
    {
      id: 'mod-turno-activo',
      module: 'turno',
      title: 'La operación exige turno ACTIVO',
      description:
        'Sin turno, durante recepción o durante cierre, las acciones operativas del mesón quedan bloqueadas. Las consultas de lectura siguen disponibles cuando corresponde.',
      route: '/turno',
      target: ROUTE_TARGET,
      anyOf: ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
    },
    {
      id: 'mod-turno-entrega',
      module: 'turno',
      title: 'Entrega, cierre y firma',
      description:
        'Prepara la entrega, cierra Caja, envía y cierra formalmente el turno. La entrega queda disponible para recepción y el acta conserva firmas y trazabilidad.',
      route: '/turno',
      target: ROUTE_TARGET,
      anyOf: ['shift.handover', 'shift.close', 'shift.manage'],
    },
  ],
  llaves: [
    {
      id: 'mod-llaves-pisos',
      module: 'llaves',
      title: 'Inventario por piso o completo',
      description:
        'Puedes revisar todos los pisos o separar 4, 5 y 6. El catálogo siempre representa las 89 habitaciones canónicas.',
      route: '/llaves?piso=todos',
      target: ROUTE_TARGET,
      anyOf: ['key.assign', 'key.inventory', 'key.stock'],
    },
    {
      id: 'mod-llaves-diferencias',
      module: 'llaves',
      title: 'Los faltantes quedan como señal',
      description:
        'Registra encontrado y fuera de servicio. Las diferencias físicas quedan trazadas y pueden alimentar Supervisión y Fronti; no se deducen desde ocupación PMS.',
      route: '/llaves?piso=todos',
      target: ROUTE_TARGET,
      anyOf: ['key.inventory', 'key.stock'],
    },
  ],
  alertas: [
    {
      id: 'mod-alertas-programar',
      module: 'alertas',
      title: 'Programa una alerta sólo cuando quieras atención futura',
      description:
        'La alerta tiene fecha/hora y destinatario individual, grupal o global. Puede vincularse a una novedad, tarea o habitación sin crear una copia del objeto.',
      route: '/alertas',
      target: ROUTE_TARGET,
    },
    {
      id: 'mod-alertas-notificacion',
      module: 'alertas',
      title: 'Notificación no significa alerta',
      description:
        'La campana sólo avisa. Al abrir una notificación llegas al objeto que originó el aviso; marcarla leída no resuelve la tarea, novedad o alerta de origen.',
      route: '/notificaciones',
      target: ROUTE_TARGET,
    },
  ],
  supervision: [
    {
      id: 'mod-supervision-centro',
      module: 'supervision',
      title: 'Supervisión concentra excepciones, no duplica operación',
      description:
        'Revisa pendientes, continuidad, tareas y seguimientos desde una capa de control. Los objetos siguen viviendo en sus módulos originales.',
      route: '/supervision',
      target: ROUTE_TARGET,
      anyOf: ['supervision.center.view'],
    },
    {
      id: 'mod-supervision-auditorias',
      module: 'supervision',
      title: 'Auditorías y medidas correctivas',
      description:
        'Una auditoría puede generar hallazgos y medidas correctivas con responsable, plazo y validación. El cierre exige evidencia y trazabilidad.',
      route: '/supervision/auditorias',
      target: ROUTE_TARGET,
      anyOf: ['supervision.center.view'],
    },
    {
      id: 'mod-supervision-control',
      module: 'supervision',
      title: 'Informes, salud y rendimiento',
      description:
        'Los informes consolidan datos operativos; Salud detecta señales de flujo/técnicas; Rendimiento mide cumplimiento sin rankings personales.',
      route: '/supervision',
      target: ROUTE_TARGET,
      anyOf: ['supervision.center.view'],
    },
  ],
  gerencia: [
    {
      id: 'mod-gerencia-decision',
      module: 'gerencia',
      title: 'Gerencia empieza por lo que requiere decisión',
      description:
        'El cockpit prioriza diferencias, incidencias, backlog, continuidad, llaves y hallazgos usando hechos del sistema, no conclusiones inventadas.',
      route: '/gerencia',
      target: ROUTE_TARGET,
      anyOf: ['management.dashboard.view'],
    },
    {
      id: 'mod-gerencia-trazabilidad',
      module: 'gerencia',
      title: 'Trazabilidad significa ver el error exacto',
      description:
        'Cada señal expone el detalle detectado y un enlace al arqueo, tarea, incidencia, habitación o control concreto. No te manda a revisar manualmente un módulo entero.',
      route: '/gerencia',
      target: ROUTE_TARGET,
      anyOf: ['management.dashboard.view'],
    },
    {
      id: 'mod-gerencia-fronti',
      module: 'gerencia',
      title: 'Fronti explica sobre evidencia',
      description:
        'Fronti recibe los hechos detectados, explica qué ocurrió y qué revisar sin inventar montos, responsables ni causas. Si IA no responde, AROH conserva la acción determinística.',
      route: '/gerencia',
      target: ROUTE_TARGET,
      anyOf: ['management.dashboard.view'],
    },
  ],
  auditoria: [
    {
      id: 'mod-auditoria-rastro',
      module: 'auditoria',
      title: 'Auditoría conserva el rastro',
      description:
        'Consulta fecha, usuario, entidad, acción y contexto de los cambios. La auditoría sirve para reconstruir qué ocurrió, no para editar el pasado.',
      route: '/admin/auditoria',
      target: ROUTE_TARGET,
      anyOf: ['audit.view'],
    },
  ],
  administracion: [
    {
      id: 'mod-admin-usuarios',
      module: 'administracion',
      title: 'Usuarios y visibilidad operativa',
      description:
        'Crea cuentas, asigna roles y puede marcar una cuenta como oculta para que opere normalmente sin aparecer en selectores, turnos ni directorios.',
      route: '/admin/usuarios',
      target: ROUTE_TARGET,
      anyOf: ['user.manage'],
    },
    {
      id: 'mod-admin-permisos',
      module: 'administracion',
      title: 'Los módulos se habilitan por permisos',
      description:
        'La matriz de Roles y permisos define qué módulos y acciones ve cada cuenta. Cuando una cuenta gana acceso a un módulo que no conocía, AROH dispara su tutorial automáticamente.',
      route: '/admin/roles',
      target: ROUTE_TARGET,
      anyOf: ['role.manage'],
    },
    {
      id: 'mod-admin-soporte',
      module: 'administracion',
      title: 'Reportes, solicitudes y configuración',
      description:
        'La bandeja conserva reportes/solicitudes y adjuntos; Parámetros, Correo y Fronti concentran la configuración técnica según permisos.',
      route: '/admin',
      target: ROUTE_TARGET,
      anyOf: ['user.manage', 'role.manage', 'system.configure', 'support.view'],
    },
  ],
};

export function guidedTourSteps(permissions: PermissionKey[]): TutorialStep[] {
  return TUTORIAL_STEPS.filter((step) => allowed(step, permissions));
}

export function moduleTutorialSteps(
  modules: readonly TutorialModuleKey[],
  permissions: PermissionKey[],
): TutorialStep[] {
  const enabled = new Set(enabledTutorialModules(permissions));
  return modules
    .filter((module) => enabled.has(module))
    .flatMap((module) => MODULE_TUTORIAL_STEPS[module])
    .filter((step) => allowed(step, permissions));
}
