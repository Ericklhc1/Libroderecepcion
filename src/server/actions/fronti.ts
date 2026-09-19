'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';
import { RuleError } from '@/server/errors';
import { DEFAULT_SETTINGS, type SettingKey } from '@/server/services/settings';
import { enforceFrontiRetentionPolicy } from '@/server/ai/retention-policy';
import {
  clearFrontiProviderSecret,
  getFrontiProviderCredentialView,
  saveFrontiProviderSecret,
  type FrontiProviderName,
} from '@/server/ai/fronti-provider';

const FRONTI_KEYS = (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).filter((key) =>
  key.startsWith('fronti.'),
);

const inputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

const providerCredentialSchema = z.object({
  provider: z.enum(['groq', 'vllm', 'openai']),
  apiKey: z.string().trim().min(8, 'La credencial parece incompleta.').max(2000),
});

const providerOnlySchema = z.object({
  provider: z.enum(['groq', 'vllm', 'openai']),
});

const NUMBER_LIMITS: Partial<Record<SettingKey, { min: number; max: number }>> = {
  'fronti.memoryRetentionDays': { min: 1, max: 90 },
  'fronti.shiftMemoryHours': { min: 1, max: 72 },
  'fronti.memoryContextLimit': { min: 1, max: 30 },
  'fronti.modelHistoryLimit': { min: 4, max: 30 },
  'fronti.sessionActivityMinutes': { min: 5, max: 60 },
};

function parseValue(key: SettingKey, raw: string): unknown {
  const defaultValue = DEFAULT_SETTINGS[key].value;
  if (typeof defaultValue === 'boolean') {
    if (!['true', 'false', '1', '0', 'on', 'off'].includes(raw)) {
      throw new RuleError('El valor debe ser activado o desactivado.');
    }
    return raw === 'true' || raw === '1' || raw === 'on';
  }
  if (typeof defaultValue === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new RuleError('El valor debe ser numérico.');
    const limits = NUMBER_LIMITS[key];
    if (limits && (value < limits.min || value > limits.max)) {
      throw new RuleError(`El valor debe estar entre ${limits.min} y ${limits.max}.`);
    }
    return Math.round(value);
  }

  const value = raw.trim();
  if (!value) throw new RuleError('El valor no puede quedar vacío.');
  if (key === 'fronti.displayName' && value.length > 40) {
    throw new RuleError('El nombre visible no puede superar 40 caracteres.');
  }
  if (key === 'fronti.welcomeMessage' && value.length > 800) {
    throw new RuleError('El mensaje de bienvenida no puede superar 800 caracteres.');
  }
  if (key === 'fronti.extraInstructions' && value.length > 4000) {
    throw new RuleError('Las instrucciones adicionales no pueden superar 4000 caracteres.');
  }
  if (key === 'fronti.provider' && !['groq', 'vllm', 'openai'].includes(value)) {
    throw new RuleError('El proveedor debe ser groq, vllm u openai.');
  }
  if (key === 'fronti.model' && value.length > 120) {
    throw new RuleError('El identificador del modelo no puede superar 120 caracteres.');
  }
  if (key === 'fronti.reasoningEffort' && !['low', 'medium', 'high'].includes(value)) {
    throw new RuleError('El esfuerzo de razonamiento debe ser low, medium o high.');
  }
  return value;
}

export async function saveFrontiSettingAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = inputSchema.parse({
      key: String(formData.get('key') ?? ''),
      value: String(formData.get('value') ?? ''),
    });

    if (!FRONTI_KEYS.includes(input.key as SettingKey)) {
      throw new RuleError('El parámetro de Fronti indicado no existe.');
    }
    const key = input.key as SettingKey;
    const value = parseValue(key, input.value);
    const previous = await prisma.systemSetting.findUnique({ where: { key } });

    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never, updatedById: actor.id },
      create: {
        key,
        value: value as never,
        category: DEFAULT_SETTINGS[key].category,
        description: DEFAULT_SETTINGS[key].description,
        updatedById: actor.id,
      },
    });

    if (key === 'fronti.memoryRetentionDays' || key === 'fronti.shiftMemoryHours') {
      await enforceFrontiRetentionPolicy();
    }

    await recordAudit({
      entity: 'SystemSetting',
      entityId: setting.id,
      action: AuditAction.CONFIGURAR,
      summary: `Configuración de Fronti actualizada: ${key}`,
      user: actor,
      before: { value: previous?.value ?? DEFAULT_SETTINGS[key].value },
      after: { value },
    });

    revalidatePath('/admin/fronti');
    revalidatePath('/admin/parametros');
    revalidatePath('/');
    return { ok: true as const, message: 'Configuración de Fronti guardada.' };
  });
}

