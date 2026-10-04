// Diagnostics for guarded synthetic loopback journeys only. Never log cookies,
// headers, response bodies, user-entered text or arbitrary query parameters.
export function watchSyntheticNavigation(page) {
  const events = [];
  const safePath = value => {
    const url = new URL(value);
    if (url.origin !== 'http://localhost:3000') return null;
    const query = new URLSearchParams();
    for (const key of ['clase', 'tipo', 'pagina', 'vista']) {
      const value = url.searchParams.get(key);
      if (value) query.set(key, value.slice(0, 60));
    }
    return url.pathname + (query.size ? '?' + query : '');
  };
  const record = event => { events.push(event); if (events.length > 24) events.shift(); };
  const navigationRequest = request => {
    const url = new URL(request.url());
    return request.method() === 'GET' && url.origin === 'http://localhost:3000' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/');
  };
  page.on('request', request => { if (navigationRequest(request)) record({ kind: 'request', path: safePath(request.url()), resource: request.resourceType(), rsc: new URL(request.url()).searchParams.has('_rsc') }); });
  page.on('response', response => { if (navigationRequest(response.request())) record({ kind: 'response', path: safePath(response.url()), status: response.status() }); });
  page.on('requestfailed', request => { if (navigationRequest(request)) record({ kind: 'failed', path: safePath(request.url()), error: request.failure()?.errorText?.slice(0, 160) }); });
  page.on('pageerror', error => record({ kind: 'pageerror', name: error.name, message: error.message.slice(0, 500) }));
  return async stage => {
    const state = await page.evaluate(() => ({ readyState: document.readyState, scrollY, dialogs: document.querySelectorAll('[role="dialog"]').length })).catch(() => null);
    console.error('Synthetic navigation failure:', JSON.stringify({ stage, width: page.viewportSize()?.width, path: safePath(page.url()), state, events }));
  };
}
