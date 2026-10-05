/*
 * Isolated client regression: real Next-bundled React renderer + jsdom.
 * No browser, server, network or database. All action results are synthetic.
 * Usage: AROH_JSDOM_MODULE=/path/to/jsdom node scripts/ui/shift-dialog-repro.cjs [repo] [--baseline]
 * jsdom is supplied by the isolated QA environment, not an app dependency.
 */
process.env.NODE_ENV = 'production';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = path.resolve(process.argv[2] || process.cwd());
const baseline = process.argv.includes('--baseline');
const requireRepo = createRequire(path.join(repo, 'package.json'));
const ts = requireRepo('typescript');
const { JSDOM } = require(process.env.AROH_JSDOM_MODULE || 'jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000/turno', pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'MutationObserver', 'FormData', 'CustomEvent']) {
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.fetch = () => { throw new Error('Network access is outside this isolated test'); };
// jsdom has no layout. This shim only exposes enabled, non-hidden controls to
// the real Dialog keyboard handler; it is not evidence of browser geometry.
dom.window.HTMLElement.prototype.getClientRects = function () {
  return this.closest('[hidden]') || this.type === 'hidden' ? [] : [{ width: 1, height: 1 }];
};
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
  const module = { exports: {} };
  const localRequire = name => {
    if (['react', 'react-dom', 'react/jsx-runtime'].includes(name)) return runtime(name);
    if (name === 'next/navigation') return { useRouter: () => router };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === '@/server/actions/shifts') return actions;
    if (name === '@/domain/shift') return { SHIFT_EMERGENCY_REASON_KEYS: ['EXCEPTION'], SHIFT_EMERGENCY_REASON_LABEL: { EXCEPTION: 'Motivo sintético' }, SHIFT_WINDOW_LABEL: { DIA: 'Día', NOCHE: 'Noche' } };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const local = name.startsWith('@/') ? 'src/' + name.slice(2) : path.join(path.dirname(relative), name);
      const resolved = ['.tsx', '.ts', ''].map(ext => local + ext).find(file => fs.existsSync(path.join(repo, file)));
      if (!resolved) throw new Error('Missing local source ' + name);
      return compile(resolved);
    }
    return requireRepo(name);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return modules[relative] = module.exports;
}
const forms = compile('src/components/operational/shift-actions.tsx');
const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const error = { ok: false, error: 'Cambio simultáneo: vuelve a revisar.' };
const dialog = () => document.querySelector('[role="dialog"]');
const escape = () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const tab = shiftKey => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
function mount(Component, props, children, options) {
  calls = []; navigation.length = 0;
  const container = document.createElement('section'); document.body.append(container);
  const root = createRoot(container, options); flushSync(() => root.render(h(Component, props, children)));
  return { container, root, trigger: container.querySelector('button[type="button"]'), cleanup() { flushSync(() => root.unmount()); container.remove(); } };
}
async function open(view) { view.trigger.focus(); view.trigger.click(); await wait(); assert.ok(dialog()); }
const variants = [
  ['SendHandoverForm', { shiftId: 'synthetic-shift' }, 'sendHandoverAction', ['refresh']],
  ['CancelPreparationForm', { shiftId: 'synthetic-shift' }, 'cancelHandoverPreparationAction', ['push', '/turno']],
  ['CloseShiftForm', { shiftId: 'synthetic-shift' }, 'closeShiftAction', ['push', '/turno']],
  ['CloseShiftForm', { shiftId: 'synthetic-shift', guided: true }, 'closeShiftAction', ['push', '/turno']],
];
(async () => {
  const results = [];
  for (const [name, props, actionName, expectedNavigation] of variants) {
    actionImpl = async () => error;
    const view = mount(forms[name], props);
    await open(view);
    const focusedInside = dialog().contains(document.activeElement);
    escape(); await wait();
    const escapeClosed = !dialog();
    const focusRestored = escapeClosed && document.activeElement === view.trigger;
    if (baseline) {
      if (!dialog()) await open(view);
      dialog().querySelector('button[type="submit"]').click(); await wait(100);
      const alert = document.querySelector('[role="alert"]');
      assert.equal(alert?.textContent, error.error);
      results.push({ name, guided: !!props.guided, focusedInside, escapeClosed, focusRestored, dialogRemainsAfterRejection: !!dialog(), errorInsideDialog: !!dialog()?.contains(alert) });
      view.cleanup(); continue;
    }
    assert.equal(focusedInside, true, `${name}: opening must move focus inside`);
    assert.equal(escapeClosed, true, `${name}: Escape must dismiss before submission`);
    assert.equal(focusRestored, true, `${name}: dismissal must restore its trigger`);
    assert.equal(document.body.style.overflow, '');
    await open(view);
    dialog().querySelector('button[aria-label="Cerrar"]').click(); await wait();
    assert.equal(dialog(), null, 'X dismisses before submission');
    assert.equal(document.activeElement, view.trigger);
    await open(view);
    dialog().querySelector('form button[type="button"]').click(); await wait();
    assert.equal(dialog(), null, 'Back dismisses before submission');
    assert.equal(document.activeElement, view.trigger);
    assert.equal(calls.length, 0, 'review/dismiss never sends an action');
    await open(view);
    assert.equal(document.body.style.overflow, 'hidden');
    const panel = dialog();
    assert.equal(panel.parentElement.classList.contains('no-print'), true, 'migrated shift overlay preserves its print exclusion');
    const form = panel.querySelector('form');
    const submit = panel.querySelector('button[type="submit"]');
    assert.equal(submit.form, form, 'portal submit belongs to the same native form');
    panel.focus(); tab(true); assert.equal(document.activeElement, submit);
    tab(false); assert.equal(document.activeElement, panel.querySelector('button'));
    tab(true); assert.equal(document.activeElement, submit);
    let settle;
    actionImpl = () => new Promise(resolve => { settle = resolve; });
    submit.click(); await wait();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, actionName);
    assert.deepEqual(calls[0].data, { shiftId: 'synthetic-shift' });
    assert.equal(submit.disabled, true);
    const back = form.querySelector('button[type="button"]');
    assert.equal(back.disabled, true);
    assert.ok(panel.querySelector('[role="status"]')?.textContent.includes('ya está en curso'));
    assert.equal(panel.querySelector('button[aria-label="Cerrar"]'), null);
    submit.click(); back.click(); escape();
    panel.parentElement.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    await wait();
    assert.equal(dialog(), panel, 'pending cannot appear cancelled by Escape/backdrop/back');
    assert.equal(calls.length, 1, 'disabled repeated clicks do not send twice');
    assert.equal(document.body.style.overflow, 'hidden');
    settle(error); await wait(100);
    assert.equal(dialog(), panel, 'rejection keeps the same mounted form');
    assert.equal(panel.querySelector('[role="alert"]')?.textContent, error.error);
    assert.equal(submit.disabled, false);
    assert.equal(back.disabled, false);
    assert.equal(navigation.length, 0, 'rejection must not navigate or refresh');
    escape(); await wait();
    assert.equal(dialog(), null);
    assert.equal(document.activeElement, view.trigger, 'focus survives pending and rejection');
    assert.equal(document.body.style.overflow, '');
    await open(view);
    actionImpl = async () => ({ ok: true, message: 'Acción sintética confirmada.' });
    dialog().querySelector('button[type="submit"]').click(); await wait(100);
    assert.equal(dialog(), null, 'explicit success closes the dialog');
    assert.deepEqual(navigation, [expectedNavigation]);
    assert.equal(document.activeElement, view.trigger);
    results.push({ name, guided: !!props.guided, focus: 'pass', escape: 'pass', pending: 'pass', rejection: 'pass', nativeForm: 'pass', success: 'pass' });
    view.cleanup();
  }
  if (!baseline) {
    let finishImmediate;
    actionImpl = () => new Promise(resolve => { finishImmediate = resolve; });
    const immediate = mount(forms.SendHandoverForm, { shiftId: 'synthetic-immediate' });
    immediate.trigger.focus();
    flushSync(() => immediate.trigger.click());
    const immediatePanel = dialog();
    assert.ok(immediatePanel);
    // No animation frame, passive-effect wait or timer between opening,
    // submitting and trying to dismiss; retry Escape in the first microtask.
    immediatePanel.querySelector('button[type="submit"]').click();
    escape(); queueMicrotask(escape);
    await wait();
    assert.equal(calls.length, 1);
    assert.equal(dialog(), immediatePanel, 'immediate Escape cannot discard an action already sent');
    assert.equal(immediatePanel.querySelector('button[aria-label="Cerrar"]'), null);
    finishImmediate(error); await wait(100);
    assert.equal(immediatePanel.querySelector('[role="alert"]')?.textContent, error.error);
    escape(); await wait();
    assert.equal(dialog(), null);
    assert.equal(document.activeElement, immediate.trigger);
    immediate.cleanup();
    results.push({ immediateOpenSubmitEscape: 'pass', firstMicrotaskEscape: 'pass' });

    const { ShiftActionDialog } = compile('src/components/operational/shift-action-dialog.tsx');
    // Adversarial mount timing: submit during layout, before the initial
    // FormStatus passive effect. The false initial signal must not unlock it.
    let finishBeforeEffects;
    actionImpl = () => new Promise(resolve => { finishBeforeEffects = resolve; });
    function SubmitDuringLayout() {
      const anchor = React.useRef(null);
      React.useLayoutEffect(() => {
        anchor.current.closest('form').requestSubmit();
        queueMicrotask(escape);
      }, []);
      return h('span', { ref: anchor }, 'Synthetic immediate submission');
    }
    const beforeEffects = mount(ShiftActionDialog, {
      shiftId: 'synthetic-mount', action: actions.closeShiftAction,
      trigger: 'Mount timing', title: 'Mount timing', description: 'Synthetic timing only.',
      backLabel: 'Volver', confirmLabel: 'Confirmar', pendingLabel: 'Guardando…',
    }, h(SubmitDuringLayout));
    beforeEffects.trigger.focus();
    flushSync(() => beforeEffects.trigger.click());
    const beforeEffectsPanel = dialog();
    escape(); await wait();
    assert.equal(calls.length, 1);
    assert.equal(dialog(), beforeEffectsPanel, 'initial pending=false cannot unlock an in-flight action');
    assert.equal(beforeEffectsPanel.querySelector('button[aria-label="Cerrar"]'), null);
    finishBeforeEffects(error); await wait(100);
    assert.equal(beforeEffectsPanel.querySelector('[role="alert"]')?.textContent, error.error);
    escape(); await wait();
    assert.equal(dialog(), null);
    assert.equal(document.activeElement, beforeEffects.trigger);
    beforeEffects.cleanup();
    results.push({ submitBeforePassiveEffects: 'pass', initialFalseCannotUnlock: 'pass' });

    let settle;
    actionImpl = () => new Promise(resolve => { settle = resolve; });
    const view = mount(ShiftActionDialog, {
      shiftId: 'synthetic-shift', action: actions.closeShiftAction,
      trigger: 'Abrir prueba sintética', title: 'Confirmación sintética', description: 'Sólo prueba local.',
      backLabel: 'Volver', confirmLabel: 'Confirmar', pendingLabel: 'Guardando…',
    }, h(React.Fragment, null,
      h('textarea', { name: 'notes', required: true, defaultValue: '' }),
      h('input', { name: 'acknowledged', type: 'checkbox', value: '1', required: true }),
      h('select', { name: 'choice', defaultValue: 'a' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
    ));
    await open(view);
    const panel = dialog(); const form = panel.querySelector('form'); const submit = panel.querySelector('button[type="submit"]');
    assert.equal(form.checkValidity(), false);
    submit.click(); await wait();
    assert.equal(calls.length, 0, 'native required validation prevents sending');
    assert.ok(panel.querySelector('button[aria-label="Cerrar"]'), 'invalid submission never enters pending');
    const notes = form.elements.namedItem('notes');
    const ack = form.elements.namedItem('acknowledged');
    const choice = form.elements.namedItem('choice');
    notes.value = 'Texto sintético que no debe perderse.'; ack.checked = true; choice.value = 'b';
    submit.click(); await wait();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].data, { shiftId: 'synthetic-shift', notes: notes.value, acknowledged: '1', choice: 'b' });
    settle(error); await wait(100);
    assert.equal(form.elements.namedItem('notes').value, 'Texto sintético que no debe perderse.');
    assert.equal(form.elements.namedItem('acknowledged').checked, true);
    assert.equal(form.elements.namedItem('choice').value, 'b');
    assert.equal(panel.querySelector('[role="alert"]')?.textContent, error.error);
    actionImpl = async () => { throw new Error('Synthetic lost response'); };
    submit.click(); await wait(100);
    assert.equal(calls.length, 2);
    assert.equal(dialog(), panel);
    assert.equal(submit.disabled, false, 'transport exception must release pending');
    assert.ok(panel.querySelector('[role="alert"]')?.textContent.includes('podría haberse completado'));
    assert.ok(panel.querySelector('[role="alert"]')?.textContent.includes('revisa el estado del turno'));
    assert.equal(notes.value, 'Texto sintético que no debe perderse.');
    assert.equal(ack.checked, true);
    assert.equal(choice.value, 'b');
    assert.equal(navigation.length, 0);
    await wait(); assert.equal(calls.length, 2, 'uncertain response never triggers automatic retry');
    actionImpl = async () => ({ ok: true, message: 'Confirmado.' });
    submit.click(); await wait(100);
    assert.equal(calls.length, 3, 'explicit retry sends exactly once');
    assert.equal(calls[1].previous.ok, false);
    assert.equal(dialog(), null);
    assert.equal(document.activeElement, view.trigger);
    view.cleanup();
    results.push({ syntheticFields: 'pass', nativeRequiredValidation: 'pass', restoreAfterRejectedAction: 'pass', transportException: 'pass', uncertainResult: 'pass', noAutomaticRetry: 'pass', retry: 'pass' });

    class FrameworkBoundary extends React.Component {
      state = { error: null };
      static getDerivedStateFromError(error) { return { error }; }
      render() { return this.state.error ? h('p', { 'data-framework-control': true }, 'Framework control reached boundary') : this.props.children; }
    }
    for (const digest of ['NEXT_REDIRECT;replace;/turno;307;', 'NEXT_HTTP_ERROR_FALLBACK;404']) {
      const frameworkControl = Object.assign(new Error('Synthetic framework control'), { digest });
      const caught = [];
      function FrameworkFixture() {
        return h(FrameworkBoundary, null, h(ShiftActionDialog, {
          shiftId: 'synthetic-framework', action: async () => { throw frameworkControl; },
          trigger: 'Framework control', title: 'Framework control', description: 'Synthetic only.',
          backLabel: 'Volver', confirmLabel: 'Confirmar', pendingLabel: 'Guardando…',
        }));
      }
      const framework = mount(FrameworkFixture, {}, undefined, { onCaughtError: error => caught.push(error) });
      await open(framework);
      dialog().querySelector('button[type="submit"]').click(); await wait(100);
      assert.deepEqual(caught, [frameworkControl], 'Next control must reach its boundary unchanged');
      assert.ok(framework.container.querySelector('[data-framework-control]'));
      assert.equal(dialog(), null);
      assert.equal(document.body.style.overflow, '', 'framework unmount releases modal scroll lock');
      framework.cleanup();
    }
    results.push({ nextRedirectRethrown: 'pass', nextNotFoundRethrown: 'pass' });

    // Existing consumers keep one lifecycle while dismissibility changes.
    const { Dialog } = compile('src/components/ui/dialog.tsx');
    let setDismissible;
    let setRevision;
    const callbacks = [];
    function ExistingConsumer() {
      const [dismissible, changeDismissible] = React.useState(true);
      const [revision, changeRevision] = React.useState('first');
      setDismissible = changeDismissible; setRevision = changeRevision;
      return h(Dialog, { trigger: 'Existing consumer', title: 'Existing consumer', dismissible,
        onOpenChange: next => callbacks.push([revision, next]),
      }, h('input', { name: 'existing', defaultValue: 'Unchanged' }),
      h(Dialog, { trigger: 'Nested consumer', title: 'Nested consumer' }, h('button', { type: 'button' }, 'Inner button')));
    }
    document.body.style.overflow = 'clip';
    const existing = mount(ExistingConsumer, {});
    await open(existing);
    const existingPanel = dialog();
    assert.equal(existingPanel.parentElement.classList.contains('no-print'), false, 'other consumers retain their previous print behavior');
    const input = existingPanel.querySelector('input'); input.focus();
    flushSync(() => setDismissible(false)); await wait();
    assert.equal(document.activeElement, input, 'pending must not refocus or capture a new trigger');
    assert.equal(document.body.style.overflow, 'hidden');
    let leakedEscape = false;
    const outerListener = () => { leakedEscape = true; };
    document.addEventListener('keydown', outerListener);
    escape(); await wait();
    document.removeEventListener('keydown', outerListener);
    assert.equal(dialog(), existingPanel);
    assert.equal(leakedEscape, false, 'a locked top dialog must consume Escape');
    flushSync(() => { setDismissible(true); setRevision('latest'); }); await wait();
    assert.equal(document.activeElement, input, 'unlock must not restore focus before closing');
    const nestedTrigger = Array.from(existingPanel.querySelectorAll('button')).find(button => button.textContent === 'Nested consumer');
    nestedTrigger.focus(); nestedTrigger.click(); await wait();
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 2);
    escape(); await wait();
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    assert.equal(document.activeElement, nestedTrigger);
    assert.equal(document.body.style.overflow, 'hidden', 'nested close keeps outer scroll lock');
    existingPanel.querySelector('button[aria-label="Cerrar"]').click(); await wait();
    assert.equal(dialog(), null);
    assert.equal(document.activeElement, existing.trigger);
    assert.equal(document.body.style.overflow, 'clip');
    assert.deepEqual(callbacks.at(-1), ['latest', false], 'close reads the current callback');
    await open(existing);
    escape(); await wait();
    assert.equal(dialog(), null);
    assert.deepEqual(callbacks.at(-1), ['latest', false], 'Escape reads current callback/dismissibility');
    assert.equal(document.activeElement, existing.trigger);
    existing.cleanup(); document.body.style.overflow = '';
    results.push({ existingDialog: 'pass', dismissibilityToggle: 'pass', noPrematureFocusRestore: 'pass', latestListener: 'pass', nestedFocusAndScroll: 'pass', closeButton: 'pass', perConsumerPrintClass: 'pass' });
  }
  console.log(JSON.stringify({ mode: 'real Next bundled renderer + jsdom; synthetic server actions; no browser/network/database', baseline, reactVersion: React.version, results }, null, 2));
  dom.window.close();
})().catch(error => { console.error(error); dom.window.close(); process.exitCode = 1; });
