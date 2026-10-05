import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CLIENT_VARIANTS, NEXT_VERSION, reactPingBackport } from './react-ping-backport.mjs';

const script = fileURLToPath(new URL('./react-ping-backport.mjs', import.meta.url));
const project = resolve(dirname(script), '../..');
const compiled = 'node_modules/next/dist/compiled/react-dom/cjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');
// Read installed sources only. CI postinstall may already have applied the fix;
// reconstruct the allowlisted original in memory, never edit shared node_modules.
const originals = CLIENT_VARIANTS.map((variant) => {
  const current = readFileSync(join(project, compiled, variant.file), 'utf8');
  assert.ok([variant.original, variant.patched].includes(hash(current)), variant.file);
  const original = hash(current) === variant.original
    ? current : current.replace(variant.patch.after, variant.patch.before);
  assert.equal(hash(original), variant.original);
  return original;
});

function put(root, relative, contents) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aroh-react-ping-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'node_modules/next/package.json', JSON.stringify({ name: 'next', version: NEXT_VERSION }));
  CLIENT_VARIANTS.forEach((variant, index) => put(root, `${compiled}/${variant.file}`, originals[index]));
  for (const sentinel of [
    'node_modules/next/dist/compiled/react-dom-experimental/cjs/react-dom-client.production.js',
    `${compiled}/react-dom-server.browser.production.js`,
    'node_modules/react-dom/cjs/react-dom-client.production.js',
    '.next/BUILD_ID', '.next/cache/fetch-cache/keep', '.next/cache/webpack/generated',
  ]) put(root, sentinel, 'untouched');
  return root;
}

function sources(root) {
  return CLIENT_VARIANTS.map((variant) => readFileSync(join(root, compiled, variant.file), 'utf8'));
}

test('apply changes only the official branch in four standard client variants', (t) => {
  const root = fixture(t);
  assert.deepEqual(reactPingBackport({ projectRoot: root, mode: 'apply' }), {
    version: NEXT_VERSION, mode: 'apply', patched: 4, verified: 4, cacheCleared: true,
  });
  sources(root).forEach((source, index) => {
    const variant = CLIENT_VARIANTS[index];
    assert.equal(hash(source), variant.patched);
    assert.equal(source.replace(variant.patch.after, variant.patch.before), originals[index]);
  });
  assert.equal(existsSync(join(root, '.next/cache/webpack')), false);
  for (const sentinel of [
    'node_modules/next/dist/compiled/react-dom-experimental/cjs/react-dom-client.production.js',
    `${compiled}/react-dom-server.browser.production.js`,
    'node_modules/react-dom/cjs/react-dom-client.production.js',
    '.next/BUILD_ID', '.next/cache/fetch-cache/keep',
  ]) assert.equal(readFileSync(join(root, sentinel), 'utf8'), 'untouched');
});

test('apply is idempotent, check is read-only, prepare-build always invalidates webpack cache', (t) => {
  const root = fixture(t);
  assert.throws(() => reactPingBackport({ projectRoot: root }), /missing/);
  assert.deepEqual(sources(root), originals);
  assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
  reactPingBackport({ projectRoot: root, mode: 'apply' });
  put(root, '.next/cache/webpack/generated', 'stale');
  const patched = sources(root);
  for (const mode of ['check', 'apply']) {
    const result = reactPingBackport({ projectRoot: root, mode });
    assert.equal(result.patched, 0);
    assert.equal(result.cacheCleared, false);
    assert.deepEqual(sources(root), patched);
    assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
  }
  const result = reactPingBackport({ projectRoot: root, mode: 'prepare-build' });
  assert.equal(result.patched, 0);
  assert.equal(result.cacheCleared, true);
  assert.deepEqual(sources(root), patched);
  assert.equal(existsSync(join(root, '.next/cache/webpack')), false);
});

test('an interrupted exact-original/exact-patched mixture can be resumed', (t) => {
  const root = fixture(t);
  const first = CLIENT_VARIANTS[0];
  put(root, `${compiled}/${first.file}`, originals[0].replace(first.patch.before, first.patch.after));
  assert.equal(reactPingBackport({ projectRoot: root, mode: 'apply' }).patched, 3);
  assert.equal(reactPingBackport({ projectRoot: root, mode: 'check' }).verified, 4);
});

test('a different Next version fails before any write or cache deletion', (t) => {
  const root = fixture(t);
  put(root, 'node_modules/next/package.json', JSON.stringify({ name: 'next', version: '15.5.26' }));
  assert.throws(() => reactPingBackport({ projectRoot: root, mode: 'prepare-build' }), /requires Next 15\.5\.25/);
  assert.deepEqual(sources(root), originals);
  assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
});

for (const [index, variant] of CLIENT_VARIANTS.entries()) {
  test(`source drift in ${variant.file} rejects the entire batch before writes`, (t) => {
    const root = fixture(t);
    put(root, `${compiled}/${variant.file}`, `${originals[index]}\n// unexpected drift\n`);
    const before = sources(root);
    assert.throws(() => reactPingBackport({ projectRoot: root, mode: 'apply' }), /source drift/);
    assert.deepEqual(sources(root), before);
    assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
  });
}

test('a missing fourth variant rejects the entire batch before writes', (t) => {
  const root = fixture(t);
  rmSync(join(root, compiled, CLIENT_VARIANTS[3].file));
  assert.throws(() => reactPingBackport({ projectRoot: root, mode: 'apply' }), /ENOENT/);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(readFileSync(join(root, compiled, CLIENT_VARIANTS[index].file), 'utf8'), originals[index]);
  }
  assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
});

