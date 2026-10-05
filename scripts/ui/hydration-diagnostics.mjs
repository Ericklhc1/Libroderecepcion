// Read-only diagnostics for guarded synthetic loopback journeys. Never inspect
// DOM text, form values, cookies, headers, Flight payloads or arbitrary URLs.
import ts from 'typescript';

const ORIGIN = 'http://localhost:3000';
const MAX_FRAMES = 12;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_ENRICHED_ERRORS = 4;

export function safeHydrationPath(value) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && !url.username && !url.password ? url.pathname : null;
  } catch { return null; }
}

export function localStaticFrameUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/%(?:28|29|5b|5d)/gi, value => decodeURIComponent(value));
    if (!/^\/_next\/static\/[a-zA-Z0-9_./()\[\]\-]+\.js$/.test(path)) return null;
    return url.href;
  } catch { return null; }
}

export function parseHydrationStack(stack) {
  const frames = [];
  const lines = typeof stack === 'string' ? stack.slice(0, 16_384).split('\n').slice(1, 33) : [];
  for (const line of lines) {
    const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?((?:https?):\/\/[^\s)]+):(\d+):(\d+)\)?\s*$/);
    if (!match) continue;
    const url = localStaticFrameUrl(match[2]);
    if (!url) continue;
    const lineNumber = Number(match[3]), column = Number(match[4]);
    if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(column) || lineNumber < 1 || column < 1) continue;
    frames.push({
      function: /^[\w.$ <>\[\]-]{1,100}$/.test(match[1] ?? '') ? match[1] : null,
      chunk: new URL(url).pathname, line: lineNumber, column,
    });
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

// Only fixed syntax-kind labels and a bounded identifier leave the AST. Source,
// string/number literals and environment/configuration values are never logged.
export function frameSourceMetadata(sourceFile, frame) {
  const starts = sourceFile.getLineStarts();
  const start = starts[frame.line - 1];
  const end = starts[frame.line] ?? sourceFile.text.length;
  if (start === undefined || start + frame.column - 1 >= end) return { status: 'position-unavailable' };
  const offset = start + frame.column - 1;
  const ancestry = [];
  function visit(node) {
    if (offset < node.getStart(sourceFile) || offset >= node.end) return;
    ancestry.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const enclosing = ancestry.findLast(node => ts.isFunctionLike(node));
  const name = enclosing?.name && ts.isIdentifier(enclosing.name) ? enclosing.name.text : null;
  const markers = new Set();
  // Fixed React-only marker vocabulary helps separate useActionState marker
  // mismatches from host-node/text hydration without exporting source fragments.
  function inspect(node) {
    if (node !== enclosing && ts.isFunctionLike(node)) return;
    if (ts.isStringLiteral(node) && ['F', 'F!', 'HTML', 'text', 'noscript', 'textarea'].includes(node.text)) markers.add(node.text);
    ts.forEachChild(node, inspect);
  }
  if (enclosing) inspect(enclosing);
  return {
    status: 'available',
    functionStatus: enclosing ? 'located' : 'unavailable',
    function: name && /^[\w$]{1,80}$/.test(name) ? name : null,
    syntax: ancestry.slice(-7).map(node => ts.SyntaxKind[node.kind]),
    reactMarkers: [...markers].sort(),
  };
}

export async function collectFrameMetadata(request, frames) {
  const selected = frames.slice(0, 6);
  const chunks = [...new Set(selected.map(frame => frame.chunk))].slice(0, 3);
  const metadata = [];
  for (const chunk of chunks) {
    const url = localStaticFrameUrl(ORIGIN + chunk);
    if (!url) { metadata.push({ chunk: null, status: 'target-rejected' }); continue; }
    let response;
    try {
      response = await request.get(url, { timeout: 3000, maxRedirects: 0, failOnStatusCode: false });
      if (response.status() !== 200) { metadata.push({ chunk, status: 'http-unavailable', httpStatus: response.status() }); continue; }
      const length = Number(response.headers()['content-length']);
      if (length > MAX_SOURCE_BYTES) { metadata.push({ chunk, status: 'source-too-large' }); continue; }
      const buffer = await response.body();
      if (buffer.byteLength > MAX_SOURCE_BYTES) { metadata.push({ chunk, status: 'source-too-large' }); continue; }
      const sourceFile = ts.createSourceFile(chunk, buffer.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      for (const frame of selected.filter(item => item.chunk === chunk)) {
        metadata.push({ chunk, line: frame.line, column: frame.column, ...frameSourceMetadata(sourceFile, frame) });
      }
    } catch {
      metadata.push({ chunk, status: 'collection-unavailable' });
    } finally {
      // Playwright retains API response buffers until disposed. Do not keep the
      // complete asset in a cache or diagnostic artifact.
      await response?.dispose().catch(() => undefined);
    }
  }
  return metadata;
}

export function watchHydrationDiagnostics(page, { role, width, stage = 'session-created', emit = record => console.error('Synthetic hydration diagnostic:', JSON.stringify(record)) }) {
  const errors = [], pending = new Set();
  let currentStage = stage;
  let enriched = 0;
  const onError = error => {
    const frames = parseHydrationStack(error.stack);
    const react = /Minified React error #(\d+)/.exec(error.message ?? '');
    const record = {
      role, width, stage: currentStage, path: safeHydrationPath(page.url()),
      name: /^[A-Za-z]+Error$|^Error$/.test(error.name ?? '') ? error.name : 'Error',
      reactError: react ? Number(react[1]) : null,
      mismatch: /args\[\]=HTML/.test(error.message ?? '') ? 'HTML' : /args\[\]=text/.test(error.message ?? '') ? 'text' : null,
      stack: frames.map(frame => `at ${frame.function ?? '<anonymous>'} (${frame.chunk}:${frame.line}:${frame.column})`).join('\n'),
      frames,
      stackStatus: frames.length ? 'local-static-frames' : 'unavailable-or-no-local-static-frames',
      source: [],
      sourceStatus: 'not-requested',
    };
    errors.push(record);
    const collect = async () => {
      if (record.reactError === 418 && frames.length && enriched < MAX_ENRICHED_ERRORS) {
        enriched += 1;
        record.source = await collectFrameMetadata(page.context().request, frames);
        record.sourceStatus = record.source.some(item => item.status === 'available') ? 'collected' : 'unavailable';
      } else if (record.reactError === 418) record.sourceStatus = frames.length ? 'limit-reached' : 'no-eligible-frames';
      emit(record);
    };
    const task = collect().catch(() => { record.sourceStatus = 'collection-unavailable'; });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  page.on('pageerror', onError);
  return {
    errors,
    mark(stage) { currentStage = stage; },
    async flush() { while (pending.size) await Promise.all([...pending]); },
  };
}
