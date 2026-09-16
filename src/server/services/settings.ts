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
