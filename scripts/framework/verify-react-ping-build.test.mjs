import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CLIENT_VARIANTS } from './react-ping-backport.mjs';
import { inspectReactPingChunk, verifyReactPingBuild, verifyServedReactPingBuild } from './verify-react-ping-build.mjs';

const require = createRequire(import.meta.url);
const { minify } = require('next/dist/build/swc');
const project = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('./verify-react-ping-build.mjs', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const variants = CLIENT_VARIANTS.filter((variant) => variant.file.endsWith('.production.js') || variant.file.endsWith('.profiling.js'));
const compiled = [];
for (const variant of variants) {
  const installed = readFileSync(join(project, 'node_modules/next/dist/compiled/react-dom/cjs', variant.file), 'utf8');
  assert.ok([variant.original, variant.patched].includes(hash(installed)), variant.file);
  const original = hash(installed) === variant.original ? installed : installed.replace(variant.patch.after, variant.patch.before);
  const patched = original.replace(variant.patch.before, variant.patch.after);
  assert.equal(hash(original), variant.original);
  assert.equal(hash(patched), variant.patched);
  // Real complete distributed renderer, SWC compression and name mangling.
  // No shared dependency writes, framework build, sockets or browser needed.
  const options = { compress: true, mangle: { toplevel: true } };
  compiled.push({ variant, original, patched, before: (await minify(original, options)).code, after: (await minify(patched, options)).code });
}

function fixture(t, assets) {
  const root = mkdtempSync(join(tmpdir(), 'aroh-react-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const chunksDir = join(root, '.next/static/chunks');
  mkdirSync(chunksDir, { recursive: true });
  for (const [name, contents] of Object.entries(assets)) {
    const path = join(chunksDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return { root, chunksDir };
}

for (const { variant, original, patched, before, after } of compiled) {
  test(`${variant.file}: original and SWC output fail; exact backport and SWC output pass`, () => {
    for (const source of [original, before]) {
      const result = inspectReactPingChunk(source);
      assert.equal(result.length, 1);
      assert.equal(result[0].status, 'failed');
      assert.match(result[0].reason, /loses or mishandles a ping/);
    }
    for (const source of [patched, after]) {
      const result = inspectReactPingChunk(source);
      assert.equal(result.length, 1);
      assert.equal(result[0].status, 'verified');
      assert.ok(result[0].cases >= 4);
    }
  });
}

test('webpack-wrapped minified renderer yields a hash and byte count without source in report', (t) => {
  const source = `(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[1],{123:function(e,t,n){${compiled[0].after}}}]);`;
  const { chunksDir } = fixture(t, { 'renderer-abcd.js': source, 'app/(app)/page.js': 'console.log("unrelated");' });
  const report = verifyReactPingBuild({ chunksDir });
  assert.equal(report.status, 'verified');
  assert.equal(report.scannedChunks, 2);
  assert.equal(report.rendererCount, 1);
  assert.deepEqual(report.chunks[0], {
    file: 'renderer-abcd.js', bytes: Buffer.byteLength(source), sha256: hash(source),
    renderers: [{ status: 'verified', cases: 64 }],
  });
  assert.equal(JSON.stringify(report).includes('pingSuspendedRoot'), false);
});

test('a stale additional renderer rejects an otherwise patched build', (t) => {
  const { chunksDir } = fixture(t, { 'new.js': compiled[0].after, 'old.js': compiled[0].before });
  const report = verifyReactPingBuild({ chunksDir });
  assert.equal(report.status, 'failed');
  assert.equal(report.rendererCount, 2);
});

test('every renderer in a shared chunk is checked', () => {
  const source = `(()=>{${compiled[0].after}})();(()=>{${compiled[0].before}})();`;
  assert.deepEqual(inspectReactPingChunk(source).map((result) => result.status), ['verified', 'failed']);
});

test('missing renderer, property strings and source maps cannot produce a pass', (t) => {
  const { chunksDir } = fixture(t, {
    'page.js': 'const fake="pingCache pingedLanes suspendedLanes";',
    'renderer.js.map': compiled[0].after,
  });
  const report = verifyReactPingBuild({ chunksDir });
  assert.equal(report.status, 'failed');
  assert.equal(report.rendererCount, 0);
  assert.equal(report.scannedChunks, 1);
});

test('malformed renderer assets fail closed', () => {
  assert.throws(() => inspectReactPingChunk('function { pingCache;pingedLanes;suspendedLanes;'), /Cannot parse/);
});

test('client asset symlinks are refused', (t) => {
  const { chunksDir } = fixture(t, { 'renderer.js': compiled[0].after });
  symlinkSync(join(chunksDir, 'renderer.js'), join(chunksDir, 'alias.js'));
  assert.throws(() => verifyReactPingBuild({ chunksDir }), /symlink/);
});

test('compiled no-op and inverted render-context mutations fail', () => {
  const variant = compiled[0].variant;
  for (const wrong of [
    variant.patch.after.replace('workInProgressRootPingedLanes |= pingedLanes', '0'),
    variant.patch.after.replace('0 ===', '0 !=='),
    variant.patch.after.replace('workInProgressRootPingedLanes |= pingedLanes', 'workInProgressRootPingedLanes = pingedLanes'),
  ]) {
    const report = inspectReactPingChunk(compiled[0].original.replace(variant.patch.before, wrong));
    assert.equal(report.length, 1);
    assert.equal(report[0].status, 'failed');
  }
});

test('served verification compares fixed local public URLs and complete response hashes', async (t) => {
  const source = compiled[0].after;
  const { chunksDir } = fixture(t, { 'app/(app)/renderer.js': source });
  const report = await verifyServedReactPingBuild(verifyReactPingBuild({ chunksDir }), async (url, options) => {
    assert.equal(url, 'http://localhost:3000/_next/static/chunks/app/(app)/renderer.js');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, { accept: 'application/javascript' });
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(source, { status: 200 });
  });
  assert.equal(report.status, 'verified');
  assert.deepEqual(report.chunks[0].served, { status: 'verified', httpStatus: 200, bytes: Buffer.byteLength(source), sha256: hash(source) });
});

test('served stale, truncated, oversized, redirected and missing assets fail', async (t) => {
  const { chunksDir } = fixture(t, { 'renderer.js': compiled[0].after });
  const disk = verifyReactPingBuild({ chunksDir });
  for (const reply of [
    () => new Response(compiled[0].before),
    () => new Response(compiled[0].after.slice(0, -1)),
    () => new Response(`${compiled[0].after}extra`),
    () => new Response('moved', { status: 302 }),
    () => new Response('not found', { status: 404 }),
    () => { throw new Error('redirect or timeout'); },
  ]) {
    const report = await verifyServedReactPingBuild(disk, async () => reply());
    assert.equal(report.status, 'failed');
    assert.equal(report.chunks[0].served.status, 'failed');
  }
});

test('failed disk proof does not fetch anything', async (t) => {
  const { chunksDir } = fixture(t, { 'renderer.js': compiled[0].before });
  let calls = 0;
  const report = await verifyServedReactPingBuild(verifyReactPingBuild({ chunksDir }), async () => { calls += 1; });
  assert.equal(report.status, 'failed');
  assert.equal(calls, 0);
});

test('CLI reads built assets from cwd and fails closed for missing fix or invalid flags', (t) => {
  const { root } = fixture(t, { 'renderer.js': compiled[0].after });
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  const passed = run();
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(passed.stdout).status, 'verified');
  assert.equal(run('--url', 'https://example.com').status, 1);
  writeFileSync(join(root, '.next/static/chunks/renderer.js'), compiled[0].before);
  const failed = run();
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).status, 'failed');
});

test('the already-fixed published React renderer is accepted in legacy page chunks too', async () => {
  const source = readFileSync(join(project, 'node_modules/react-dom/cjs/react-dom-client.production.js'), 'utf8');
  const output = (await minify(source, { compress: true, mangle: { toplevel: true } })).code;
  for (const candidate of [source, output]) {
    const result = inspectReactPingChunk(candidate);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'verified');
  }
});
