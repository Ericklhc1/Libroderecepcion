import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { AuditAction } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError } from '@/server/errors';

/**
 * Parámetros del hotel.
 *
 * El valor es JSON porque los parámetros son heterogéneos, pero cada clave
 * tiene un valor por defecto tipado en este archivo. Las reglas operativas no
 * leen cadenas mágicas repartidas por la aplicación: pasan por estas funciones.
 */
export const DEFAULT_SETTINGS = {
  'hotel.name': 'Hotel HW Libertad',
  'shift.maxHours': 12,
  'shift.requireSupervisorValidation': true,
  'shift.autoCloseOnReceive': true,
  'task.overdueAlertMinutes': 0,
  'maintenance.staleHours': 24,
  'book.pageSize': 50,
  'gym.price.externalCLP': 10000,
  'gym.price.externalUSD': 10,
  'reception.usdRateCLP': 0,
  'reception.checkoutHour': 11,
  // Integración Fronti: desactivada por defecto. Activarla exige configurar
  // también los secretos en variables de entorno; acá nunca se guardan claves.
  'fronti.enabled': false,
  'fronti.baseUrl': 'https://fronti.example.com',
  'fronti.hotelCode': '',
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export const SETTING_META: Record<
  SettingKey,
  { category: string; description: string; type: 'string' | 'number' | 'boolean' }
> = {
  'hotel.name': {
    category: 'hotel',
    description: 'Nombre visible del hotel',
    type: 'string',
  },
  'shift.maxHours': {
    category: 'turnos',
    description: 'Duración máxima de un turno antes de marcarlo vencido',
    type: 'number',
  },
  'shift.requireSupervisorValidation': {
    category: 'turnos',
    description: 'Exigir validación del Supervisor al cierre',
    type: 'boolean',
  },
  'shift.autoCloseOnReceive': {
    category: 'turnos',
    description: 'Cerrar el turno anterior cuando el siguiente recibe la entrega',
    type: 'boolean',
  },
  'task.overdueAlertMinutes': {
    category: 'alertas',
    description: 'Minutos de tolerancia antes de alertar una tarea vencida',
    type: 'number',
  },
  'maintenance.staleHours': {
    category: 'alertas',
    description: 'Horas para considerar un mantenimiento sin resolver',
    type: 'number',
  },
  'book.pageSize': {
    category: 'libro',
    description: 'Registros por página del Libro Operativo',
    type: 'number',
  },
  'gym.price.externalCLP': {
    category: 'caja',
    description: 'Tarifa gimnasio para no huéspedes en pesos chilenos',
    type: 'number',
  },
  'gym.price.externalUSD': {
    category: 'caja',
    description: 'Tarifa gimnasio para no huéspedes en dólares',
    type: 'number',
  },
  'reception.usdRateCLP': {
    category: 'recepción',
    description: 'Valor operativo del dólar en pesos chilenos que usa Recepción',
    type: 'number',
  },
  'reception.checkoutHour': {
    category: 'recepción',
    description: 'Hora límite de check-out; desde esta hora se alertan salidas sin confirmar',
    type: 'number',
  },
  'fronti.enabled': {
    category: 'integraciones',
    description: 'Habilitar el cliente de Fronti',
    type: 'boolean',
  },
  'fronti.baseUrl': {
    category: 'integraciones',
    description: 'URL base de la API de Fronti',
    type: 'string',
  },
  'fronti.hotelCode': {
    category: 'integraciones',
    description: 'Código del hotel en Fronti',
    type: 'string',
  },
};

/** Obtiene un parámetro con fallback seguro a su valor por defecto. */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return DEFAULT_SETTINGS[key];
  return row.value as (typeof DEFAULT_SETTINGS)[K];
}

export async function getSettingBool(key: SettingKey, fallback: boolean): Promise<boolean> {
  const value = await getSetting(key);
  return typeof value === 'boolean' ? value : fallback;
}

export async function getSettingNumber(key: SettingKey, fallback: number): Promise<number> {
  const value = await getSetting(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function listSettings() {
  const rows = await prisma.systemSetting.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).map((key) => {
    const existing = byKey.get(key);
    return {
      id: existing?.id ?? null,
      key,
      value: existing?.value ?? DEFAULT_SETTINGS[key],
      category: existing?.category ?? SETTING_META[key].category,
      description: existing?.description ?? SETTING_META[key].description,
      type: SETTING_META[key].type,
      updatedAt: existing?.updatedAt ?? null,
    };
  });
}

export async function setSetting(
  user: CurrentUser,
  input: { key: string; rawValue: string },
) {
  if (!(input.key in DEFAULT_SETTINGS)) {
    throw new NotFoundError('Ese parámetro no existe.');
  }
  const key = input.key as SettingKey;
  const meta = SETTING_META[key];
  let value: Prisma.InputJsonValue;

  if (meta.type === 'boolean') {
    if (!['true', 'false'].includes(input.rawValue)) {
      throw new Error('El valor debe ser verdadero o falso.');
    }
    value = input.rawValue === 'true';
  } else if (meta.type === 'number') {
    const parsed = Number(input.rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('El valor debe ser un número igual o mayor que cero.');
    }
    if (key === 'reception.checkoutHour' && (!Number.isInteger(parsed) || parsed > 23)) {
      throw new Error('La hora límite de check-out debe estar entre 0 y 23.');
    }
    value = parsed;
  } else {
    value = input.rawValue.trim();
  }

  const updated = await prisma.systemSetting.upsert({
    where: { key },
    create: {
      key,
      value,
      category: meta.category,
      description: meta.description,
      updatedById: user.id,
    },
    update: {
      value,
      category: meta.category,
      description: meta.description,
      updatedById: user.id,
    },
  });

  await recordAudit({
    entity: 'SystemSetting',
    entityId: updated.id,
    action: AuditAction.CONFIGURAR,
    user,
    summary: `Parámetro ${key} actualizado`,
    after: { key, value },
  });

  return updated;
}
