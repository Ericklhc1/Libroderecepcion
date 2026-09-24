import 'server-only';

import {
  frontiToolSettingForFunction,
  type FrontiConfig,
} from '@/server/ai/fronti-config';

export type FrontiToolRegistryEntry = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
  mode: 'read' | 'propose' | 'system';
  area: string;
};

export const FRONTI_TOOL_REGISTRY: readonly FrontiToolRegistryEntry[] = [
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
      'Prepara una novedad o incidencia del Libro. Las incidencias requieren gravedad. La escritura sólo ocurre después de confirmar la tarjeta.',
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

export function frontiToolCatalog() {
  return FRONTI_TOOL_REGISTRY.map(({ name, description, mode, area }) => ({
    name,
    description,
    mode,
    area,
  }));
}
