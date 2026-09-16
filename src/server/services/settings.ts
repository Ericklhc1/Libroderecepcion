import 'server-only';
import { prisma } from '@/lib/prisma';

/** Parámetros del sistema con valor por defecto en código y sobrescritura en BD. */
export const DEFAULT_SETTINGS = {
  'hotel.name': {
    value: 'Hotel Demo',
    category: 'general',
    description: 'Nombre del hotel que se muestra en la cabecera.',
  },
  'shift.autoCloseOnReceive': {
    value: true,
    category: 'turnos',
    description:
      'Cierra automáticamente el turno saliente cuando el turno siguiente confirma la recepción de la entrega.',
  },
  'shift.handoverReminderMinutes': {
    value: 60,
    category: 'turnos',
    description:
      'Minutos que puede permanecer una entrega enviada sin confirmar antes de generar alerta.',
  },
  'task.dueSoonHours': {
    value: 4,
    category: 'tareas',
    description: 'Horas de antelación para avisar de un vencimiento próximo.',
  },
  'maintenance.staleHours': {
    value: 24,
    category: 'alertas',
    description: 'Horas antes de alertar por mantenimiento sin resolver.',
  },
  'book.pageSize': {
    value: 40,
    category: 'general',
    description: 'Registros por página en el libro operativo.',
  },
  'gym.passPriceCLP': {
    value: 6000,
    category: 'gimnasio',
    description: 'Precio del pase de gimnasio cuando se cobra en pesos chilenos.',
  },
  'gym.passPriceUSD': {
    value: 6,
    category: 'gimnasio',
    description: 'Precio del pase de gimnasio cuando se cobra en dólares estadounidenses.',
  },
  'reception.usdRateCLP': {
    value: 0,
    category: 'recepción',
    description: 'Valor operativo del dólar en pesos chilenos que usa Recepción.',
  },
  'reception.checkoutHour': {
    value: 11,
    category: 'recepción',
    description: 'Hora límite de check-out; desde esta hora se alertan salidas sin confirmar.',
  },

  // Fronti. Los controles de seguridad (permisos, auditoría y confirmaciones)
  // NO son configurables desde esta tabla: forman parte del contrato operativo.
  'fronti.enabled': {
    value: true,
    category: 'fronti',
    description: 'Muestra Fronti y permite usar el asistente operativo.',
  },
  'fronti.displayName': {
    value: 'Fronti',
    category: 'fronti',
    description: 'Nombre visible del asistente en el Libro.',
  },
  'fronti.welcomeMessage': {
    value:
      'Hola, soy Fronti. Puedo revisar el Libro, recordar contexto útil, consultar habitaciones y vencimientos, y preparar acciones para que las confirmes.',
    category: 'fronti',
    description: 'Mensaje inicial cuando no existe historial de conversación.',
  },
  'fronti.extraInstructions': {
    value: 'Prioriza claridad, brevedad y seguridad operacional. Si un dato puede haber cambiado, verifícalo con las herramientas del Libro antes de responder.',
    category: 'fronti',
    description: 'Instrucciones adicionales de comportamiento para Fronti.',
  },
  'fronti.model': {
    value: 'gpt-5.6-luna',
    category: 'fronti',
    description: 'Modelo de OpenAI utilizado por Fronti. La clave API sigue protegida en el servidor.',
  },
  'fronti.reasoningEffort': {
    value: 'low',
    category: 'fronti',
    description: 'Esfuerzo de razonamiento: low, medium o high.',
  },
  'fronti.memoryRetentionDays': {
    value: 30,
    category: 'fronti',
    description: 'Días que se conserva la memoria personal y el historial nuevo de Fronti.',
  },
  'fronti.shiftMemoryHours': {
    value: 36,
    category: 'fronti',
    description: 'Horas máximas de vida para recuerdos vinculados al turno.',
  },
  'fronti.memoryContextLimit': {
    value: 12,
    category: 'fronti',
    description: 'Máximo de recuerdos relevantes que Fronti recupera para una respuesta.',
  },
  'fronti.modelHistoryLimit': {
    value: 15,
    category: 'fronti',
    description: 'Máximo de mensajes recientes enviados al modelo como contexto conversacional.',
  },
  'fronti.sessionActivityMinutes': {
    value: 15,
    category: 'fronti',
    description: 'Ventana de actividad reciente usada por el cliente para mantener viva la sesión.',
  },
  'fronti.tool.room': {
    value: true,
    category: 'fronti-capacidades',
    description: 'Permite consultar el estado operativo de habitaciones.',
  },
  'fronti.tool.priorities': {
    value: true,
    category: 'fronti-capacidades',
    description: 'Permite consultar y ordenar prioridades operativas.',
  },
  'fronti.tool.deadlines': {
    value: true,
    category: 'fronti-capacidades',
    description: 'Permite consultar próximos vencimientos.',
  },
  'fronti.tool.checkout': {
    value: true,
    category: 'fronti-capacidades',
    description: 'Permite preparar check-outs. La ejecución siempre requiere confirmación y permiso.',
  },
  'fronti.tool.reminder': {
    value: true,
    category: 'fronti-capacidades',
    description: 'Permite preparar recordatorios/tareas. La creación siempre requiere confirmación y permiso.',
  },
  'fronti.tool.fine': {
    value: true,
    category: 'fronti-capacidades',
    description: 'Permite preparar multas. El registro siempre requiere confirmación y permiso.',
  },
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

async function readSetting(key: SettingKey): Promise<unknown> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (row) return row.value;
  return DEFAULT_SETTINGS[key].value;
}

export async function getSettingBool(
  key: SettingKey,
  fallback: boolean,
): Promise<boolean> {
  const value = await readSetting(key).catch(() => fallback);
  return typeof value === 'boolean' ? value : fallback;
}

export async function getSettingNumber(
  key: SettingKey,
  fallback: number,
): Promise<number> {
  const value = await readSetting(key).catch(() => fallback);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getSettingString(
  key: SettingKey,
  fallback: string,
): Promise<string> {
  const value = await readSetting(key).catch(() => fallback);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export async function getAllSettings() {
  const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).map((key) => {
    const meta = DEFAULT_SETTINGS[key];
    const row = byKey.get(key);
    return {
      key,
      value: row ? row.value : (meta.value as unknown),
      defaultValue: meta.value as unknown,
      category: meta.category,
      description: meta.description,
      overridden: Boolean(row),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}