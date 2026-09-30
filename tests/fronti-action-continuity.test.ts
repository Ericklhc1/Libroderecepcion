import { describe, expect, it } from 'vitest';
import type { FrontiConfig } from '@/server/ai/fronti-config';
import type { PermissionKey } from '@/lib/permissions';
import { buildFrontiToolIntent } from '@/server/ai/fronti-v2/action-intent';
import { filterFrontiToolDefinitionsForUser, selectFrontiToolDefinitions, FRONTI_TOOL_REGISTRY } from '@/server/ai/fronti-v2/tool-registry';
import { parseFrontiDueAt } from '@/domain/fronti-due-date';

const config: FrontiConfig = {
  enabled: true, provider: 'groq', displayName: 'Fronti', welcomeMessage: 'Hola', extraInstructions: '',
  model: 'openai/gpt-oss-120b', reasoningEffort: 'low', memoryRetentionDays: 30, shiftMemoryHours: 36,
  memoryContextLimit: 12, modelHistoryLimit: 15, sessionActivityMinutes: 15,
  tools: { room: true, priorities: true, deadlines: true, checkout: true, reminder: true, fine: true },
};
const now = new Date('2026-09-30T21:40:00.000Z');
const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({ role: 'assistant' as const, content });

describe('Fronti · continuidad de una acción', () => {
  it('conserva proponer_registro cuando el usuario responde sólo con los campos', () => {
    const intent = buildFrontiToolIntent([
      user('Crea una novedad'), assistant('¿Qué ocurrió?'),
      user('Título: Pago faltante hab 514\nResponsable: área recepción.\nPrioridad: Crítica\nHabitación: 514\nVencimiento: vence hoy a las 21:00'),
    ]);
    expect(selectFrontiToolDefinitions(config, intent).map((tool) => tool.name)).toContain('proponer_registro');
  });
  it('conserva una solicitud al responder varios datos por separado', () => {
    const intent = buildFrontiToolIntent([user('Registra una incidencia'), user('Pago faltante'), user('514'), user('Alta'), user('Recepción'), user('hoy a las 21:00')]);
    expect(intent).toContain('Registra una incidencia');
    expect(selectFrontiToolDefinitions(config, intent).map((tool) => tool.name)).toContain('proponer_registro');
  });
  it('una pregunta nueva no arrastra una orden anterior', () => {
    const intent = buildFrontiToolIntent([user('Crea una novedad'), user('¿Qué hay en Caja?')]);
    expect(intent).toBe('¿Qué hay en Caja?');
  });
  it('cancela la continuidad y no la revive con un sí posterior', () => {
    expect(buildFrontiToolIntent([user('Crea una novedad'), user('Cancela'), user('Sí')])).toBe('Sí');
  });
  it('no usa órdenes escritas por el modelo ni por la memoria', () => {
    expect(buildFrontiToolIntent([assistant('Crea una novedad'), user('Prioridad crítica')])).toBe('Prioridad crítica');
  });
  it('los permisos siguen filtrando las propuestas heredadas', () => {
    const selected = selectFrontiToolDefinitions(config, buildFrontiToolIntent([user('Crea una novedad'), user('Crítica')]));
    expect(filterFrontiToolDefinitionsForUser({ isSystemAdmin: false, permissions: ['cash.view'] as PermissionKey[] }, selected).map((tool) => tool.name)).not.toContain('proponer_registro');
  });
  it('la continuidad no reactiva capacidades deshabilitadas', () => {
    const disabled = { ...config, tools: { ...config.tools, reminder: false } };
    const selected = selectFrontiToolDefinitions(disabled, buildFrontiToolIntent([user('Crea un recordatorio'), user('mañana a las 09:00')]));
    expect(selected.map((tool) => tool.name)).not.toContain('proponer_recordatorio');
  });
  it('el contrato de novedad expone responsable y vencimiento sin exigir formato técnico', () => {
    const tool = FRONTI_TOOL_REGISTRY.find((item) => item.name === 'proponer_registro')!;
    const properties = tool.parameters.properties as Record<string, unknown>;
    expect(properties).toHaveProperty('responsible');
    expect(properties).toHaveProperty('dueAt');
    expect(tool.parameters.required).toEqual(expect.arrayContaining(['responsible', 'dueAt']));
  });
  it('selecciona completar tareas por referencia global #', () => {
    expect(selectFrontiToolDefinitions(config, 'Completa #7123').map((tool) => tool.name)).toContain('proponer_resolver_tarea');
  });
});

describe('Fronti · vencimientos naturales', () => {
  it.each(['hoy a las 21:00', 'vence hoy a las 21:00', '21:00', '30/09/2026 21:00', '2026-09-30T21:00'])('interpreta %s en Chile', (value) => {
    expect(parseFrontiDueAt(value, now)?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('respeta mañana aunque el servidor ya cambió de día', () => {
    expect(parseFrontiDueAt('mañana a las 09:00', new Date('2026-10-01T01:30:00Z'))?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });
  it('respeta UTC-4 en invierno sin fijar un offset', () => {
    expect(parseFrontiDueAt('hoy a las 21:00', new Date('2026-07-01T18:00:00Z'))?.toISOString()).toBe('2026-07-02T01:00:00.000Z');
  });
  it('conserva ISO absoluto', () => {
    expect(parseFrontiDueAt('2026-09-30T21:00:00-03:00', now)?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('acepta intervalos y fechas de calendario', () => {
    expect(parseFrontiDueAt('en 2 horas', now)?.toISOString()).toBe('2026-09-30T23:40:00.000Z');
    expect(parseFrontiDueAt('en 2 días a las 09:00', now)?.toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });
  it.each(['mañana', 'por la tarde', '2026-02-31T10:00', 'hoy a las 25:00', '31/02/2026 10:00'])('no inventa ni normaliza silenciosamente %s', (value) => {
    expect(() => parseFrontiDueAt(value, now)).toThrow('día y la hora');
  });
  it('no convierte un vencimiento opcional en requisito', () => {
    expect(parseFrontiDueAt(null, now)).toBeNull();
  });
});
