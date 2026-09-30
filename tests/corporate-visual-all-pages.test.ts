import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

describe('acoplamiento visual transversal AROH', () => {
  const authenticatedPages = walk('src/app/(app)').filter((path) => path.endsWith('/page.tsx'));

  it('cubre todas las pantallas autenticadas bajo el shell corporativo', () => {
    expect(authenticatedPages.length).toBeGreaterThan(20);

    for (const path of authenticatedPages) {
      const source = readFileSync(path, 'utf8');

      // Ninguna pantalla autenticada debe recrear el shell visual anterior.
      expect(source, path).not.toMatch(/min-h-screen[^"'\n]*bg-slate-100/);
      expect(source, path).not.toContain('bg-white/95 backdrop-blur');
    }
  });

  it('mantiene las pantallas autónomas de acceso dentro del mismo lenguaje visual', () => {
    const files = [
      'src/app/login/page.tsx',
      'src/app/instalacion/page.tsx',
      'src/app/cambiar-contrasena/page.tsx',
      'src/app/aceptar-terminos/page.tsx',
      'src/app/sin-permisos/page.tsx',
    ];

    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toMatch(/bg-(?:petrol-950|\[#f3f6f8\])/);
      expect(source, path).toContain('border-t-gold-500');
    }
  });

  it('alinea las superficies globales que aparecen encima de cualquier pantalla', () => {
    const surfaces = [
      'src/components/ui/dialog.tsx',
      'src/components/layout/help-center.tsx',
      'src/components/layout/fronti-assistant.tsx',
      'src/components/layout/chat-widget.tsx',
      'src/components/layout/notification-center.tsx',
      'src/components/layout/support-request-panel.tsx',
      'src/components/layout/tutorial.tsx',
      'src/components/operational/reception-operation-gate.tsx',
      'src/components/operational/shift-actions.tsx',
      'src/components/operational/announcement-gate.tsx',
      'src/components/operational/operational-alarm-form.tsx',
    ];

    for (const path of surfaces) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toContain('rounded-3xl');
      expect(source, path).not.toContain('rounded-2xl');
    }
  });
});
