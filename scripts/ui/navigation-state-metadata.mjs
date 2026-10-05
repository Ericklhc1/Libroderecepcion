// QA-only, bounded structural observations. Never serialize user props, model
// values, error messages/stacks, headers, cookies or response bodies.
export function readClientRouterMetadata(expectedBuildId) {
  const safePath = value => {
    try {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin) return '[non-local]';
      const query = new URLSearchParams();
      for (const key of ['clase', 'tipo', 'pagina', 'vista', 'piso']) if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key).slice(0, 60));
      return url.pathname + (query.size ? '?' + query : '');
    } catch { return '[unavailable]'; }
  };
  const isRouterState = value => Boolean(value && typeof value === 'object' && typeof value.canonicalUrl === 'string' && Array.isArray(value.tree) && value.cache && value.pushRef);
  const statusOf = value => {
    if (isRouterState(value)) return { kind: 'router-state', path: safePath(value.canonicalUrl) };
    if (!value || typeof value !== 'object' || typeof value.then !== 'function') return null;
    const status = ['pending', 'blocked', 'resolved_model', 'resolved_module', 'fulfilled', 'rejected', 'halted'].includes(value.status) ? value.status : 'unannotated';
    const result = { kind: 'promise', status };
    if (isRouterState(value.value)) result.path = safePath(value.value.canonicalUrl);
    if (status === 'rejected') result.errorClass = ['Error', 'TypeError', 'AbortError', 'ChunkLoadError', 'SecurityError'].includes(value.reason?.name) ? value.reason.name : 'other';
    return result;
  };
  let root = null;
  for (const node of [document, document.documentElement, document.body]) {
    if (!node) continue;
    const key = Object.getOwnPropertyNames(node).find(name => name.startsWith('__reactContainer$'));
    const fiber = key ? Object.getOwnPropertyDescriptor(node, key)?.value : null;
    if (fiber?.stateNode?.current) { root = fiber.stateNode; break; }
  }
  const readTree = first => {
    const todo = first ? [first] : [];
    const visited = new Set();
    const matches = [];
    while (todo.length && visited.size < 6000 && matches.length < 4) {
      const fiber = todo.pop();
      if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);
      if (fiber.sibling) todo.push(fiber.sibling);
      if (fiber.child) todo.push(fiber.child);
      // Next's Router starts with useActionQueue's useState. Inspect only that
      // hook's state/queue, never memoizedProps, pendingProps or component text.
      const hook = fiber.memoizedState;
      if (!hook || typeof hook !== 'object') continue;
      const values = [hook.memoizedState, hook.baseState, hook.queue?.lastRenderedState];
      if (!values.some(value => isRouterState(value) || isRouterState(value?.value))) continue;
      const pending = [];
      let update = hook.queue?.pending;
      const firstUpdate = update;
      for (let index = 0; update && index < 8; index++) {
        const state = statusOf(update.action);
        if (state) pending.push(state);
        update = update.next;
        if (update === firstUpdate) break;
      }
      matches.push({ state: statusOf(values[0]), base: statusOf(values[1]), lastRendered: statusOf(values[2]), pending, lanes: Number(fiber.lanes) || 0 });
    }
    return { visited: visited.size, matches };
  };
  // __next_f retains only bootstrap records queued before its push callback was
  // installed. If the root row arrived later, explicitly report unavailable.
  let bootstrapBuildMatches = null;
  try {
    const initial = Array.isArray(window.__next_f) ? window.__next_f.filter(row => Array.isArray(row) && row[0] === 1 && typeof row[1] === 'string').map(row => row[1]).join('') : '';
    if (initial.length <= 2_000_000) {
      const row = initial.match(/(?:^|\n)0:(\{[^\n]*\})/);
      if (row) { const model = JSON.parse(row[1]); if (typeof model.b === 'string') bootstrapBuildMatches = model.b === expectedBuildId; }
    }
  } catch { /* No raw payload or error output. */ }
  if (!root) return { available: false, reason: 'react-container-unavailable', bootstrapBuildMatches };
  return {
    available: true,
    bootstrapBuildMatches,
    lanes: { pending: root.pendingLanes, suspended: root.suspendedLanes, pinged: root.pingedLanes, expired: root.expiredLanes },
    current: readTree(root.current),
    alternate: readTree(root.current.alternate),
  };
}