test('shared node_modules symlinks are refused without touching their targets', (t) => {
  const root = fixture(t);
  renameSync(join(root, 'node_modules'), join(root, 'shared-modules'));
  symlinkSync(join(root, 'shared-modules'), join(root, 'node_modules'), 'dir');
  assert.throws(() => reactPingBackport({ projectRoot: root, mode: 'apply' }), /Refusing symlink/);
  assert.deepEqual(sources(root), originals);
  assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
});

for (const relative of ['.next', '.next/cache', '.next/cache/webpack']) {
  test(`cache cleanup refuses a symlink at ${relative} before patching`, (t) => {
    const root = fixture(t);
    const displaced = join(root, 'displaced-cache');
    renameSync(join(root, relative), displaced);
    symlinkSync(displaced, join(root, relative), 'dir');
    assert.throws(() => reactPingBackport({ projectRoot: root, mode: 'apply' }), /Refusing symlink/);
    assert.deepEqual(sources(root), originals);
    assert.ok(existsSync(join(root, '.next/cache/webpack/generated')));
  });
}

test('nested cache symlinks are unlinked without traversing their destination', (t) => {
  const root = fixture(t);
  put(root, 'outside-cache/keep', 'safe');
  symlinkSync(join(root, 'outside-cache'), join(root, '.next/cache/webpack/external'), 'dir');
  reactPingBackport({ projectRoot: root, mode: 'apply' });
  assert.equal(readFileSync(join(root, 'outside-cache/keep'), 'utf8'), 'safe');
});

test('CLI accepts only explicit modes and uses its fixture working directory', (t) => {
  const root = fixture(t);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 1);
  assert.equal(run('--other').status, 1);
  assert.equal(run('--check').status, 1);
  assert.equal(run('--apply').status, 0);
  assert.equal(run('--check').status, 0);
  put(root, '.next/cache/webpack/generated', 'stale');
  assert.equal(run('--prepare-build').status, 0);
  assert.equal(existsSync(join(root, '.next/cache/webpack')), false);
});

function extractFunction(source, name) {
  const match = new RegExp(`^([ ]*)function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const end = source.indexOf(`\n${match[1]}function `, match.index + match[0].length);
  assert.ok(end > match.index, name);
  return source.slice(match.index, end);
}

// This is a focused VM regression of the actual installed functions. It is not
// claimed to be full renderer/browser coverage: real DOM before/after reproduction
// and the existing browser journeys provide separate integration evidence.
function pingScenario(source, { duringRender = true, exitStatus = 4, suspendedFirst = false } = {}) {
  const lanes = 14336;
  const root = {
    pendingLanes: lanes, suspendedLanes: suspendedFirst ? lanes : 0,
    pingedLanes: 0, warmLanes: suspendedFirst ? lanes : 0, pingCache: new Map(),
    expirationTimes: Array(31).fill(-1),
  };
  let restarted = 0;
  let scheduled = 0;
  const context = vm.createContext({
    root, lanes, workInProgressRoot: root, workInProgressRootRenderLanes: lanes,
    workInProgressRootExitStatus: exitStatus, workInProgressRootPingedLanes: 0,
    workInProgressRootInterleavedUpdatedLanes: 0, workInProgressSuspendedRetryLanes: lanes,
    executionContext: duringRender ? 2 : 0, RenderContext: 2, NoContext: 0,
    RootSuspendedWithDelay: 4, RootSuspended: 3, FALLBACK_THROTTLE_MS: 300,
    globalMostRecentFallbackTime: 0, now: () => 1, now$1: () => 1,
    clz32: Math.clz32, isConcurrentActEnvironment: () => false,
    prepareFreshStack: () => { restarted += 1; },
    ensureRootIsScheduled: () => { scheduled += 1; },
  });
  const functions = ['pingSuspendedRoot', 'markRootSuspended', 'getNextLanes', 'getHighestPriorityLanes'];
  vm.runInContext(functions.map((name) => extractFunction(source, name)).join('\n'), context);
  vm.runInContext('pingSuspendedRoot(root, {}, lanes);', context);
  if (!suspendedFirst && duringRender) vm.runInContext('markRootSuspended(root, lanes, 0, true);', context);
  const next = vm.runInContext('getNextLanes(root, 0, false)', context);
  return { suspended: root.suspendedLanes, next, recorded: context.workInProgressRootPingedLanes, restarted, scheduled };
}

for (const [index, variant] of CLIENT_VARIANTS.entries()) {
  test(`VM before/after synchronous ping and unaffected controls: ${variant.file}`, () => {
    const before = originals[index];
    const after = before.replace(variant.patch.before, variant.patch.after);
    assert.deepEqual(pingScenario(before), { suspended: 14336, next: 0, recorded: 0, restarted: 0, scheduled: 1 });
    assert.deepEqual(pingScenario(after), { suspended: 0, next: 14336, recorded: 14336, restarted: 0, scheduled: 1 });
    for (const control of [
      { duringRender: false },
      { duringRender: false, suspendedFirst: true },
      { exitStatus: 2 },
    ]) assert.deepEqual(pingScenario(before, control), pingScenario(after, control));
  });
}

// If the app opts into Next's other runtime channel, this scoped backport must
// be reviewed rather than silently leaving that renderer outside coverage.
test('the effective application config selects the standard bundled renderer', async () => {
  const [{ default: config }, { needsExperimentalReact }, { defaultConfig }] = await Promise.all([
    import('../../next.config.mjs'),
    import('next/dist/lib/needs-experimental-react.js'),
    import('next/dist/server/config-shared.js'),
  ]);
  const effective = { ...defaultConfig, ...config, experimental: { ...defaultConfig.experimental, ...config.experimental } };
  assert.equal(needsExperimentalReact(effective), false);
});
