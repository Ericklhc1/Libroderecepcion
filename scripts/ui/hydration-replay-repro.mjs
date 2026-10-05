// Isolated QA, no server/network/DB and no renderer patches. Install jsdom only
// in a temporary prefix with --ignore-scripts; do not add it to production deps.
// npm install --prefix /tmp/aroh-hydration-dom --ignore-scripts --package-lock=false --no-audit --no-fund jsdom@27.0.1
// JSDOM_MODULE=/tmp/aroh-hydration-dom/node_modules/jsdom node scripts/ui/hydration-replay-repro.mjs bundled
// Repeat with `published` to compare the separately installed React 19.3 runtime.
// This exercises real renderers in jsdom; it is not browser E2E verification.
// Upstream mechanism: https://github.com/react/react/pull/35494
process.env.NODE_ENV = 'production';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const loadModule = createRequire(import.meta.url);
const { JSDOM } = loadModule(process.env.JSDOM_MODULE || 'jsdom');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] || 'bundled';
assert.ok(['bundled', 'published'].includes(mode));
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true });
for (const name of ['window', 'document', 'Node', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'MutationObserver']) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name];
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const prefix = mode === 'published' ? '' : 'next/dist/compiled/';
const loadRuntime = name => loadModule(path.join(repo, 'node_modules', prefix + name));
const React = loadRuntime('react');
const ReactDOMClient = loadRuntime('react-dom/client');
const ReactDOMServer = loadRuntime('react-dom/server');
const h = React.createElement;

