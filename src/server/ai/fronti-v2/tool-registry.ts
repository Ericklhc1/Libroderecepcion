import 'server-only';

import {
  frontiToolSettingForFunction,
  type FrontiConfig,
} from '@/server/ai/fronti-config';
import type { CurrentUser } from '@/server/auth/current-user';
import type { FrontiResolvedPageContext } from './page-context';

export type FrontiToolRegistryEntry = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
  mode: 'read' | 'propose' | 'system';
  area: string;
};

type FrontiPermissionSubject = Pick<CurrentUser, 'permissions' | 'isSystemAdmin'>;

function hasAnyPermission(
  user: FrontiPermissionSubject,
  permissions: readonly string[],
): boolean {
  return permissions.some((permission) =>
    user.permissions.some((value) => value === permission),
  );
}

/**
 * Fronti no tiene un rol propio: hereda exactamente la capacidad efectiva del
 * usuario que lo invoca. Esta capa evita incluso mostrarle al modelo
 * herramientas que esa cuenta no podría usar. La ejecución vuelve a validar
 * permisos en los servicios como segunda barrera.
 */
export function canFrontiUseTool(
  user: FrontiPermissionSubject,
  name: string,
): boolean {
  if (user.isSystemAdmin) return true;

  switch (name) {
    case 'consultar_contexto_pantalla':
    case 'consultar_estado_operativo':
    case 'reportar_hallazgo':
      return true;
    case 'consultar_habitacion':
      return hasAnyPermission(user, ['room.view']);
    case 'consultar_prioridades':
      return hasAnyPermission(user, ['metrics.view', 'room.view']);
    case 'consultar_vencimientos':
      return hasAnyPermission(user, [
        'task.create',
        'task.assign',
        'task.edit',
        'task.close',
        'followup.create',
        'followup.manage',
        'entry.create',
        'entry.edit',
        'entry.close',
        'metrics.view',
        'supervision.view',
      ]);
    case 'consultar_caja':
      return hasAnyPermission(user, ['cash.view']);
    case 'consultar_llaves':
      return hasAnyPermission(user, ['key.inventory']);
    case 'consultar_turnos':
      return hasAnyPermission(user, [
        'shift.start',
        'shift.receive',
        'shift.handover',
        'shift.close',
        'shift.manage',
        'metrics.view',
      ]);
    case 'consultar_novedades':
      return hasAnyPermission(user, [
        'entry.create',
        'entry.edit',
        'entry.close',
        'metrics.view',
        'supervision.view',
      ]);
    case 'consultar_garantias':
      return hasAnyPermission(user, [
        'cash.view',
        'cash.guarantee_in',
        'cash.guarantee_out',
        'room.view',
      ]);
    case 'consultar_tareas':
      return hasAnyPermission(user, [
        'task.create',
        'task.assign',
        'task.edit',
        'task.close',
        'metrics.view',
      ]);
    case 'consultar_seguimientos':
      return hasAnyPermission(user, [
        'followup.create',
        'followup.manage',
        'metrics.view',
      ]);
    case 'consultar_supervision':
      return hasAnyPermission(user, [
        'supervision.center.view',
        'supervision.view',
      ]);
    case 'consultar_alertas':
      return hasAnyPermission(user, ['alert.manage', 'metrics.view']);
    case 'consultar_auditoria':
      return hasAnyPermission(user, ['audit.view']);
    case 'consultar_usuarios':
      return hasAnyPermission(user, ['user.manage', 'task.assign', 'shift.manage']);
    case 'consultar_configuracion_operativa':
      return hasAnyPermission(user, ['system.configure']);
    case 'proponer_checkouts':
      return hasAnyPermission(user, ['room.manage']);
    case 'proponer_recordatorio':
      return hasAnyPermission(user, ['task.create']);
    case 'proponer_registro':
      return hasAnyPermission(user, ['entry.create', 'incident.create']);
    case 'proponer_resolver_tarea':
      return hasAnyPermission(user, ['task.close']);
    case 'proponer_multa':
      return hasAnyPermission(user, ['incident.manage']);
    default:
      return false;
  }
}

