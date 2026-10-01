import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FrontiConfig } from '@/server/ai/fronti-config';
import { ROLE_KEYS, ROLE_PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import {
  enabledFrontiToolDefinitions,
  filterFrontiToolDefinitionsForUser,
  selectFrontiToolDefinitions,
} from '@/server/ai/fronti-v2/tool-registry';

const config: FrontiConfig = {
  enabled: true,
  provider: 'groq',
  displayName: 'Fronti',
  welcomeMessage: 'Hola',
  extraInstructions: '',
  model: 'openai/gpt-oss-120b',
  reasoningEffort: 'low',
  memoryRetentionDays: 30,
  shiftMemoryHours: 36,
  memoryContextLimit: 12,
  modelHistoryLimit: 15,
  sessionActivityMinutes: 15,
  tools: {
    room: true,
    priorities: true,
    deadlines: true,
    checkout: true,
    reminder: true,
    fine: true,
  },
};

describe('FRONTI alpha.5 · capacidad y presupuesto', () => {
  it('acota una consulta específica a Caja, garantías y novedades', () => {
    const names = selectFrontiToolDefinitions(
      config,
      'Ahora revisa Caja, garantías y novedades y dime si ves alguna incoherencia.',
    ).map((tool) => tool.name);

    expect(new Set(names)).toEqual(
      new Set(['consultar_caja', 'consultar_garantias', 'consultar_novedades']),
    );
  });

  it('mantiene lectura transversal para una consulta amplia', () => {
    const names = selectFrontiToolDefinitions(
      config,
      '¿Qué está pasando hoy? Revísalo en todo el Libro.',
    ).map((tool) => tool.name);

    expect(names).toContain('consultar_estado_operativo');
    expect(names).toContain('consultar_turnos');
    expect(names).toContain('consultar_novedades');
    expect(names).toContain('consultar_garantias');
    expect(names).not.toContain('proponer_registro');
    expect(names).not.toContain('proponer_checkouts');
  });

  it('no expone herramientas que excedan los permisos del usuario que invoca a Fronti', () => {
    const names = filterFrontiToolDefinitionsForUser(
      {
        isSystemAdmin: false,
        permissions: ['room.view', 'task.create'] as PermissionKey[],
      },
      enabledFrontiToolDefinitions(config),
    ).map((tool) => tool.name);

    expect(names).toContain('consultar_habitacion');
    expect(names).toContain('proponer_recordatorio');
    expect(names).toContain('consultar_estado_operativo');
    expect(names).not.toContain('consultar_caja');
    expect(names).not.toContain('consultar_auditoria');
    expect(names).not.toContain('consultar_configuracion_operativa');
    expect(names).not.toContain('proponer_multa');
  });

  it('el Administrador opera con permisos y no evita una revocación explícita', () => {
    const enabled = enabledFrontiToolDefinitions(config);
    const visible = filterFrontiToolDefinitionsForUser(
      {
        isSystemAdmin: true,
        permissions: ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN],
      },
      enabled,
    ).map((tool) => tool.name);

    expect(visible).toContain('consultar_configuracion_operativa');
    expect(visible).toContain('consultar_auditoria');
    expect(visible).toContain('proponer_checkouts');
    const restricted = filterFrontiToolDefinitionsForUser({ isSystemAdmin: true, permissions: ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN].filter((permission) => permission !== 'room.manage') }, enabled).map((tool) => tool.name);
    expect(restricted).not.toContain('proponer_checkouts');
  });

  it('usa Groq -> Cloudflare -> Groq y limita salida', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');
    expect(source).toContain("GROQ_PRIMARY_MODEL = 'openai/gpt-oss-120b'");
    expect(source).toContain("CLOUDFLARE_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash'");
    expect(source).toContain("GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b'");
    expect(source).toContain('MAX_MODEL_OUTPUT_TOKENS = 1_800');
    expect(source).toContain('max_completion_tokens: MAX_MODEL_OUTPUT_TOKENS');
  });
});
