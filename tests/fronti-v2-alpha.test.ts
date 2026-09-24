import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FRONTI v2 alpha', () => {
  it('centraliza las herramientas en un registro extensible', () => {
    const source = readFileSync('src/server/ai/fronti-v2/tool-registry.ts', 'utf8');
    for (const tool of [
      'consultar_estado_operativo',
      'consultar_caja',
      'consultar_llaves',
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
    expect(source).toContain('FrontiRuntimeContext');
    expect(source).toContain('permissions: [...user.permissions].sort()');
    expect(source).toContain('getMyOpenShift(user.id)');
    expect(source).toContain('pathname');
    expect(source).toContain('HOTEL_TIMEZONE');
  });

  it('permite razonamiento multi-paso antes de responder', () => {
    const route = readFileSync('src/app/api/fronti/route.ts', 'utf8');
    expect(route).toContain('Puedes encadenar varias herramientas antes de responder');
    expect(route).toContain('runtimeContextMessage(runtimeContext)');
  });
});