export function filterFrontiToolDefinitionsForUser(
  user: FrontiPermissionSubject,
  definitions: readonly FrontiToolRegistryEntry[],
): readonly FrontiToolRegistryEntry[] {
  return definitions.filter((definition) => canFrontiUseTool(user, definition.name));
}

export const FRONTI_TOOL_REGISTRY: readonly FrontiToolRegistryEntry[] = [
  {
    type: 'function',
    name: 'consultar_contexto_pantalla',
    description:
      'Lee el contexto vivo de la pantalla actual de Central de Operaciones: módulo, sección, filtros, entidad abierta y una fotografía compacta de las fuentes reales visibles para el usuario. Úsala para referencias como “aquí”, “esto”, “esta pantalla”, “este registro”, “qué falta acá” o “qué ves”. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'contexto',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_habitacion',
    description:
      'Consulta el estado operativo actual de una habitación, su salida, ocupante, entrada, llaves, incidencias y garantías. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'habitaciones',
    parameters: {
      type: 'object',
      properties: {
        roomNumber: { type: 'string', description: 'Número de habitación, por ejemplo 415.' },
      },
      required: ['roomNumber'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_prioridades',
    description:
      'Obtiene el panorama operativo para sugerir qué revisar primero: habitaciones que requieren acción, tareas vencidas, alertas, seguimientos e incidencias críticas. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'operacion',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_vencimientos',
    description:
      'Lista próximos vencimientos de tareas, seguimientos y registros operativos. Úsala cuando pregunten qué vence pronto o qué está por vencer.',
    strict: true,
    mode: 'read',
    area: 'operacion',
    parameters: {
      type: 'object',
      properties: {
        hours: {
          type: 'integer',
          minimum: 1,
          maximum: 168,
          description: 'Horizonte en horas. Usa 24 si el usuario no especifica otro.',
        },
      },
      required: ['hours'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_estado_operativo',
    description:
      'Construye una vista transversal del estado actual de AROH Central IA usando las áreas que la cuenta puede consultar: prioridades, Caja y Llaves. Úsala para preguntas amplias como “qué está pasando”, “qué falta”, “dame un panorama” o “qué cosas raras hay”. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'sistema',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_caja',
    description:
      'Consulta el estado actual de Caja: fondo fijo, esperado, movimientos, custodia de garantías, transferible y arqueos recientes. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'caja',
    parameters: {
      type: 'object',
      properties: {
        movements: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description: 'Cantidad máxima de movimientos recientes a incluir. Usa 10 por defecto.',
        },
      },
      required: ['movements'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_llaves',
    description:
      'Consulta el inventario físico de llaves y sus estados. Puede mostrar faltantes, asignadas, pendientes de devolución, extraviadas y fuera de servicio. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'llaves',
    parameters: {
      type: 'object',
      properties: {
        onlyAttention: {
          type: 'boolean',
          description: 'Si es true, devuelve sólo llaves que requieren atención.',
        },
      },
      required: ['onlyAttention'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_turnos',
    description:
      'Consulta el turno propio, participantes, entregas pendientes y turnos esperando recepción. Úsala para preguntas sobre quién está en turno, qué turno está abierto o qué entrega falta recibir.',
    strict: true,
    mode: 'read',
    area: 'turnos',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_novedades',
    description:
      'Consulta novedades e incidencias de la Central con responsable, prioridad, estado, habitación y vencimiento. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'novedades',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        onlyOpen: {
          type: 'boolean',
          description: 'true para devolver sólo registros abiertos; false para incluir cerrados recientes.',
        },
      },
      required: ['limit', 'onlyOpen'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_garantias',
    description:
      'Consulta garantías abiertas con referencia, habitación, huésped, estado, monto, divisa y fecha objetivo. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'caja',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_tareas',
    description:
      'Consulta tareas abiertas. Puede limitarse a las tareas del usuario o, si sus permisos lo permiten, mostrar las abiertas del equipo.',
    strict: true,
    mode: 'read',
    area: 'tareas',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['mias', 'abiertas'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['scope', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_seguimientos',
    description:
      'Consulta seguimientos operativos visibles para el usuario, respetando la privacidad de Supervisión.',
    strict: true,
    mode: 'read',
    area: 'seguimientos',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        onlyOpen: { type: 'boolean' },
      },
      required: ['limit', 'onlyOpen'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_supervision',
    description:
      'Consulta el panorama de Supervisión o el Centro de Supervisión según los permisos de la cuenta. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'supervision',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_alertas',
    description:
      'Consulta alertas operativas vivas con nivel, estado, origen y vencimiento. No modifica nada.',
    strict: true,
    mode: 'read',
    area: 'alertas',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_auditoria',
    description:
      'Consulta la trazabilidad reciente del sistema. Requiere permiso de auditoría y nunca expone secretos ni credenciales.',
    strict: true,
    mode: 'read',
    area: 'auditoria',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        entity: {
          type: ['string', 'null'],
          description: 'Entidad exacta a filtrar, o null para auditoría reciente general.',
        },
      },
      required: ['limit', 'entity'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_usuarios',
    description:
      'Consulta usuarios operativos y roles. Las cuentas inactivas sólo se incluyen si quien pregunta administra usuarios.',
    strict: true,
    mode: 'read',
    area: 'usuarios',
    parameters: {
      type: 'object',
      properties: {
        includeInactive: { type: 'boolean' },
      },
      required: ['includeInactive'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_configuracion_operativa',
    description:
      'Consulta parámetros configurables de AROH Central IA. Sólo está disponible para quien tenga permiso de configuración del sistema y no expone credenciales.',
    strict: true,
    mode: 'read',
    area: 'configuracion',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: ['string', 'null'],
          description: 'Categoría exacta de configuración o null para todas.',
        },
      },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_checkouts',
    description:
      'Prepara la confirmación de salida de una o más habitaciones. Nunca afirmes que el check-out fue realizado hasta que el usuario confirme la tarjeta de acción.',
    strict: true,
    mode: 'propose',
    area: 'habitaciones',
    parameters: {
      type: 'object',
      properties: {
        roomNumbers: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: { type: 'string' },
        },
        note: { type: ['string', 'null'] },
      },
      required: ['roomNumbers', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_recordatorio',
    description:
      'Prepara una tarea-recordatorio asignada al usuario actual con fecha y hora. Requiere confirmación antes de crearla.',
    strict: true,
    mode: 'propose',
    area: 'tareas',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: ['string', 'null'], maxLength: 2000 },
        dueAt: {
          type: 'string',
          description: 'Fecha y hora ISO 8601 con zona horaria explícita.',
        },
        priority: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
      },
      required: ['title', 'description', 'dueAt', 'priority'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_registro',
    description:
      'Prepara una novedad o incidencia de la Central. Las incidencias requieren gravedad. La escritura sólo ocurre después de confirmar la tarjeta.',
    strict: true,
    mode: 'propose',
    area: 'novedades',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['NOVEDAD', 'INCIDENCIA'] },
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: 'string', minLength: 3, maxLength: 4000 },
        roomNumber: { type: ['string', 'null'] },
        priority: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
        severity: {
          type: ['string', 'null'],
          enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA', null],
        },
        requiresFollowUp: { type: 'boolean' },
      },
      required: [
        'type',
        'title',
        'description',
        'roomNumber',
        'priority',
        'severity',
        'requiresFollowUp',
      ],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_resolver_tarea',
    description:
      'Prepara la finalización de una tarea existente. Requiere permiso task.close y confirmación antes de modificarla.',
    strict: true,
    mode: 'propose',
    area: 'tareas',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: ['string', 'null'] },
        taskSeq: { type: ['integer', 'null'], minimum: 1 },
        reason: { type: ['string', 'null'], maxLength: 1000 },
      },
      required: ['taskId', 'taskSeq', 'reason'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'reportar_hallazgo',
    description:
      'Reporta a Supervisor y Administrador de sistema un fallo concreto o una mejora de proceso detectada por Fronti.',
    strict: true,
    mode: 'system',
    area: 'auditoria',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['FALLO', 'MEJORA'] },
        severity: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
        area: { type: 'string', minLength: 2, maxLength: 120 },
        title: { type: 'string', minLength: 4, maxLength: 200 },
        evidence: { type: 'string', minLength: 8, maxLength: 1200 },
        recommendation: { type: ['string', 'null'], maxLength: 1200 },
      },
      required: ['kind', 'severity', 'area', 'title', 'evidence', 'recommendation'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_multa',
    description:
      'Prepara una multa para una habitación usando el contexto real de la estadía. Requiere confirmación y nunca debe inventar monto o antecedentes.',
    strict: true,
    mode: 'propose',
    area: 'incidencias',
    parameters: {
      type: 'object',
      properties: {
        roomNumber: { type: 'string' },
        kind: { type: 'string', enum: ['BLANCO', 'DANO', 'FALTANTE', 'OTRO'] },
        linenKind: {
          type: ['string', 'null'],
          enum: [
            'TOALLA_MANO',
            'TOALLA_CUERPO',
            'TOALLA_PISO',
            'SABANA',
            'FUNDA_ALMOHADA',
            'CUBRECAMA',
            'PROTECTOR_COLCHON',
            'BATA',
            'MANTEL',
            'CORTINA',
            'OTRO',
            null,
          ],
        },
        itemDetail: { type: ['string', 'null'] },
        stainType: { type: ['string', 'null'] },
        reason: { type: 'string', minLength: 3, maxLength: 2000 },
        guestStatement: { type: ['string', 'null'] },
        amount: { type: ['number', 'null'] },
        currency: { type: 'string', enum: ['CLP', 'USD'] },
      },
      required: [
        'roomNumber',
        'kind',
        'linenKind',
        'itemDetail',
        'stainType',
        'reason',
        'guestStatement',
        'amount',
        'currency',
      ],
      additionalProperties: false,
    },
  },
] as const;

const ALWAYS_AVAILABLE = new Set([
  'consultar_contexto_pantalla',
  'consultar_estado_operativo',
  'consultar_caja',
  'consultar_llaves',
  'consultar_turnos',
  'consultar_novedades',
  'consultar_garantias',
  'consultar_tareas',
  'consultar_seguimientos',
  'consultar_supervision',
  'consultar_alertas',
  'consultar_auditoria',
  'consultar_usuarios',
  'consultar_configuracion_operativa',
  'reportar_hallazgo',
  'proponer_registro',
  'proponer_resolver_tarea',
]);

export function enabledFrontiToolDefinitions(
  config: FrontiConfig,
): readonly FrontiToolRegistryEntry[] {
  return FRONTI_TOOL_REGISTRY.filter((definition) => {
    if (ALWAYS_AVAILABLE.has(definition.name)) return true;
    const key = frontiToolSettingForFunction(definition.name);
    return key ? config.tools[key] : false;
  });
}

function normalizedIntent(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function addMany(target: Set<string>, names: readonly string[]): void {
  for (const name of names) target.add(name);
}

/**
 * Reduce el catálogo enviado al modelo según la intención literal de la
 * consulta. El registro completo sigue siendo la fuente de verdad; esto sólo
 * evita reenviar ~20 schemas cuando la pregunta habla de dos o tres áreas.
 *
 * La selección es deliberadamente determinística: no usa otro LLM, no concede
 * permisos y nunca habilita una herramienta desactivada.
 */
export function selectFrontiToolDefinitions(
  config: FrontiConfig,
  userMessage: string,
  pageContext: FrontiResolvedPageContext | null = null,
): readonly FrontiToolRegistryEntry[] {
  const enabled = enabledFrontiToolDefinitions(config);
  const text = normalizedIntent(userMessage);
  const wanted = new Set<string>();

  if (pageContext) {
    wanted.add('consultar_contexto_pantalla');
  }

  const contextualReference =
    /\baqui\b|\baca\b|\besto\b|\besta pantalla\b|\beste registro\b|\besta tarea\b|\besta reserva\b|\besta garantia\b|\besta caja\b|\beste turno\b|\bque ves\b|\bque falta\b|\bque hago\b|\bcomo seguimos\b|\brevisa esto\b|\brevisa aqui\b/.test(
      text,
    );

  if (pageContext && (contextualReference || text.length < 42)) {
    addMany(wanted, pageContext.recommendedTools);
  }

  const broad =
    /que esta pasando|que pasa hoy|panorama|estado operativo|todo el libro|toda la central|que falta|cosas raras/.test(
      text,
    );

  if (broad) {
    addMany(wanted, [
      'consultar_estado_operativo',
      'consultar_turnos',
      'consultar_novedades',
      'consultar_garantias',
      'consultar_tareas',
      'consultar_seguimientos',
      'consultar_supervision',
      'consultar_alertas',
    ]);
  }

  if (/caja|arqueo|fondo fijo|efectivo|tesorer/.test(text)) wanted.add('consultar_caja');
  if (/garant/.test(text)) wanted.add('consultar_garantias');
  if (/novedad|incidencia/.test(text)) wanted.add('consultar_novedades');
  if (/llave/.test(text)) wanted.add('consultar_llaves');
  if (/turno|relevo|entrega pendiente|quien esta/.test(text)) wanted.add('consultar_turnos');
  if (/venc|proxim/.test(text)) wanted.add('consultar_vencimientos');
  if (/seguimiento/.test(text)) wanted.add('consultar_seguimientos');
  if (/supervisi/.test(text)) wanted.add('consultar_supervision');
  if (/alerta/.test(text)) wanted.add('consultar_alertas');
  if (/auditor/.test(text)) wanted.add('consultar_auditoria');
  if (/usuario|usuarios|rol|roles/.test(text)) wanted.add('consultar_usuarios');
  if (/configur|parametro/.test(text)) wanted.add('consultar_configuracion_operativa');
  if (/habitacion|pieza|room|\b[4-6]\d{2}\b/.test(text)) wanted.add('consultar_habitacion');
  if (/prioridad|revisar primero/.test(text)) wanted.add('consultar_prioridades');

  if (/check.?out|confirmar salida|confirma la salida/.test(text)) wanted.add('proponer_checkouts');
  if (/recuerdame|recordatorio/.test(text)) wanted.add('proponer_recordatorio');
  if (/multa|cobro por dano|cobro por mancha/.test(text)) wanted.add('proponer_multa');
  if (/crea|crear|registra|registrar|anota|anotar/.test(text) && /novedad|incidencia/.test(text)) {
    wanted.add('proponer_registro');
  }
  if (/completa|completar|resuelve|resolver|marca como completada/.test(text) && /tarea|t#|#\\d+/.test(text)) {
    wanted.add('proponer_resolver_tarea');
  }
  if (/reporta|reportar|informa al supervisor|avisa al administrador/.test(text)) {
    wanted.add('reportar_hallazgo');
  }

  if (wanted.size === 0 && /incoherenc|contradic/.test(text)) {
    addMany(wanted, [
      'consultar_estado_operativo',
      'consultar_turnos',
      'consultar_novedades',
      'consultar_caja',
      'consultar_garantias',
      'consultar_llaves',
    ]);
  }

  // Conversación, memoria o preguntas de identidad pueden resolverse sin
  // herramientas. Enviar un catálogo vacío reduce costo y TPM sin perder
  // ninguna capacidad necesaria para ese turno.
  if (wanted.size === 0) return [];

  return enabled.filter((definition) => wanted.has(definition.name));
}

export function assertFrontiToolEnabled(
  config: FrontiConfig,
  functionName: string,
): void {
  if (ALWAYS_AVAILABLE.has(functionName)) return;
  const key = frontiToolSettingForFunction(functionName);
  if (!key || !config.tools[key]) {
    throw new Error('Esta capacidad de Fronti está desactivada por el Administrador de sistema.');
  }
}

export function frontiToolMode(functionName: string): FrontiToolRegistryEntry['mode'] | null {
  return FRONTI_TOOL_REGISTRY.find((definition) => definition.name === functionName)?.mode ?? null;
}

export function frontiToolCatalog() {
  return FRONTI_TOOL_REGISTRY.map(({ name, description, mode, area }) => ({
    name,
    description,
    mode,
    area,
  }));
}
