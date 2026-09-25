import 'server-only';

import { env } from '@/lib/env';
import { getAllSettings } from '@/server/services/settings';
import type { FrontiProviderName } from './fronti-provider';

export type FrontiToolKey =
  | 'room'
  | 'priorities'
  | 'deadlines'
  | 'checkout'
  | 'reminder'
  | 'fine';

export type FrontiConfig = {
  enabled: boolean;
  provider: FrontiProviderName;
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

function provider(value: string): FrontiProviderName {
  return value === 'vllm' || value === 'cloudflare' ? value : 'groq';
}

function reasoning(value: string): 'low' | 'medium' | 'high' {
  return value === 'medium' || value === 'high' ? value : 'low';
}

export async function getFrontiConfig(): Promise<FrontiConfig> {
  const settings = await getAllSettings();
  const values = new Map<string, unknown>(
    settings.map((setting) => [setting.key, setting.value] as [string, unknown]),
  );

  const bool = (key: string, fallback: boolean) => {
    const value = values.get(key);
    return typeof value === 'boolean' ? value : fallback;
  };
  const number = (key: string, fallback: number) => {
    const value = values.get(key);
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const string = (key: string, fallback: string) => {
    const value = values.get(key);
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  };

  return {
    enabled: bool('fronti.enabled', true),
    provider: provider(string('fronti.provider', env().FRONTI_PROVIDER)),
    displayName: string('fronti.displayName', 'Fronti').slice(0, 40),
    welcomeMessage: string(
      'fronti.welcomeMessage',
      'Hola, soy Fronti. Puedo revisar el Libro, recordar contexto útil, consultar habitaciones y vencimientos, y preparar acciones para que las confirmes.',
    ).slice(0, 800),
    extraInstructions: string(
      'fronti.extraInstructions',
      'Prioriza claridad, brevedad y seguridad operacional. Si un dato puede haber cambiado, verifícalo con las herramientas del Libro antes de responder.',
    ).slice(0, 4000),
    model: string('fronti.model', env().FRONTI_MODEL).slice(0, 120),
    reasoningEffort: reasoning(string('fronti.reasoningEffort', 'low')),
    memoryRetentionDays: clamp(number('fronti.memoryRetentionDays', 30), 1, 90, 30),
    shiftMemoryHours: clamp(number('fronti.shiftMemoryHours', 36), 1, 72, 36),
    memoryContextLimit: clamp(number('fronti.memoryContextLimit', 12), 1, 30, 12),
    modelHistoryLimit: clamp(number('fronti.modelHistoryLimit', 15), 4, 30, 15),
    sessionActivityMinutes: clamp(number('fronti.sessionActivityMinutes', 15), 5, 60, 15),
    tools: {
      room: bool('fronti.tool.room', true),
      priorities: bool('fronti.tool.priorities', true),
      deadlines: bool('fronti.tool.deadlines', true),
      checkout: bool('fronti.tool.checkout', true),
      reminder: bool('fronti.tool.reminder', true),
      fine: bool('fronti.tool.fine', true),
    },
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
