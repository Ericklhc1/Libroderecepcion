import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/ui/audit-cash-drafts-e2e.mjs', 'utf8');

describe('contrato del recorrido auténtico F15, pendiente de ejecución en CI', () => {
  it('conserva fixture loopback, permisos reales, recibo nativo y bloqueo de salidas', () => {
    expect(source).toContain("import '../etapa1/guard.cjs'");
    expect(source).toContain('scripts/etapa1/fixture.mts');
    expect(source).toContain('waitForNativeShiftReceipt(page,attempt,true)');
    expect(source).toContain("u.hostname!=='localhost'");
    expect(source).toContain('process.env.SMTP_HOST');
    expect(source).toContain('db.mailSettings.count()');
    expect(source).not.toContain('route.fulfill');
    expect(source).not.toContain('dispatchEvent');
    expect(source).not.toContain('next build');
    expect(source).not.toContain('next dev');
  });

  it('comprueba cantidades, checks y notas entre entregas y actores en ambos tamaños', () => {
    expect(source).toContain('[1280,390]');
    expect(source).toContain('page.goto(otherUrl)');
    expect(source).toContain('page.goBack()');
    expect(source).toContain('page.goForward()');
    expect(source).toContain('value:f.users.worker.token');
    expect(source).toContain('Another actor must not recover the first actor draft');
    expect(source).toContain('Another handover must not inherit the note');
    expect(source).toContain('A draft must not restore an unsent physical validation');
  });

  it('mantiene la revisión original tras editar y exige limpieza antes de recargar', () => {
    expect(source).toContain('originalRevision');
    expect(source).toContain('Editing does not acknowledge a newer saved revision');
    expect(source).toContain('staleWarningSurvivesEditAndReload:true');
    expect(source).toContain('sessionStorage.getItem(key)===null,cashDraftKey');
    expect(source).toContain('sessionStorage.getItem(key)===null,noteDraftKey');
    expect(source).toContain("sessionStorage.getItem('synthetic-unrelated-preference')),'keep'");
  });
});
