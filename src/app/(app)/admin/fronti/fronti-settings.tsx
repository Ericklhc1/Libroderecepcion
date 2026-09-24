'use client';

import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  cleanupFrontiMemoryAction,
  clearFrontiProviderCredentialAction,
  resetFrontiSettingsAction,
  saveFrontiProviderCredentialAction,
  saveFrontiSettingAction,
  setFrontiUserAccessAction,
} from '@/server/actions/fronti';

export type FrontiUserAccessRow = {
  id: string;
  name: string;
  username: string;
  roleName: string;
  active: boolean;
  enabled: boolean;
  alwaysEnabled: boolean;
};

export function FrontiUserAccessList({
  users,
}: {
  users: FrontiUserAccessRow[];
}) {
  return (
    <div className="divide-y divide-slate-100">
      {users.map((user) => (
        <div
          key={user.id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-petrol-900">{user.name}</p>
              <span className="text-sm font-medium text-petrol-600">@{user.username}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-medium text-slate-600">
                {user.roleName}
              </span>
              {!user.active ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-medium text-slate-500">
                  Cuenta inactiva
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {user.alwaysEnabled
                ? 'Fronti permanece siempre disponible para esta cuenta.'
                : user.enabled
                  ? 'Incluido en el despliegue gradual de Fronti.'
                  : 'Fronti no se muestra ni acepta solicitudes de esta cuenta.'}
            </p>
          </div>

          {user.alwaysEnabled ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Siempre activo
            </span>
          ) : (
            <ActionForm action={setFrontiUserAccessAction} className="flex items-end gap-2 space-y-0">
              <input type="hidden" name="userId" value={user.id} />
              <select
                name="enabled"
                defaultValue={user.enabled ? 'true' : 'false'}
                className="input-base min-w-[9rem]"
              >
                <option value="true">Activado</option>
                <option value="false">Desactivado</option>
              </select>
              <SubmitButton size="sm" variant="secondary" pendingLabel="Guardando…">
                Guardar
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      ))}
    </div>
  );
}

export type FrontiSettingRow = {
  key: string;
  value: unknown;
  defaultValue: unknown;
  description: string;
  overridden: boolean;
};

const NUMBER_META: Record<string, { min: number; max: number; suffix?: string }> = {
  'fronti.memoryRetentionDays': { min: 1, max: 90, suffix: 'días' },
  'fronti.shiftMemoryHours': { min: 1, max: 72, suffix: 'horas' },
  'fronti.memoryContextLimit': { min: 1, max: 30, suffix: 'recuerdos' },
  'fronti.modelHistoryLimit': { min: 4, max: 30, suffix: 'mensajes' },
  'fronti.sessionActivityMinutes': { min: 5, max: 60, suffix: 'minutos' },
};

function labelFor(key: string): string {
  const labels: Record<string, string> = {
    'fronti.enabled': 'Fronti activo',
    'fronti.displayName': 'Nombre visible',
    'fronti.welcomeMessage': 'Mensaje de bienvenida',
    'fronti.extraInstructions': 'Instrucciones adicionales',
    'fronti.provider': 'Proveedor de IA',
    'fronti.model': 'Modelo',
    'fronti.reasoningEffort': 'Esfuerzo de razonamiento',
    'fronti.memoryRetentionDays': 'Memoria personal',
    'fronti.shiftMemoryHours': 'Memoria del turno',
    'fronti.memoryContextLimit': 'Recuerdos por respuesta',
    'fronti.modelHistoryLimit': 'Historial enviado al modelo',
    'fronti.sessionActivityMinutes': 'Ventana de actividad de sesión',
    'fronti.tool.room': 'Consultar habitaciones',
    'fronti.tool.priorities': 'Consultar prioridades',
    'fronti.tool.deadlines': 'Consultar vencimientos',
    'fronti.tool.checkout': 'Preparar check-out',
    'fronti.tool.reminder': 'Crear recordatorios',
    'fronti.tool.fine': 'Registrar multas',
  };
  return labels[key] ?? key;
}

export function FrontiSettingControl({ setting }: { setting: FrontiSettingRow }) {
  const value = String(setting.value);
  const isBoolean = typeof setting.defaultValue === 'boolean';
  const isNumber = typeof setting.defaultValue === 'number';
  const longText =
    setting.key === 'fronti.welcomeMessage' || setting.key === 'fronti.extraInstructions';
  const numberMeta = NUMBER_META[setting.key];

  return (
    <div className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-petrol-900">{labelFor(setting.key)}</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{setting.description}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${
            setting.overridden
              ? 'bg-gold-100 text-gold-800'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {setting.overridden ? 'Personalizado' : 'Por defecto'}
        </span>
      </div>

      <ActionForm action={saveFrontiSettingAction} className="space-y-2">
        <input type="hidden" name="key" value={setting.key} />
        {isBoolean ? (
          <select name="value" defaultValue={value} className="input-base max-w-xs">
            <option value="true">Activado</option>
            <option value="false">Desactivado</option>
          </select>
        ) : setting.key === 'fronti.provider' ? (
          <select name="value" defaultValue={value} className="input-base max-w-xs">
            <option value="groq">Groq · Qwen hospedado</option>
            <option value="vllm">vLLM · autohospedado</option>
            <option value="openai">OpenAI · fallback</option>
          </select>
        ) : setting.key === 'fronti.reasoningEffort' ? (
          <select name="value" defaultValue={value} className="input-base max-w-xs">
            <option value="low">Bajo</option>
            <option value="medium">Medio</option>
            <option value="high">Alto</option>
          </select>
        ) : longText ? (
          <textarea
            name="value"
            defaultValue={value}
            rows={setting.key === 'fronti.extraInstructions' ? 6 : 3}
            maxLength={setting.key === 'fronti.extraInstructions' ? 4000 : 800}
            className="input-base min-h-24 w-full resize-y"
          />
        ) : (
          <div className="flex max-w-xl items-center gap-2">
            <input
              name="value"
              type={isNumber ? 'number' : 'text'}
              defaultValue={value}
              min={numberMeta?.min}
              max={numberMeta?.max}
              className="input-base"
            />
            {numberMeta?.suffix ? (
              <span className="shrink-0 text-xs text-slate-500">{numberMeta.suffix}</span>
            ) : null}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.68rem] text-slate-400">
            Por defecto: {String(setting.defaultValue)}
          </p>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Guardando…">
            Guardar
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}


export type FrontiProviderCredentialRow = {
  provider: 'groq' | 'vllm' | 'openai';
  hasStoredSecret: boolean;
  storedSecretUnreadable: boolean;
  envConfigured: boolean;
  active: boolean;
};

function providerLabel(provider: FrontiProviderCredentialRow['provider']): string {
  if (provider === 'groq') return 'Groq';
  if (provider === 'vllm') return 'vLLM';
  return 'OpenAI';
}

export function FrontiProviderCredentials({
  credentials,
}: {
  credentials: FrontiProviderCredentialRow[];
}) {
  return (
    <div className="divide-y divide-slate-100">
      {credentials.map((credential) => {
        const usableStored = credential.hasStoredSecret && !credential.storedSecretUnreadable;
        const source = usableStored
          ? 'Guardada cifrada en el Libro'
          : credential.envConfigured
            ? 'Variable de entorno'
            : credential.provider === 'vllm'
              ? 'Sin token guardado · puede ser opcional'
              : 'Sin credencial';
        return (
          <div key={credential.provider} className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-petrol-900">
                  {providerLabel(credential.provider)}
                  {credential.active ? ' · activo' : ''}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{source}</p>
                {credential.storedSecretUnreadable ? (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    Hay una credencial guardada que ya no puede descifrarse. Reemplázala.
                  </p>
                ) : null}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${
                  usableStored || credential.envConfigured
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {usableStored || credential.envConfigured ? 'Configurado' : 'Sin configurar'}
              </span>
            </div>

            <ActionForm action={saveFrontiProviderCredentialAction} className="space-y-2">
              <input type="hidden" name="provider" value={credential.provider} />
              <input
                name="apiKey"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={2000}
                required
                placeholder={usableStored ? 'Escribe una nueva credencial para reemplazarla' : 'Pegar credencial'}
                className="input-base"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[0.68rem] text-slate-400">
                  La credencial se cifra en servidor y nunca vuelve a mostrarse.
                </p>
                <SubmitButton size="sm" variant="secondary" pendingLabel="Guardando…">
                  {usableStored || credential.storedSecretUnreadable ? 'Reemplazar' : 'Guardar credencial'}
                </SubmitButton>
              </div>
            </ActionForm>

            {credential.hasStoredSecret || credential.storedSecretUnreadable ? (
              <ActionForm action={clearFrontiProviderCredentialAction} className="space-y-0">
                <input type="hidden" name="provider" value={credential.provider} />
                <SubmitButton size="sm" variant="secondary" pendingLabel="Eliminando…">
                  Quitar credencial guardada
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FrontiMaintenanceActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionForm action={async () => cleanupFrontiMemoryAction()} className="space-y-0">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Limpiando…">
          Limpiar memoria vencida
        </SubmitButton>
      </ActionForm>
      <ActionForm action={async () => resetFrontiSettingsAction()} className="space-y-0">
        <SubmitButton size="sm" variant="secondary" pendingLabel="Restableciendo…">
          Restablecer configuración
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