export function summarizeFlightStructure(body, expectedBuildId) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.length > 2_000_000) return { available: false, reason: 'size-limit', bytes: bytes.length };
  const declared = new Set(), references = new Set(), models = [];
  const tags = {};
  const lengthTags = new Set('TAOoUSsLlGgMmV');
  let offset = 0, malformed = 0, errorRows = 0, imports = 0, root = null;
  while (offset < bytes.length && declared.size < 10000) {
    const colon = bytes.indexOf(58, offset);
    if (colon < 0 || colon - offset > 12) { malformed++; break; }
    const id = bytes.toString('ascii', offset, colon);
    if (!/^[0-9a-f]+$/i.test(id)) { malformed++; break; }
    declared.add(id.toLowerCase());
    offset = colon + 1;
    const first = String.fromCharCode(bytes[offset]);
    const tag = /^[A-Z#rx]$/.test(first) || lengthTags.has(first) ? first : 'model';
    if (tag !== 'model') offset++;
    tags[tag] = (tags[tag] || 0) + 1;
    if (tag === 'E') errorRows++;
    if (tag === 'I') imports++;
    if (lengthTags.has(tag)) {
      const comma = bytes.indexOf(44, offset);
      const hex = comma >= offset ? bytes.toString('ascii', offset, comma) : '';
      if (!/^[0-9a-f]+$/i.test(hex)) { malformed++; break; }
      offset = comma + 1 + parseInt(hex, 16);
      if (offset > bytes.length) { malformed++; break; }
      continue;
    }
    const end = bytes.indexOf(10, offset);
    if (end < 0) { malformed++; break; }
    if (tag === 'model' || tag === 'I' || tag === 'E') {
      try {
        const value = JSON.parse(bytes.toString('utf8', offset, end));
        if (tag === 'model' || tag === 'I') models.push(value);
        if (id === '0' && tag === 'model') root = value;
      } catch { malformed++; }
    }
    offset = end + 1;
  }
  let inspected = 0;
  while (models.length && inspected++ < 100000) {
    const value = models.pop();
    if (typeof value === 'string') {
      // Protocol markers are case-sensitive: $F1 refers through server-reference
      // row 1, while $f1 is the ordinary hexadecimal chunk f1.
      const match = value.match(/^\$(?:[L@FQWBKi])?([0-9a-f]+)(?::.*)?$/);
      if (match) references.add(match[1]);
    } else if (Array.isArray(value)) models.push(...value);
    else if (value && typeof value === 'object') models.push(...Object.values(value));
  }
  const rootObject = root && typeof root === 'object' && !Array.isArray(root);
  return {
    available: true, bytes: bytes.length, completeFraming: offset === bytes.length && malformed === 0,
    rowCount: declared.size, tags, malformedRows: malformed, errorRows, importRows: imports,
    rootPresent: Boolean(rootObject),
    rootKeys: rootObject ? Object.keys(root).filter(key => ['b', 'f', 'S', 's', 'q', 'i', 'H', 'p', 'G', 'c', 'm'].includes(key)) : [],
    buildMatches: rootObject && typeof root.b === 'string' ? root.b === expectedBuildId : null,
    flightShape: rootObject ? Array.isArray(root.f) ? 'array' : typeof root.f : 'unavailable',
    flightPatches: rootObject && Array.isArray(root.f) ? root.f.length : null,
    referencedIds: references.size,
    danglingDeclaredIds: [...references].filter(id => !declared.has(id)).length,
    traversalCapped: models.length > 0,
  };
}

export async function readSyntheticFlightInPage({ href, headers }) {
  const url = new URL(href);
  if (location.origin !== 'http://localhost:3000' || url.origin !== location.origin || url.pathname !== '/libro' || url.searchParams.get('clase') !== 'task' || headers.rsc !== '1') return { available: false, reason: 'not-authorized-loopback-target' };
  const allowedHeaders = {};
  for (const key of ['rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url']) if (typeof headers[key] === 'string') allowedHeaders[key] = headers[key];
  const controller = new AbortController();
  let timedOut = false;
  let reader;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
  try {
    const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', redirect: 'error', headers: allowedHeaders, signal: controller.signal });
    if (!response.headers.get('content-type')?.startsWith('text/x-component') || !response.body) return { available: false, reason: 'non-flight-response', status: response.status };
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) return { available: false, reason: 'size-limit', bytes: size };
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    // Transient bytes go only to the Node structural parser, never to logs.
    return { available: true, status: response.status, bodyBytes: Array.from(bytes) };
  } catch (error) {
    return { available: false, reason: timedOut ? 'replay-timeout' : 'replay-failed', errorClass: ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error.name) ? error.name : 'other' };
  } finally {
    clearTimeout(timer);
    controller.abort();
    reader?.releaseLock();
  }
}

export async function replaySyntheticFlight(page, request, expectedBuildId) {
  if (!request) return { available: false, reason: 'target-request-unavailable' };
  const url = new URL(request.url());
  if (url.origin !== 'http://localhost:3000' || url.pathname !== '/libro' || url.searchParams.get('clase') !== 'task' || request.method() !== 'GET') return { available: false, reason: 'not-authorized-loopback-target' };
  const original = request.headers();
  if (original.rsc !== '1') return { available: false, reason: 'not-flight-request' };
  const headers = {};
  for (const key of ['rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-router-segment-prefetch', 'next-url']) if (typeof original[key] === 'string') headers[key] = original[key];
  try {
    const response = await page.evaluate(readSyntheticFlightInPage, { href: url.href, headers });
    if (!response.available) return response;
    return { status: response.status, ...summarizeFlightStructure(Buffer.from(response.bodyBytes), expectedBuildId) };
  } catch (error) {
    return { available: false, reason: 'replay-failed', errorClass: ['Error', 'TypeError', 'TimeoutError'].includes(error.name) ? error.name : 'other' };
  }
}
