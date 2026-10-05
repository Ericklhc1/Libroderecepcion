function allowed(value) {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External HTTP intercepted by isolated audit');
}
const fetch = globalThis.fetch;
globalThis.fetch = (...args) => { allowed(args[0]); return fetch(...args); };
for (const name of ['node:http', 'node:https']) {
  const client = require(name);
  for (const method of ['request', 'get']) {
    const original = client[method];
    client[method] = function(...args) {
      const first = args[0];
      if (typeof first === 'string' || first instanceof URL) allowed(first);
      else if (!['127.0.0.1', 'localhost', '::1'].includes(first.hostname || first.host || 'localhost')) throw new Error('External HTTP intercepted by isolated audit');
      return original.apply(this, args);
    };
  }
}

// Synthetic harness only: log transport timings, never headers, bodies or identities.
const responsePrototype = require('node:http').ServerResponse.prototype;
for (const method of ['write', 'end']) {
  const original = responsePrototype[method];
  responsePrototype[method] = function (...args) {
    const pathname = this.req?.url?.split('?', 1)[0];
    if (this.req?.method === 'GET' && this.req.headers.rsc === '1' && ['/libro', '/coordinacion', '/novedades/habitacion'].includes(pathname)) {
      if (!this.__auditRsc) {
        const url = new URL(this.req.url, 'http://localhost');
        const query = new URLSearchParams();
        for (const key of ['clase', 'tipo', 'pagina', 'piso']) {
          if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key).slice(0, 60));
        }
        this.__auditRsc = { start: Date.now(), path: pathname + (query.size ? '?' + query : ''), bytes: 0 };
        console.log('[synthetic-rsc-transport]', 'start', this.__auditRsc.path, this.statusCode);
        for (const event of ['finish', 'close']) this.once(event, () => console.log('[synthetic-rsc-transport]', JSON.stringify({ event, path: this.__auditRsc.path, ms: Date.now() - this.__auditRsc.start, bytes: this.__auditRsc.bytes, status: this.statusCode, finished: this.writableFinished })));
      }
      this.__auditRsc.bytes += typeof args[0] === 'string' ? Buffer.byteLength(args[0]) : args[0]?.length ?? 0;
    }
    if (this.req?.method === 'POST' && this.req.url?.startsWith('/coordinacion')) {
      if (!this.__auditStartedAt) {
        this.__auditStartedAt = Date.now();
        for (const event of ['finish', 'close']) this.once(event, () => console.log('[etapa2-timing]', event, Date.now() - this.__auditStartedAt, this.writableFinished));
      }
      const bytes = typeof args[0] === 'string' ? Buffer.byteLength(args[0]) : args[0]?.length ?? 0;
      console.log('[etapa2-timing]', method, Date.now() - this.__auditStartedAt, bytes);
    }
    return original.apply(this, args);
  };
}
