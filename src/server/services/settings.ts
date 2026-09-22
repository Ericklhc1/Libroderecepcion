import 'server-only';
import { prisma } from '@/lib/prisma';

/** Parámetros del sistema con valor por defecto en código y sobrescritura en BD. */
export const DEFAULT_SETTINGS = {
  'hotel.name': {
    value: 'Hotel Demo',
    category: 'general',
    description: 'Nombre del hotel que se muestra en la cabecera.',
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
  'home.operationalFeedLimit': {
    value: 12,
    category: 'inicio',
    description: 'Máximo de eventos recientes que muestra la ventana operativa de Inicio.',
  },
  'alerts.dashboardLimit': {
    value: 10,
    category: 'alertas',
    description: 'Máximo de alertas activas que se muestran directamente en Inicio.',
  },
  'reservations.showEmptyRooms': {
    value: true,
    category: 'reservas',
    description: 'Muestra carpetas de habitaciones aunque no tengan un ID FNS activo.',
  },
  'reservations.showUnassigned': {
    value: true,
    category: 'reservas',
    description: 'Muestra la bandeja de reservas con ID FNS pero sin habitación asignada.',
  },
  'keys.pendingReturnWarningHours': {
    value: 2,
    category: 'llaves',
    description: 'Horas tras las que una llave pendiente de devolución se considera atrasada.',
  },
  'diagnostics.enabled': {
    value: true,
    category: 'diagnóstico',
    description: 'Habilita el Centro de diagnóstico y reparación para el Administrador de sistema.',
  },
  'diagnostics.runtimeCaptureEnabled': {
    value: true,
    category: 'diagnóstico',
    description: 'Registra errores de ejecución de la interfaz para analizarlos desde Administración.',
  },
  'diagnostics.safeRepairDuplicateAlerts': {
    value: true,
    category: 'diagnóstico',
    description: 'Permite a la reparación segura depurar alertas duplicadas exactas sin comentarios ni tareas.',
  },
  'diagnostics.safeRepairReservationLinks': {
    value: true,
    category: 'diagnóstico',
    description: 'Permite volver a vincular estadías con la reserva correcta usando exclusivamente el ID FNS.',
  },
  'diagnostics.safeRepairRoomProjection': {
    value: true,
    category: 'diagnóstico',
    description: 'Permite corregir la habitación proyectada de una reserva cuando sus estadías activas son inequívocas.',
  },

  // Caja: las divisas son fijas (CLP y USD); estas reglas deciden qué módulos
  // están activos y qué validaciones aplican en la operación.
  'cash.treasuryTransfersEnabled': {
    value: true,
    category: 'caja',
    description: 'Permite registrar transferencias internas de Recepción a Tesorería durante la entrega de turno.',
  },
  'cash.transferReceiptRequired': {
    value: false,
    category: 'caja',
    description: 'Exige comprobante/referencia al registrar un egreso a tesorería.',
  },
  'cash.usdRateEnabled': {
    value: true,
    category: 'caja',
    description: 'Muestra y permite declarar el tipo de cambio USD/CLP del turno.',
  },
  'cash.requireDifferenceNote': {
    value: true,
    category: 'caja',
    description: 'Exige explicar una diferencia entre el efectivo contado y el fondo mínimo.',
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
  'fronti.provider': {
    value: 'groq',
    category: 'fronti',
    description: 'Proveedor de inferencia: Groq, vLLM autohospedado u OpenAI como fallback explícito.',
  },
  'fronti.model': {
    value: 'openai/gpt-oss-120b',
    category: 'fronti',
    description: 'Modelo utilizado por Fronti. El valor por defecto es un modelo open-weight con tool calling.',
  },
  'fronti.reasoningEffort': {
    value: 'low',
    category: 'fronti',
    description: 'Preferencia de razonamiento para proveedores/modelos que la soporten.',
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

/**
 * Lee varios parámetros numéricos en un solo viaje a la base.
 * Útil para pantallas calientes como Inicio: evita añadir esperas paralelas
 * sólo para recuperar límites configurables.
 */
export async function getSettingNumbers(
  keys: readonly SettingKey[],
): Promise<Record<string, number>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  return Object.fromEntries(
    keys.map((key) => {
      const fallback = Number(DEFAULT_SETTINGS[key].value);
      const raw = byKey.has(key) ? byKey.get(key) : DEFAULT_SETTINGS[key].value;
      const parsed = typeof raw === 'number' ? raw : Number(raw);
      return [key, Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : 0)];
    }),
  );
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
