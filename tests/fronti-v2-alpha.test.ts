import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FRONTI v2 alpha', () => {
  it('centraliza las herramientas en un registro extensible', () => {
    const source = readFileSync('src/server/ai/fronti-v2/tool-registry.ts', 'utf8');
    for (const tool of [
      'consultar_contexto_pantalla',
      'consultar_estado_operativo',
      'consultar_caja',
      'consultar_llaves',
      'consultar_turnos',
      'consultar_novedades',
      'consultar_garantias',
      'consultar_tareas',
      'consultar_seguimientos',
      'consultar_supervision',
      'consultar_alertas',
      'consultar_auditoria',
      'consultar_usuarios',
      'consultar_configuracion_operativa',
      'consultar_habitacion',
      'proponer_registro',
    ]) {
      expect(source).toContain(`name: '${tool}'`);
    }
    expect(source).toContain("mode: 'read'");
    expect(source).toContain("mode: 'propose'");
  });

  it('inyecta contexto estructurado de usuario, turno, pantalla y reloj', () => {
    const source = readFileSync('src/server/ai/fronti-v2/context-builder.ts', 'utf8');
    const pageContext = readFileSync('src/server/ai/fronti-v2/page-context.ts', 'utf8');
    expect(source).toContain('FrontiRuntimeContext');
    expect(source).toContain('permissions: [...user.permissions].sort()');
    expect(source).toContain('getMyOpenShift(user.id)');
    expect(source).toContain('resolveFrontiPageContext');
    expect(source).toContain('HOTEL_TIMEZONE');
    expect(pageContext).toContain('pathname: string');
    expect(pageContext).toContain('filters: Record<string, string>');
    expect(pageContext).toContain('recommendedTools: string[]');
  });

  it('mantiene lectura transversal determinística y sin SQL generado por el modelo', () => {
    const source = readFileSync('src/server/ai/fronti-v2/read-tools.ts', 'utf8');
    for (const service of [
      'getShiftDesk',
      'listOpenGuarantees',
      'getSupervisionData',
      'getSupervisionCenterSummary',
      'listOperationalUsers',
      'getAllSettings',
    ]) {
      expect(source).toContain(service);
    }
    expect(source).toContain('followUpReadWhere(user)');
    expect(source).toContain('taskFollowUpReadWhere(user)');
    expect(source).not.toContain('$queryRaw');
    expect(source).not.toContain('$executeRaw');
  });

  it('conecta el contexto vivo de pantalla con el loop de herramientas', () => {
    const assistant = readFileSync('src/server/ai/reception-assistant.ts', 'utf8');
    const route = readFileSync('src/app/api/fronti/route.ts', 'utf8');
    const client = readFileSync('src/components/layout/fronti-assistant.tsx', 'utf8');

    expect(assistant).toContain("case 'consultar_contexto_pantalla'");
    expect(assistant).toContain('executeFrontiPageContextTool');
    expect(assistant).toContain('frontiToolMode(name)');
    expect(route).toContain('search: body.pageContext.search');
    expect(route).toContain('runReceptionAssistant(user, modelMessages, runtimeContext)');
    expect(client).toContain('search: window.location.search');
    expect(client).toContain('hash: window.location.hash');
    expect(client).toContain('title: document.title');
  });

  it('mantiene Fronti disponible para Administrador de sistema aunque el switch global se apague', () => {
    const source = readFileSync('src/server/ai/reception-assistant.ts', 'utf8');
    expect(source).toContain('!config.enabled && !user.isSystemAdmin');
  });

  it('permite razonamiento multi-paso antes de responder', () => {
    const route = readFileSync('src/app/api/fronti/route.ts', 'utf8');
    expect(route).toContain('Puedes encadenar varias herramientas antes de responder');
    expect(route).toContain('runtimeContextMessage(runtimeContext)');
  });
});
