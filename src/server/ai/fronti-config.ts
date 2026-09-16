import 'server-only';

import { env } from '@/lib/env';
import {
  getSettingBool,
  getSettingNumber,
  getSettingString,
} from '@/server/services/settings';

export type FrontiToolKey =
  | 'room'
  | 'priorities'
  | 'deadlines'
  | 'checkout'
  | 'reminder'
  | 'fine';

export type FrontiConfig = {
  enabled: boolean;
  displayName: string;
  welcomeMessage: string;
  extraInstructions: string;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  memoryRetentionDays: number;
  shiftMemoryHours: number;
  memoryContextLimit: number;
  modelHistoryLimit: number;
  sessionActivityMinutes: number;
  tools: Record<FrontiToolKey, boolean>;
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function reasoning(value: string): 'low' | 'medium' | 'high' {
  return value === 'medium' || value === 'high' ? value : 'low';
}

export async function getFrontiConfig(): Promise<FrontiConfig> {
  const [
    enabled,
    displayName,
    welcomeMessage,
    extraInstructions,
    model,
    effort,
    retention,
    shiftHours,
    memoryLimit,
    historyLimit,
    activityMinutes,
    room,
    priorities,
    deadlines,
    checkout,
    reminder,
    fine,
  ] = await Promise.all([
    getSettingBool('fronti.enabled', true),
    getSettingString('fronti.displayName', 'Fronti'),
    getSettingString(
      'fronti.welcomeMessage',
      'Hola, soy Fronti. Puedo revisar el Libro, recordar contexto útil, consultar habitaciones y vencimientos, y preparar acciones para que las confirmes.',
    ),
    getSettingString(
      'fronti.extraInstructions',
      'Prioriza claridad, brevedad y seguridad operacional. Si un dato puede haber cambiado, verifícalo con las herramientas del Libro antes de responder.',
    ),
    getSettingString('fronti.model', env().OPENAI_MODEL),
    getSettingString('fronti.reasoningEffort', 'low'),
    getSettingNumber('fronti.memoryRetentionDays', 30),
    getSettingNumber('fronti.shiftMemoryHours', 36),
    getSettingNumber('fronti.memoryContextLimit', 12),
    getSettingNumber('fronti.modelHistoryLimit', 15),
    getSettingNumber('fronti.sessionActivityMinutes', 15),
    getSettingBool('fronti.tool.room', true),
    getSettingBool('fronti.tool.priorities', true),
    getSettingBool('fronti.tool.deadlines', true),
    getSettingBool('fronti.tool.checkout', true),
    getSettingBool('fronti.tool.reminder', true),
    getSettingBool('fronti.tool.fine', true),
  ]);

  return {
    enabled,
    displayName: displayName.slice(0, 40),
    welcomeMessage: welcomeMessage.slice(0, 800),
    extraInstructions: extraInstructions.slice(0, 4000),
    model: model.slice(0, 120),
    reasoningEffort: reasoning(effort),
    memoryRetentionDays: clamp(retention, 1, 90, 30),
    shiftMemoryHours: clamp(shiftHours, 1, 72, 36),
    memoryContextLimit: clamp(memoryLimit, 1, 30, 12),
    modelHistoryLimit: clamp(historyLimit, 4, 30, 15),
    sessionActivityMinutes: clamp(activityMinutes, 5, 60, 15),
    tools: { room, priorities, deadlines, checkout, reminder, fine },
  };
}

export function frontiToolSettingForFunction(name: string): FrontiToolKey | null {
  switch (name) {
    case 'consultar_habitacion':
      return 'room';
    case 'consultar_prioridades':
      return 'priorities';
    case 'consultar_vencimientos':
      return 'deadlines';
    case 'proponer_checkouts':
      return 'checkout';
    case 'proponer_recordatorio':
      return 'reminder';
    case 'proponer_multa':
      return 'fine';
    default:
      return null;
  }
}
