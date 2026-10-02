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
