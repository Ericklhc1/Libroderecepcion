import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import ts from 'typescript';
import { collectFrameMetadata, frameSourceMetadata, localStaticFrameUrl, parseHydrationStack, safeHydrationPath, watchHydrationDiagnostics } from './hydration-diagnostics.mjs';

const url = 'http://localhost:3000/_next/static/chunks/runtime-abc.js';
const frame = { function: 'hydrate', chunk: '/_next/static/chunks/runtime-abc.js', line: 1, column: 45 };
const message = 'Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]=';
const stack = `${message}\n    at hydrate (${url}:1:45)\n    at ${url}:2:6`;

function response(source, status = 200) {
  let disposed = false;
  return {
    status: () => status, headers: () => ({ 'content-length': String(source.length) }),
    body: async () => Buffer.from(source), dispose: async () => { disposed = true; },
    wasDisposed: () => disposed,
  };
}

test('only exact loopback static assets from stack frames are eligible', () => {
  assert.equal(localStaticFrameUrl(url), url);
  const appChunk = 'http://localhost:3000/_next/static/chunks/app/(app)/tareas/%5Bid%5D/page-abc.js';
  assert.equal(localStaticFrameUrl(appChunk), appChunk);
  for (const unsafe of [
    'https://localhost:3000/_next/static/chunks/a.js',
    'http://127.0.0.1:3000/_next/static/chunks/a.js',
    'http://localhost:3000.evil.invalid/_next/static/a.js',
    'http://user:password@localhost:3000/_next/static/a.js',
    'http://localhost:3000/api/private.js',
    'http://localhost:3000/_next/static/../../../api/private.js',
    url + '?token=private', url + '#private', 'file:///tmp/private.js',
  ]) assert.equal(localStaticFrameUrl(unsafe), null, unsafe);
  assert.equal(safeHydrationPath('http://localhost:3000/tareas/id?note=private#secret'), '/tareas/id');
  assert.equal(safeHydrationPath('https://example.com/private'), null);
});

test('stack output contains bounded technical frames, never message text or external URLs', () => {
  const frames = parseHydrationStack(`PRIVATE_FORM_VALUE\n    at hydrate (${url}:1:45)\n    at secret (https://example.com/private:3:2)\n    at token (${url}?private=1:3:2)`);
  assert.deepEqual(frames, [frame]);
  assert.equal(parseHydrationStack('Error: private').length, 0);
  assert.equal(parseHydrationStack('Error\n' + `    at hydrate (${url}:1:45)\n`.repeat(30)).length, 12);
});

test('AST hints identify function and fixed React markers without exporting source or literals', () => {
  const source = 'function hydrate(){const secret="DO_NOT_EXPORT";if(marker==="F!")throw Error(code(418));}';
  const file = ts.createSourceFile('chunk.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const hint = frameSourceMetadata(file, { ...frame, column: source.indexOf('Error(') + 1 });
  assert.equal(hint.status, 'available');
  assert.equal(hint.function, 'hydrate');
  assert.deepEqual(hint.reactMarkers, ['F!']);
  assert.ok(hint.syntax.includes('CallExpression'));
  assert.ok(!JSON.stringify(hint).includes('DO_NOT_EXPORT'));
  assert.ok(!JSON.stringify(hint).includes('secret'));
  assert.deepEqual(frameSourceMetadata(file, { ...frame, line: 50 }), { status: 'position-unavailable' });
});

test('chunk requests cannot redirect and response buffers are disposed', async () => {
  const source = 'function hydrate(){if(marker==="F!")throw Error(code(418));}';
  const asset = response(source);
  const requests = [];
  const request = { get: async (...args) => { requests.push(args); return asset; } };
  const result = await collectFrameMetadata(request, [frame]);
  assert.equal(requests[0][0], url);
  assert.deepEqual(requests[0][1], { timeout: 3000, maxRedirects: 0, failOnStatusCode: false });
  assert.equal(result[0].status, 'available');
  assert.equal(asset.wasDisposed(), true);
  assert.ok(!JSON.stringify(result).includes(source));
  const redirected = response('', 302);
  assert.equal((await collectFrameMetadata({ get: async () => redirected }, [frame]))[0].status, 'http-unavailable');
  assert.equal(redirected.wasDisposed(), true);
  const rejected = await collectFrameMetadata({ get: async () => { throw Error('Must not run'); } }, [{ ...frame, chunk: '/api/private.js' }]);
  assert.equal(rejected[0].status, 'target-rejected');
});

test('errors retain stage at occurrence and flush waits for async evidence before teardown', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const asset = response('function hydrate(){if(marker==="F!")throw Error(code(418));}');
  const page = new EventEmitter();
  page.url = () => 'http://localhost:3000/housekeeping?note=DO_NOT_EXPORT';
  page.context = () => ({ request: { get: async () => { await ready; return asset; } } });
  const emitted = [];
  const diagnostic = watchHydrationDiagnostics(page, { role: 'maid', width: 1280, emit: value => emitted.push(value) });
  diagnostic.mark('action:Comenzar');
  page.emit('pageerror', { name: 'Error', message, stack });
  diagnostic.mark('after-action:Comenzar');
  assert.equal(diagnostic.errors.length, 1, 'Runtime gate sees the error synchronously');
  assert.equal(emitted.length, 0);
  let flushed = false;
  const flushing = diagnostic.flush().then(() => { flushed = true; });
  await Promise.resolve();
  assert.equal(flushed, false);
  release();
  await flushing;
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].stage, 'action:Comenzar');
  assert.equal(emitted[0].path, '/housekeeping');
  assert.equal(emitted[0].reactError, 418);
  assert.equal(emitted[0].mismatch, 'HTML');
  assert.equal(emitted[0].sourceStatus, 'collected');
  assert.equal(asset.wasDisposed(), true);
  assert.ok(!JSON.stringify(emitted).includes('DO_NOT_EXPORT'));
});