export async function resetFrontiSettingsAction(): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const existing = await prisma.systemSetting.findMany({
      where: { key: { in: FRONTI_KEYS } },
      select: { key: true, value: true },
    });

    await prisma.systemSetting.deleteMany({ where: { key: { in: FRONTI_KEYS } } });
    await enforceFrontiRetentionPolicy();
    await recordAudit({
      entity: 'SystemSetting',
      entityId: 'fronti',
      action: AuditAction.CONFIGURAR,
      summary: 'Configuración de Fronti restablecida a valores por defecto',
      user: actor,
      before: { overrides: existing },
      after: { overrides: [] },
    });

    revalidatePath('/admin/fronti');
    revalidatePath('/admin/parametros');
    revalidatePath('/');
    return { ok: true as const, message: 'Fronti volvió a sus valores por defecto.' };
  });
}

export async function cleanupFrontiMemoryAction(): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const result = await enforceFrontiRetentionPolicy();
    await recordAudit({
      entity: 'System',
      entityId: 'fronti-memory',
      action: AuditAction.CONFIGURAR,
      summary: `Limpieza manual de memoria vencida de Fronti: ${result.messages} mensajes, ${result.memories} memorias, ${result.conversations} conversaciones`,
      user: actor,
    });
    revalidatePath('/admin/fronti');
    return {
      ok: true as const,
      message: `Memoria vencida limpiada: ${result.messages} mensajes, ${result.memories} memorias y ${result.conversations} conversaciones.`,
    };
  });
}


export async function saveFrontiProviderCredentialAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = providerCredentialSchema.parse({
      provider: String(formData.get('provider') ?? ''),
      apiKey: String(formData.get('apiKey') ?? ''),
    });
    const before = await getFrontiProviderCredentialView(input.provider);

    await saveFrontiProviderSecret(
      input.provider as FrontiProviderName,
      input.apiKey,
      actor.id,
    );

    await recordAudit({
      entity: 'FrontiProviderCredential',
      entityId: input.provider,
      action: AuditAction.CONFIGURAR,
      summary: `Credencial de Fronti configurada: ${input.provider}`,
      user: actor,
      before: {
        stored: before.hasStoredSecret,
        envConfigured: before.envConfigured,
        unreadable: before.storedSecretUnreadable,
      },
      after: { stored: true },
    });

    revalidatePath('/admin/fronti');
    return {
      ok: true as const,
      message: 'Credencial guardada cifrada. El valor no volverá a mostrarse.',
    };
  });
}

export async function clearFrontiProviderCredentialAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = providerOnlySchema.parse({
      provider: String(formData.get('provider') ?? ''),
    });
    const before = await getFrontiProviderCredentialView(input.provider);

    await clearFrontiProviderSecret(input.provider as FrontiProviderName);

    await recordAudit({
      entity: 'FrontiProviderCredential',
      entityId: input.provider,
      action: AuditAction.CONFIGURAR,
      summary: `Credencial guardada de Fronti eliminada: ${input.provider}`,
      user: actor,
      before: {
        stored: before.hasStoredSecret,
        envConfigured: before.envConfigured,
        unreadable: before.storedSecretUnreadable,
      },
      after: { stored: false },
    });

    revalidatePath('/admin/fronti');
    return {
      ok: true as const,
      message:
        'Credencial guardada eliminada. Si existe una variable de entorno para ese proveedor, seguirá utilizándose.',
    };
  });
}