function compileBoundary(source, fileName) {
  const compiled = ts.transpileModule(source, { fileName, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const loaded = { exports: {} };
  // Evaluate only the repository's pure template / extracted JSX boundary,
  // with imports restricted to the selected React. Never load layout services.
  const localRequire = name => {
    assert.ok(['react', 'react/jsx-runtime'].includes(name), 'Unexpected boundary dependency');
    return loadRuntime(name);
  };
  new Function('require', 'module', 'exports', compiled.outputText)(localRequire, loaded, loaded.exports);
  return loaded.exports.default;
}
const templateFile = path.join(repo, 'src/app/(app)/template.tsx');
const Template = compileBoundary(readFileSync(templateFile, 'utf8'), templateFile);
const layoutFile = path.join(repo, 'src/app/(app)/layout.tsx');
const layout = ts.createSourceFile(layoutFile, readFileSync(layoutFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let mainNode;
function findMain(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(layout) === 'main') mainNode = node;
  ts.forEachChild(node, findMain);
}
findMain(layout);
assert.ok(mainNode, 'Actual layout main is required');
const Main = compileBoundary(`import { Fragment } from 'react'; export default function Main({children}) { return (${mainNode.getText(layout)}); }`, 'main-boundary.tsx');

function pendingModule(value, resolution) {
  const listeners = [];
  let scheduled = false;
  const chunk = { status: 'pending', value: null, reason: null, then(resolve) {
    if (chunk.status === 'fulfilled') return resolve(chunk.value);
    listeners.push(resolve);
    if (!scheduled) {
      scheduled = true;
      const settle = () => { chunk.status = 'fulfilled'; chunk.value = value; for (const listener of listeners.splice(0)) listener(value); };
      if (resolution === 'microtask') queueMicrotask(settle);
      else setTimeout(settle, 50);
    }
  } };
  return chunk;
}
function target(child, condition) {
  if (condition.source) {
    // Server Components render to host JSX before Flight reaches the browser.
    // Call these functions directly so an artificial component fiber cannot
    // accidentally repair the tested host/lazy-child boundary.
    const element = (condition.source === 'main' ? Main : Template)({ children: child });
    return condition.before ? h(element.type, element.props, child) : element;
  }
  return h('div', { id: 'target' }, condition.fragment ? h(React.Fragment, condition.unkeyed ? null : { key: 'fixed-stream' }, child) : child);
}
function App({ child, condition }) {
  return h('div', { id: 'outer' }, h('p', null, 'before'), target(child, condition), h('p', null, 'after'));
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const conditions = [
  { name: 'unprotected-host', transition: true, resolution: 'microtask', expectedBug: true },
  { name: 'sync-control', transition: false, resolution: 'microtask' },
  { name: 'late-resolution-control', transition: true, resolution: 'late' },
  { name: 'unkeyed-fragment', transition: true, resolution: 'microtask', fragment: true, unkeyed: true, expectedBug: true },
  { name: 'keyed-fragment', transition: true, resolution: 'microtask', fragment: true },
  { name: 'main-before', source: 'main', before: true, transition: true, resolution: 'microtask', expectedBug: true },
  { name: 'main-actual-source', source: 'main', transition: true, resolution: 'microtask' },
  { name: 'template-before', source: 'template', before: true, transition: true, resolution: 'microtask', expectedBug: true },
  { name: 'template-actual-source', source: 'template', transition: true, resolution: 'microtask' },
];
async function checkShellIdentity() {
  const container = document.createElement('div'); document.body.appendChild(container);
  let mounts = 0, unmounts = 0;
  function DraftSentinel() {
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return h('textarea', { id: 'draft-sentinel', defaultValue: '' });
  }
  function Shell({ route }) {
    return h(React.Fragment, null, Main({ children: h('section', { id: 'current-route' }, route) }), h(DraftSentinel));
  }
  container.innerHTML = ReactDOMServer.renderToString(h(Shell, { route: 'first' }));
  const errors = [];
  const root = ReactDOMClient.hydrateRoot(container, h(Shell, { route: 'first' }), { onRecoverableError: error => errors.push(error.message) });
  await wait(100);
  const originalMain = container.querySelector('main'), draft = container.querySelector('#draft-sentinel');
  draft.value = 'Unsent local draft';
  React.startTransition(() => root.render(h(Shell, { route: 'second' })));
  await wait(100);
  assert.equal(container.querySelector('#current-route').textContent, 'second');
  assert.equal(container.querySelector('main'), originalMain);
  assert.equal(container.querySelector('#draft-sentinel'), draft);
  assert.equal(draft.value, 'Unsent local draft');
  assert.equal(mounts, 1); assert.equal(unmounts, 0); assert.deepEqual(errors, []);
  root.unmount(); container.remove();
  return { actualMainSource: true, mainDOMReused: true, siblingDraftPreserved: true, siblingMounts: mounts, scope: 'shell-sibling sentinel; not full Fronti E2E' };
}
(async () => {
  assert.equal(React.version, mode === 'bundled' ? '19.2.0-canary-0bdb9206-20250818' : '19.3.0', 'Reassess expected regression when the runtime changes');
  const results = [];
  for (const condition of conditions) {
    let failures = 0, replaced = 0; let firstStack = null;
    for (let trial = 0; trial < 5; trial++) {
      const container = document.createElement('div'); document.body.appendChild(container);
      const child = h('section', { id: 'child' }, 'lazy child');
      const before = { ...condition, before: true, fragment: false };
      const expectedHTML = ReactDOMServer.renderToString(h(App, { child, condition: before }));
      const actualHTML = ReactDOMServer.renderToString(h(App, { child, condition }));
      assert.equal(actualHTML, expectedHTML, 'Boundary must retain byte-identical SSR HTML');
      container.innerHTML = actualHTML;
      const originalTarget = container.querySelector('#outer').children[1], originalChild = container.querySelector('#child');
      const lazy = React.lazy(() => pendingModule({ default: child }, condition.resolution));
      const errors = []; let root;
      const hydrate = () => { root = ReactDOMClient.hydrateRoot(container, h(App, { child: lazy, condition }), { onRecoverableError: error => errors.push(error) }); };
      if (condition.transition) React.startTransition(hydrate); else hydrate();
      await wait(100);
      assert.equal(container.querySelector('#child')?.textContent, 'lazy child');
      assert.ok(errors.every(error => /Minified React error #418/.test(error.message)));
      failures += Number(errors.length > 0);
      replaced += Number(originalTarget !== container.querySelector('#outer').children[1] || originalChild !== container.querySelector('#child'));
      if (errors.length && !firstStack) firstStack = errors[0].stack.split('\n').slice(0, 5).join('\n');
      root.unmount(); container.remove();
    }
    const expectedFailures = mode === 'bundled' && condition.expectedBug ? 5 : 0;
    assert.equal(failures, expectedFailures, condition.name);
    assert.equal(replaced, expectedFailures, condition.name + ' DOM identity');
    results.push({ condition: condition.name, trials: 5, identicalServerHTML: true, hydrationErrors: failures, serverDOMReplaced: replaced, firstErrorStack: firstStack });
  }
  const identity = await checkShellIdentity();
  console.log(JSON.stringify({ runtime: mode, react: React.version, reactDOM: ReactDOMServer.version, dom: 'jsdom27.0.1', probePatchesRenderer: false, results, identity }, null, 2));
  dom.window.close();
})().catch(error => { console.error(error); process.exitCode = 1; dom.window.close(); });