test('missing stack and failed source reads remain explicit and do not hide the runtime error', async () => {
  const page = new EventEmitter();
  page.url = () => 'http://localhost:3000/tareas/example';
  page.context = () => ({ request: { get: async () => { throw Error('PRIVATE_NETWORK_DETAIL'); } } });
  const emitted = [];
  const diagnostic = watchHydrationDiagnostics(page, { role: 'worker', width: 390, emit: record => emitted.push(record) });
  page.emit('pageerror', { name: 'Error', message });
  page.emit('pageerror', { name: 'Error', message, stack });
  await diagnostic.flush();
  assert.equal(diagnostic.errors.length, 2);
  assert.equal(emitted[0].sourceStatus, 'no-eligible-frames');
  assert.equal(emitted[1].sourceStatus, 'unavailable');
  assert.ok(!JSON.stringify(emitted).includes('PRIVATE_NETWORK_DETAIL'));
});


test('unavailable and oversized assets have bounded diagnostic results', async () => {
  let bodyRead = false, disposed = false;
  const oversized = {
    status: () => 200, headers: () => ({'content-length': String(5 * 1024 * 1024)}),
    body: async () => { bodyRead = true; return Buffer.alloc(0); }, dispose: async () => { disposed = true; },
  };
  const result = await collectFrameMetadata({get: async () => oversized}, [frame]);
  assert.equal(result[0].status, 'source-too-large');
  assert.equal(bodyRead, false);
  assert.equal(disposed, true);
});

test('runtime errors are never dropped when enrichment reaches its limit', async () => {
  let requests = 0;
  const page = new EventEmitter();
  page.url = () => 'http://localhost:3000/coordinacion';
  page.context = () => ({request: {get: async () => {requests++; return response('function hydrate(){throw Error(code(418));}');}}});
  const emitted = [];
  const diagnostic = watchHydrationDiagnostics(page, {role: 'worker', width: 390, emit: record => emitted.push(record)});
  for (let index = 0; index < 6; index++) page.emit('pageerror', {name: 'Error', message, stack});
  page.emit('pageerror', {name: 'TypeError', message: 'PRIVATE_FORM_VALUE', stack});
  await diagnostic.flush();
  assert.equal(diagnostic.errors.length, 7);
  assert.equal(emitted.length, 7);
  assert.equal(requests, 4);
  assert.equal(diagnostic.errors.filter(item => item.sourceStatus === 'limit-reached').length, 2);
  assert.equal(diagnostic.errors.at(-1).reactError, null);
  assert.ok(!JSON.stringify(emitted).includes('PRIVATE_FORM_VALUE'));
});
