/*
 * Isolated client regression: real Next-bundled React renderer + jsdom.
 * No browser, server, network or database. All action results are synthetic.
 * Usage: AROH_JSDOM_MODULE=/path/to/jsdom node scripts/ui/form-draft-repro.mjs [repo] [--baseline]
 * jsdom is supplied by the isolated QA environment, not an app dependency.
 */
process.env.NODE_ENV = 'production';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const requireHere = createRequire(import.meta.url);
const repo = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || process.cwd());
const baseline = process.argv.includes('--baseline');
const requireRepo = createRequire(path.join(repo, 'package.json'));
const ts = requireRepo('typescript');
const { JSDOM } = requireHere(process.env.AROH_JSDOM_MODULE || 'jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000/turno', pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'MutationObserver', 'FormData', 'CustomEvent', 'Event', 'sessionStorage']) {
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.fetch = () => { throw new Error('Network access is outside this isolated test'); };
const runtime = name => requireRepo(`next/dist/compiled/${name}`);
const React = runtime('react');
const { createRoot } = runtime('react-dom/client');
const { flushSync } = runtime('react-dom');
const h = React.createElement;
const navigation = [];
const router = { push: href => navigation.push(['push', href]), refresh: () => navigation.push(['refresh']) };
let actionImpl;
let calls = [];
const actions = new Proxy({}, { get: (_target, name) => async (previous, data) => {
  calls.push({ name, previous, data: Object.fromEntries(data) });
  return actionImpl(previous, data);
} });
const modules = {};
function compile(relative) {
  if (modules[relative]) return modules[relative];
  const filename = path.join(repo, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = name => {
    if (['react', 'react-dom', 'react/jsx-runtime'].includes(name)) return runtime(name);
    if (name === 'next/navigation') return { useRouter: () => router };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name.startsWith('@/server/actions/')) return actions;
    if (name === '@/domain/shift') return { SHIFT_EMERGENCY_REASON_KEYS: ['EXCEPTION'], SHIFT_EMERGENCY_REASON_LABEL: { EXCEPTION: 'Motivo sintético' }, SHIFT_WINDOW_LABEL: { DIA: 'Día', NOCHE: 'Noche' } };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const local = name.startsWith('@/') ? 'src/' + name.slice(2) : path.join(path.dirname(relative), name);
      const resolved = ['.tsx', '.ts', ''].map(ext => local + ext).find(file => fs.existsSync(path.join(repo, file)));
      if (!resolved) throw new Error('Missing local source ' + name);
      return compile(resolved);
    }
    return requireRepo(name);
  };
  new Function('require', 'module', 'exports', output)(localRequire, compiledModule, compiledModule.exports);
  return modules[relative] = compiledModule.exports;
}
const { ActionForm } = compile('src/components/ui/form.tsx');
const { AddHandoverNoteForm } = compile('src/components/operational/handover-notes.tsx');
const { CashBox } = compile('src/components/operational/cash-box.tsx');
const { FormDraftSession } = compile('src/components/operational/form-draft-session.tsx');
const { encodeFormDraft, formDraftRevision } = compile('src/domain/form-draft.ts');
const wait = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const activeViews = new Set();
const errors = [];
const draftKey = scope => 'aroh:form-draft:v1:' + scope;
const control = value => ({ value, checked: false, selected: null });
function saveDraft(scope, revision, fields = { notes: 'Trabajo pendiente' }) {
  sessionStorage.setItem(draftKey(scope), encodeFormDraft(new Map(Object.entries(fields).map(([name, value]) => [name + '#0', control(value)])), Object.keys(fields), Date.now(), revision));
}
function change(input, value) {
  const type = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function mount(element) {
  const container = document.createElement('section'); document.body.append(container);
  const root = createRoot(container);
  const view = { container, root, render(next) { flushSync(() => root.render(next)); }, cleanup() { flushSync(() => root.unmount()); container.remove(); activeViews.delete(view); } };
  activeViews.add(view);
  view.render(element);
  return view;
}
function simple(props = {}) {
  return h(ActionForm, { action: async () => ({ ok: false, error: 'Revisar' }), draftScope: 'cash:u:h:declarar', draftRevision: 'v2', draftFields: ['notes'], preserveOnSuccess: true, ...props },
    h('textarea', { name: 'notes', defaultValue: 'Registro actual' }),
    h('input', { type: 'checkbox', name: 'physical', value: '1' }),
    h('button', { type: 'submit' }, 'Guardar'));
}
async function test(name, run) {
  sessionStorage.clear();
  try { await run(); results.push({ name, pass: true }); }
  catch (error) { errors.push(error); results.push({ name, pass: false, error: error.message }); }
  finally { for (const view of activeViews) view.cleanup(); document.body.replaceChildren(); }
}
const state = { enabled: true, funds: [], cashGuarantees: [{ id: 'g', humanId: 1, amount: 1000, currency: 'CLP', state: 'ACTIVA' }], elements: [], transfers: [], discrepancies: [], declared: null, confirmed: null, latestMovementAt: null };
function cash(props = {}) { return h(CashBox, { handoverId: 'h1', shiftId: 's1', state, denominations: [{ id: 'd', currency: 'CLP', value: 1000, medium: 'BILLETE' }], previous: {}, role: 'emisor', reviewerId: 'u1', formalClosure: null, ...props }); }
(async () => {
  await test('stale revision survives an edit and reload', async () => {
    saveDraft('cash:u:h:declarar', 'v1');
    const view = mount(simple()); await wait();
    assert.match(view.container.textContent, /registro guardado cambió/);
    change(view.container.querySelector('textarea'), 'Más detalle'); await wait();
    const raw = sessionStorage.getItem(draftKey('cash:u:h:declarar'));
    assert.equal(formDraftRevision(raw), 'v1', 'typing must not silently acknowledge a newer saved revision');
    assert.match(view.container.textContent, /registro guardado cambió/);
    view.cleanup();
    const restored = mount(simple()); await wait();
    assert.equal(restored.container.querySelector('textarea').value, 'Más detalle');
    assert.match(restored.container.textContent, /registro guardado cambió/); restored.cleanup();
  });
  await test('cash navigation isolates handover and physical checks', async () => {
    const view = mount(cash()); await wait();
    change(view.container.querySelector('[name="d_d"]'), '7');
    view.container.querySelector('[name="g_g"]').click(); await wait();
    view.render(cash({ handoverId: 'h2', shiftId: 's2' })); await wait();
    assert.equal(view.container.querySelector('[name="d_d"]').value, '', 'a new handover must not inherit quantities');
    assert.equal(view.container.querySelector('[name="g_g"]').checked, false, 'a new handover must not inherit physical confirmations');
    view.render(cash()); await wait();
    assert.equal(view.container.querySelector('[name="d_d"]').value, '7');
    assert.equal(view.container.querySelector('[name="g_g"]').checked, false);
    view.cleanup();
  });
  await test('cash actor change cannot reuse previous actor fields', async () => {
    const view = mount(cash()); await wait();
    change(view.container.querySelector('[name="d_d"]'), '7'); await wait();
    view.render(cash({ reviewerId: 'u2' })); await wait();
    assert.equal(view.container.querySelector('[name="d_d"]').value, ''); view.cleanup();
  });
  await test('note navigation isolates handover and actor', async () => {
    const note = props => h(AddHandoverNoteForm, { actorId: 'u1', handoverId: 'h1', revision: 'n1', observation: 'Registro primero', ...props });
    const view = mount(note()); await wait();
    change(view.container.querySelector('[name="observation"]'), 'Nota pendiente primera'); await wait();
    view.render(note({ handoverId: 'h2', observation: 'Registro segundo' })); await wait();
    assert.equal(view.container.querySelector('[name="observation"]').value, 'Registro segundo');
    view.render(note({ actorId: 'u2' })); await wait();
    assert.equal(view.container.querySelector('[name="observation"]').value, 'Registro primero'); view.cleanup();
  });
  await test('new saved note revision refreshes canonical text without local draft', async () => {
    const note = props => h(AddHandoverNoteForm, { actorId: 'u1', handoverId: 'h1', revision: 'n1', observation: 'Registro primero', ...props });
    const view = mount(note()); await wait();
    view.render(note({ revision: 'n2', observation: 'Registro actualizado' })); await wait();
    assert.equal(view.container.querySelector('[name="observation"]').value, 'Registro actualizado'); view.cleanup();
  });
  await test('success clears submitted draft when revalidation already unmounted form', async () => {
    let finish;
    const action = () => new Promise(resolve => { finish = resolve; });
    const view = mount(simple({ action })); await wait();
    change(view.container.querySelector('textarea'), 'Enviar esto'); await wait();
    view.container.querySelector('button').click(); await wait();
    assert.equal(typeof finish, 'function');
    view.render(h('p', null, 'Siguiente paso confirmado por servidor'));
    finish({ ok: true, message: 'Guardado' }); await wait();
    assert.equal(sessionStorage.getItem(draftKey('cash:u:h:declarar')), null, 'confirmed save cannot leave a recoverable unsaved draft'); view.cleanup();
  });
  await test('replacement rendered before success uses saved defaults and clears warning', async () => {
    let finish;
    const action = () => new Promise(resolve => { finish = resolve; });
    const view = mount(simple({ action, key: 'before' })); await wait();
    change(view.container.querySelector('textarea'), '  Enviar esto  '); await wait();
    view.container.querySelector('button').click(); await wait();
    view.render(simple({ key: 'after', draftRevision: 'v3' })); await wait();
    finish({ ok: true, message: 'Guardado' }); await wait();
    assert.equal(sessionStorage.getItem(draftKey('cash:u:h:declarar')), null);
    assert.equal(view.container.querySelector('textarea').value, 'Registro actual');
    assert.doesNotMatch(view.container.textContent, /Borrador|registro guardado cambió/);
    const unload = new dom.window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, false); view.cleanup();
  });
  for (const ok of [true, false]) await test('edits while pending remain visible after ' + (ok ? 'success' : 'rejection'), async () => {
    let finish;
    const action = () => new Promise(resolve => { finish = resolve; });
    const view = mount(simple({ action })); await wait();
    change(view.container.querySelector('textarea'), 'Primera versión'); await wait();
    view.container.querySelector('button').click(); await wait();
    change(view.container.querySelector('textarea'), 'Edición posterior'); await wait();
    finish(ok ? { ok: true, message: 'Guardado' } : { ok: false, error: 'Revisar' }); await wait();
    assert.equal(view.container.querySelector('textarea').value, 'Edición posterior');
    assert.match(sessionStorage.getItem(draftKey('cash:u:h:declarar')), /Edición posterior/);
    const unload = new dom.window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true); view.cleanup();
  });
  await test('unavailable storage does not keep unsaved warning after confirmed save', async () => {
    const get = dom.window.Storage.prototype.getItem, set = dom.window.Storage.prototype.setItem;
    dom.window.Storage.prototype.getItem = dom.window.Storage.prototype.setItem = () => { throw new Error('Optional storage unavailable'); };
    try {
      const view = mount(simple({ action: async () => ({ ok: true, message: 'Guardado' }) })); await wait();
      change(view.container.querySelector('textarea'), 'Enviar esto'); await wait();
      assert.match(view.container.textContent, /No se pudo conservar/);
      view.container.querySelector('button').click(); await wait();
      assert.doesNotMatch(view.container.textContent, /No se pudo conservar/);
      assert.equal(view.container.querySelector('textarea').value, 'Enviar esto'); view.cleanup();
    } finally { dom.window.Storage.prototype.getItem = get; dom.window.Storage.prototype.setItem = set; }
  });
  await test('logout and account switch clear only feature storage', async () => {
    sessionStorage.setItem('other-setting', 'keep');
    sessionStorage.setItem('aroh:form-draft-user', 'u1');
    saveDraft('cash:u1:h1:declarar', 'v1');
    const view = mount(h(FormDraftSession, { userId: 'u2' })); await wait();
    assert.equal(sessionStorage.getItem(draftKey('cash:u1:h1:declarar')), null);
    saveDraft('cash:u2:h2:declarar', 'v1');
    const form = document.createElement('form'); form.setAttribute('data-clear-form-drafts', ''); document.body.append(form);
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait();
    assert.equal(sessionStorage.getItem(draftKey('cash:u2:h2:declarar')), null);
    assert.equal(sessionStorage.getItem('other-setting'), 'keep');
    assert.equal(sessionStorage.getItem('aroh:form-draft-user'), null); view.cleanup(); form.remove();
  });
  console.log(JSON.stringify({ baseline, renderer: 'Next bundled React + jsdom; synthetic actions, no browser/server/DB', results }, null, 2));
  if (!baseline && errors.length) throw errors[0];
})().catch(error => { console.error(error); process.exitCode = 1; });
