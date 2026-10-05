import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/ui/shift-ux-browser.mjs', 'utf8');
const surfaces = readFileSync('scripts/etapa4/surfaces-browser.mjs', 'utf8');

describe('escenas reales de UI de Turnos en la compuerta existente', () => {
  it('reutiliza guard, navegador y evidencia existentes sin crear infraestructura', () => {
    expect(source).toContain("import '../etapa1/guard.cjs'");
    expect(surfaces).toContain('await exerciseShiftUx({ browser, db, results })');
    expect(surfaces).toContain("writeFileSync('etapa4-surfaces-browser-results.json'");
    expect(source).not.toContain('route.fulfill');
    expect(source).not.toContain('page.route');
    expect(source).not.toContain('writeFileSync');
    expect(source).toContain("url.hostname !== 'localhost'");
    expect(source).toContain('process.env.SMTP_HOST');
    expect(source).toContain('db.mailSettings.count()');
  });

  it('comprueba respuesta nativa, pending real y reintento explícito de las cuatro variantes', () => {
    for (const key of ['cancel', 'send', 'close', 'guided']) expect(source).toContain(`specs.${key}`);
    expect(source).toContain('LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE');
    expect(source).toMatch(/finally\s*\{\s*unlock\(\);/);
    expect(source).toContain('if (!workFailed) throw lockError;');
    expect(source).toContain('La operación ya está en curso.');
    expect(source).toContain("window.addEventListener('aroh:action-result'");
    expect(source).toContain('receipt.formId === formId');
    expect(source).toContain('receipts[0].ok, expectedOk');
    expect(source).not.toContain('response.text()');
    expect(source).toContain("getByRole('alert')");
    expect(source).toContain('.dblclick()');
    expect(source).toContain("action: 'TURNO_CERRAR'");
    expect(source).toContain("action: 'TURNO_ENTREGAR'");
  });

  it('la fixture de retorno mantiene membresía de página determinística', () => {
    const list = readFileSync('scripts/ui/list-context-browser.mjs', 'utf8');
    expect(list).toContain('const fixtureEpoch = Date.now()');
    expect(list).toContain('createdAt: new Date(fixtureEpoch - index * 1000)');
  });

  it('mide la custodia actualizada sólo después de su navegación documental', () => {
    const custody = readFileSync('scripts/etapa3/block2-browser.mjs', 'utf8');
    expect(custody).toContain("Promise.all([page.waitForEvent('load'),dialog.getByRole('button',{name:'Cerrar custodia'}).click()])");
    expect(custody).toContain("await article.getByText('Entregado',{exact:true}).waitFor()");
    expect(custody).not.toContain("page.waitForLoadState(");
    expect(custody.indexOf("await article.getByText('Entregado'")).toBeLessThan(custody.indexOf("const final=await db.lostFoundItem"));
    expect(custody).toContain("assert.equal(final.status,'ENTREGADO')");
    expect(custody).toContain("assert.equal(await db.lostFoundEvent.count({where:{itemId:row.id}}),3)");
  });

  it('exige avance automático, nueva intención respetada y borrador Fronti sin enviar', () => {
    expect(source).toContain("mark('prepare-auto-navigation')");
    expect(source).toContain("mark('reception-auto-navigation')");
    expect(source).toContain("mark('new-navigation-supersedes-late-result')");
    expect(source).toContain("performance.timeOrigin");
    expect(source).toContain("frontiPosts, []");
    expect(source).toContain('noManualContinueFallback: true');
    expect(source).not.toContain("name: 'Continuar cierre");
    expect(source).not.toContain("name: 'CONTINUAR RECEPCIÓN");
  });
});
