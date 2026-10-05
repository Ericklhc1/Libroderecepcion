// Diagnostics for guarded synthetic loopback journeys only. Never log cookies,
// raw headers, response bodies, user-entered text or arbitrary query parameters.
export async function watchSyntheticNavigation(page) {
  const events = [];
  const started = Date.now();
  const ids = new WeakMap();
  let nextId = 0;
  let expected = null;
  const safePath = value => {
    try {
      const url = new URL(value, 'http://localhost:3000');
      if (url.origin !== 'http://localhost:3000') return null;
      const query = new URLSearchParams();
      for (const key of ['clase', 'tipo', 'pagina', 'vista', 'piso']) {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value.slice(0, 60));
      }
      return url.pathname + (query.size ? '?' + query : '');
    } catch { return null; }
  };
  const record = event => { events.push({ ms: Date.now() - started, ...event }); if (events.length > 64) events.shift(); };
  const navigationRequest = request => {
    const url = new URL(request.url());
    return request.method() === 'GET' && url.origin === 'http://localhost:3000' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/');
  };
  const requestState = request => {
    if (!ids.has(request)) ids.set(request, ++nextId);
    return { id: ids.get(request), path: safePath(request.url()) };
  };
  page.on('request', request => {
    if (navigationRequest(request)) record({ kind: 'request', ...requestState(request), resource: request.resourceType(), rsc: new URL(request.url()).searchParams.has('_rsc'), rscHeader: request.headers().rsc === '1', prefetch: request.headers()['next-router-prefetch'] === '1' });
  });
  page.on('response', response => {
    if (!navigationRequest(response.request())) return;
    const contentType = response.headers()['content-type']?.split(';', 1)[0];
    record({ kind: 'response', ...requestState(response.request()), status: response.status(), mime: ['text/x-component', 'text/html', 'application/json', 'text/plain'].includes(contentType) ? contentType : 'other', postponed: Boolean(response.headers()['x-nextjs-postponed']) });
  });
  page.on('requestfinished', request => {
    if (navigationRequest(request)) record({ kind: 'finished', ...requestState(request), responseEnd: Math.round(request.timing().responseEnd) });
  });
  page.on('requestfailed', request => {
    if (navigationRequest(request)) record({ kind: 'failed', ...requestState(request), responseEnd: Math.round(request.timing().responseEnd), error: request.failure()?.errorText?.slice(0, 160) });
    else if (new URL(request.url()).pathname.startsWith('/_next/') && safePath(request.url())) record({ kind: 'chunk-failed', path: safePath(request.url()), error: request.failure()?.errorText?.slice(0, 160) });
  });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) record({ kind: 'frame', path: safePath(frame.url()) }); });
  page.on('pageerror', error => record({ kind: 'pageerror', name: error.name, message: error.message.replace(/https?:\/\/[^\s)]+/g, value => safePath(value) ?? '[non-local URL]').slice(0, 500) }));
  page.on('console', message => {
    const value = message.text();
    if (/^AROH_NAV_LIFECYCLE (pageshow|pagehide|popstate) (true|false)$/.test(value)) record({ kind: 'lifecycle', event: value.split(' ')[1], persisted: value.endsWith('true') });
    if (message.type() !== 'error') return;
    const match = value.match(/Failed to fetch RSC payload for (.+?)\. Falling back to browser navigation\./);
    if (match) record({ kind: 'rsc-fallback', path: safePath(match[1]), failure: /AbortError/.test(value) ? 'AbortError' : /Connection closed/.test(value) ? 'Connection closed' : /TypeError/.test(value) ? 'TypeError' : 'other' });
  });
  // Observe lifecycle only; do not patch fetch, AbortController, history or React.
  await page.addInitScript(() => {
    for (const type of ['pageshow', 'pagehide', 'popstate']) {
      window.addEventListener(type, event => console.debug('AROH_NAV_LIFECYCLE ' + type + ' ' + String(Boolean(event.persisted))));
    }
  });
  const report = async stage => {
    const state = await page.evaluate(() => ({
      readyState: document.readyState,
      scrollY,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      documentTimeOrigin: performance.timeOrigin,
      resources: performance.getEntriesByType('resource')
        .filter(entry => new URL(entry.name).origin === location.origin && new URL(entry.name).searchParams.has('_rsc')).slice(-16)
        .map(entry => ({ url: entry.name, duration: Math.round(entry.duration), responseEnd: Math.round(entry.responseEnd), transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })),
    })).catch(() => null);
    if (state) state.resources = state.resources.map(({ url, ...timing }) => ({ path: safePath(url), ...timing }));
    console.error('Synthetic navigation failure:', JSON.stringify({ stage, width: page.viewportSize()?.width, path: safePath(page.url()), expected, state, events }));
  };
  report.mark = (stage, href) => { expected = safePath(href); record({ kind: 'activate', stage, expected }); };
  return report;
}
