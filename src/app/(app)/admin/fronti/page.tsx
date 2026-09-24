import Link from 'next/link';
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Database,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { getAllSettings } from '@/server/services/settings';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import {
  getFrontiProviderCredentialView,
  providerIsConfigured,
  resolveFrontiProviderRuntime,
} from '@/server/ai/fronti-provider';
import { Card, CardHeader, CardScroll, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import type { RawSearchParams } from '@/lib/search-params';
import { ROLE_KEYS } from '@/lib/permissions';
import {
  FrontiMaintenanceActions,
  FrontiProviderCredentials,
  FrontiSettingControl,
  FrontiUserAccessList,
  type FrontiProviderCredentialRow,
  type FrontiSettingRow,
  type FrontiUserAccessRow,
} from './fronti-settings';

export const metadata = { title: 'Fronti · Administración' };
export const dynamic = 'force-dynamic';

type CountRow = { count: bigint };

const GROUPS = [
  {
    id: 'general',
    title: 'General',
    description: 'Disponibilidad, identidad y comportamiento visible de Fronti.',
    icon: Sparkles,
    keys: [
      'fronti.enabled',
      'fronti.displayName',
      'fronti.welcomeMessage',
      'fronti.extraInstructions',
    ],
  },
  {
    id: 'modelo',
    title: 'Modelo',
    description: 'Proveedor, modelo y preferencia de razonamiento. Las credenciales nunca se muestran aquí.',
    icon: Brain,
    keys: ['fronti.provider', 'fronti.model', 'fronti.reasoningEffort'],
  },
  {
    id: 'memoria',
    title: 'Memoria',
    description: 'Retención, memoria temporal del turno y cantidad de contexto recuperado.',
    icon: Database,
    keys: [
      'fronti.memoryRetentionDays',
      'fronti.shiftMemoryHours',
      'fronti.memoryContextLimit',
      'fronti.modelHistoryLimit',
    ],
  },
  {
    id: 'sesion',
    title: 'Sesión',
    description: 'Actividad reciente que permite mantener la sesión viva mientras el recepcionista usa el Libro.',
    icon: Settings2,
    keys: ['fronti.sessionActivityMinutes'],
  },
  {
    id: 'capacidades',
    title: 'Capacidades',
    description: 'Define qué herramientas operativas se ofrecen a Fronti. Los permisos del usuario siguen aplicándose siempre.',
    icon: Wrench,
    keys: [
      'fronti.tool.room',
      'fronti.tool.priorities',
      'fronti.tool.deadlines',
      'fronti.tool.checkout',
      'fronti.tool.reminder',
      'fronti.tool.fine',
    ],
  },
] as const;

function byKey(settings: FrontiSettingRow[]) {
  return new Map(settings.map((setting) => [setting.key, setting]));
}

async function diagnostics() {
  const [memoryRows, messageRows, conversationRows] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS count FROM ai_memory WHERE expires_at > NOW()`,
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS count FROM ai_message WHERE expires_at > NOW()`,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
        FROM ai_conversation
       WHERE closed_at IS NULL AND expires_at > NOW()
    `,
  ]);
  return {
    memories: Number(memoryRows[0]?.count ?? 0n),
    messages: Number(messageRows[0]?.count ?? 0n),
    conversations: Number(conversationRows[0]?.count ?? 0n),
  };
}

export default async function FrontiAdminPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('system.configure');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const grupo = typeof params.grupo === 'string' ? params.grupo : '';

  const [
    allSettings,
    config,
    counts,
    groqCredential,
    vllmCredential,
    openaiCredential,
    accessUsers,
  ] = await Promise.all([
    getAllSettings(),
    getFrontiConfig(),
    diagnostics(),
    getFrontiProviderCredentialView('groq'),
    getFrontiProviderCredentialView('vllm'),
    getFrontiProviderCredentialView('openai'),
    prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        username: true,
        active: true,
        frontiAccessEnabled: true,
        role: { select: { key: true, name: true, level: true } },
      },
      orderBy: [{ role: { level: 'desc' } }, { name: 'asc' }],
    }),
  ]);
  const settings = allSettings
    .filter((setting) => setting.key.startsWith('fronti.'))
    .map((setting) => ({
      key: setting.key,
      value: setting.value,
      defaultValue: setting.defaultValue,
      description: setting.description,
      overridden: setting.overridden,
    })) satisfies FrontiSettingRow[];
  const settingsByKey = byKey(settings);
  const activeTools = Object.values(config.tools).filter(Boolean).length;
  const provider = await resolveFrontiProviderRuntime(config);
  const providerConfigured = providerIsConfigured(provider);
  const credentials = [
    { provider: 'groq', ...groqCredential, active: config.provider === 'groq' },
    { provider: 'vllm', ...vllmCredential, active: config.provider === 'vllm' },
    { provider: 'openai', ...openaiCredential, active: config.provider === 'openai' },
  ] satisfies FrontiProviderCredentialRow[];

  const userAccess = accessUsers.map((user) => ({
    id: user.id,
    name: user.name,
    username: user.username,
    roleName: user.role.name,
    active: user.active,
    enabled:
      user.role.key === ROLE_KEYS.SYSTEM_ADMIN ? true : user.frontiAccessEnabled,
    alwaysEnabled: user.role.key === ROLE_KEYS.SYSTEM_ADMIN,
  })) satisfies FrontiUserAccessRow[];

  const visibleGroups = GROUPS
    .filter((group) => !grupo || group.id === grupo)
    .map((group) => {
      const rows = group.keys
        .map((key) => settingsByKey.get(key))
        .filter((row): row is FrontiSettingRow => Boolean(row))
        .filter((row) => {
          if (!q) return true;
          return [row.key, row.description, row.value, row.defaultValue, group.title, group.description]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q);
        });
      return { group, rows };
    })
    .filter(({ group, rows }) =>
      rows.length > 0 ||
      (!q && (!grupo || group.id === grupo)),
    );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-petrol-900 text-gold-400">
              <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-petrol-900">Fronti</h1>
              <p className="text-sm text-slate-600">Consola del asistente operativo de Recepción.</p>
            </div>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            config.enabled
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
              : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
          }`}
        >
          {config.enabled ? 'Activo' : 'Desactivado'}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Memorias vigentes" value={counts.memories} />
        <StatTile label="Mensajes retenidos" value={counts.messages} />
        <StatTile label="Conversaciones activas" value={counts.conversations} />
        <StatTile label="Capacidades activas" value={`${activeTools}/6`} />
      </div>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar ajuste, clave o descripción…"
        clearHref="/admin/fronti"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Grupo</span>
          <select name="grupo" defaultValue={grupo} className="input-base w-full">
            <option value="">Todos</option>
            {GROUPS.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
          </select>
        </label>
      </ListFilterBar>

      <Card>
        <CardHeader title="Diagnóstico" />
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Proveedor de IA</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-petrol-900">
              <CheckCircle2
                className={`h-4 w-4 ${providerConfigured ? 'text-emerald-600' : 'text-amber-600'}`}
                aria-hidden="true"
              />
              {config.provider === 'groq'
                ? 'Groq'
                : config.provider === 'vllm'
                  ? 'vLLM'
                  : 'OpenAI fallback'}
              {providerConfigured ? ' · configurado' : ' · sin configurar'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Modelo actual</p>
            <p className="mt-1 break-all text-sm font-semibold text-petrol-900">{config.model}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Memoria personal</p>
            <p className="mt-1 text-sm font-semibold text-petrol-900">{config.memoryRetentionDays} días</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Zona horaria</p>
            <p className="mt-1 text-sm font-semibold text-petrol-900">{env().HOTEL_TIMEZONE}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Acceso por usuario" count={userAccess.length} />
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-600">
            Fronti se habilita de forma gradual por cuenta. El Administrador de sistema permanece
            siempre activo; el resto sólo puede usar Fronti cuando esté habilitado aquí.
          </p>
        </div>
        <FrontiUserAccessList users={userAccess} />
      </Card>

      <Card>
        <CardHeader title="Credenciales de proveedores" />
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-600">
            Puedes administrar las credenciales sin volver a desplegar. Una credencial guardada aquí
            se cifra con la llave del servidor y tiene prioridad sobre la variable de entorno del
            mismo proveedor. El valor nunca se vuelve a mostrar.
          </p>
        </div>
        <FrontiProviderCredentials credentials={credentials} />
      </Card>

      <Card>
        <CardHeader title="Seguridad obligatoria" />
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-3">
          {[
            ['Permisos del usuario', 'Fronti nunca obtiene más permisos que la cuenta que lo usa.'],
            ['Confirmación de acciones', 'Check-out, multas y otras escrituras sensibles requieren confirmación.'],
            ['Auditoría', 'Las acciones se ejecutan por los servicios del Libro y quedan atribuidas al usuario real.'],
          ].map(([title, description]) => (
            <div key={title} className="rounded-lg bg-petrol-50 p-3 ring-1 ring-petrol-100">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-petrol-900">
                <ShieldCheck className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                {title}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
            </div>
          ))}
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Estos controles no tienen interruptor: forman parte del contrato de seguridad del Libro.
        </p>
      </Card>

      {visibleGroups.map(({ group, rows }) => {
        const Icon = group.icon;
        return (
          <Card key={group.id} className="overflow-hidden">
            <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-petrol-50 text-petrol-700">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold text-petrol-900">{group.title}</h2>
                <p className="text-xs leading-5 text-slate-600">{group.description}</p>
              </div>
            </div>
            <CardScroll maxHeight="max-h-[28rem]">
              <div className="divide-y divide-slate-100">
                {rows.map((setting) => (
                  <FrontiSettingControl key={setting.key} setting={setting} />
                ))}
              </div>
            </CardScroll>
          </Card>
        );
      })}

      <Card>
        <CardHeader title="Mantenimiento de Fronti" />
        <div className="space-y-3 px-4 py-4">
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            La limpieza elimina únicamente conversaciones, mensajes y recuerdos que ya vencieron. El restablecimiento elimina las personalizaciones de Fronti y recupera los valores seguros incluidos en el código.
          </p>
          <FrontiMaintenanceActions />
        </div>
      </Card>
    </div>
  );
}
