// Isolated renderer regression. No server, network, database, or browser QA.
// Reuses the optional temporary QA dependency; never install it in the app:
// JSDOM_MODULE=/tmp/aroh-hydration-dom/node_modules/jsdom node scripts/ui/shift-start-navigation-repro.cjs
// SOURCE_ROOT can point to the unmodified candidate; the same success assertion fails there.
process.env.NODE_ENV = 'production';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(process.env.SOURCE_ROOT || path.join(__dirname, '../..'));
const ts = require(path.join(repo, 'node_modules/typescript'));
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000/turno', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'MutationObserver', 'FormData', 'CustomEvent']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const runtime = name => require(path.join(repo, 'node_modules/next/dist/compiled', name));
const React = runtime('react');
const { createRoot } = runtime('react-dom/client');
const { flushSync } = runtime('react-dom');
const h = React.createElement;
const navigations = [];
const router = { push(href) { navigations.push(href); }, refresh() { throw new Error('Unexpected refresh'); } };
let action;
const modules = {};
function compile(relative) {
  if (modules[relative]) return modules[relative];
  const filename = path.join(repo, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const localRequire = name => {
    if (['react', 'react-dom', 'react/jsx-runtime'].includes(name)) return runtime(name);
    if (name === 'next/navigation') return { useRouter: () => router };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@/lib/cn') return { cn: (...parts) => parts.filter(Boolean).join(' ') };
    if (name === '@/server/actions/shifts') return new Proxy({}, { get: () => (...args) => action(...args) });
    if (name === '@/domain/shift') return { SHIFT_WINDOW_LABEL: { DIA: 'Día', NOCHE: 'Noche' } };
    const allowed = {
      '@/components/ui/form': 'src/components/ui/form.tsx',
      '@/components/ui/button': 'src/components/ui/button.tsx',
      '@/components/operational/shift-start-navigation': 'src/components/operational/shift-start-navigation.ts',
      './shift-action-dialog': 'src/components/operational/shift-action-dialog.tsx',
      '@/components/ui/dialog': 'src/components/ui/dialog.tsx',
      '@/lib/body-scroll-lock': 'src/lib/body-scroll-lock.ts',
      './form': 'src/components/ui/form.tsx',
      './button': 'src/components/ui/button.tsx',
    };
    if (allowed[name]) return compile(allowed[name]);
    throw new Error('Unexpected import ' + name);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return modules[relative] = module.exports;
}
const forms = compile('src/components/operational/shift-actions.tsx');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let step = 0; step < 50; step++) { if (check()) return; await wait(10); }
  assert.ok(check(), 'Renderer condition did not settle');
}
(async () => {
  const results = [];
  for (const name of ['PrepareHandoverForm', 'StartReceptionShiftForm']) {
    for (const scenario of ['unmount-before-result', 'rejected', 'double-submit', 'new-link-before-url', 'new-route']) {
      window.history.replaceState(null, '', '/turno'); navigations.length = 0;
      let actionCalls = 0, resolveAction;
      const response = new Promise(resolve => { resolveAction = resolve; });
      action = async () => { actionCalls++; return response; };
      const props = name === 'PrepareHandoverForm' ? { shiftId: 'synthetic' } : { handoverId: 'synthetic', suggestedType: 'DIA' };
      const container = document.createElement('section'); document.body.append(container);
      const root = createRoot(container);
      function Shell({ active }) {
        return h('div', null, h('textarea', { id: 'shell-draft', defaultValue: 'Borrador sin enviar' }), active ? h(forms[name], props) : h('p', null, 'Continuar con el turno'));
      }
      flushSync(() => root.render(h(Shell, { active: true })));
      const draft = container.querySelector('#shell-draft');
      const form = container.querySelector('form'), submit = form.querySelector('button[type="submit"]');
      form.requestSubmit(submit);
      if (scenario === 'double-submit') form.requestSubmit(submit);
      await until(() => actionCalls === 1);
      if (scenario === 'unmount-before-result') flushSync(() => root.render(h(Shell, { active: false })));
      if (scenario === 'new-link-before-url') {
        const link = document.createElement('a'); link.href = '/coordinacion';
        link.addEventListener('click', event => event.preventDefault()); document.body.append(link); link.click(); link.remove();
      }
      if (scenario === 'new-route') window.history.pushState(null, '', '/coordinacion');
      resolveAction(scenario === 'rejected' ? { ok: false, error: 'Cambio simultáneo: vuelve a revisar.' } : { ok: true, id: 'synthetic-handover', message: 'Preparado' });
      await wait(100);
      if (scenario === 'rejected') assert.equal(container.querySelector('[role="alert"]')?.textContent, 'Cambio simultáneo: vuelve a revisar.');
      const shouldAdvance = ['unmount-before-result', 'double-submit'].includes(scenario);
      assert.equal(navigations.length, shouldAdvance ? 1 : 0, name + ' / ' + scenario);
      assert.equal(actionCalls, 1, 'One server call per start');
      if (shouldAdvance) assert.equal(navigations[0], '/turno/entrega/synthetic-handover' + (name === 'PrepareHandoverForm' ? '?paso=1' : ''));
      assert.equal(container.querySelector('#shell-draft'), draft, 'Shell sibling remains mounted');
      assert.equal(draft.value, 'Borrador sin enviar');
      results.push({ form: name, scenario, actionCalls, navigations: [...navigations], draftSentinelPreserved: true });
      root.unmount(); container.remove();
    }
  }
  console.log(JSON.stringify({ scope: 'Real bundled renderer, synthetic action result and modeled revalidation unmount. Router mocked. Not browser/RSC/Fronti integration.', reactVersion: React.version, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
