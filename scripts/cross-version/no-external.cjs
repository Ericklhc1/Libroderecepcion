'use strict';
// Supplement the existing HTTP guard with raw socket checks (SMTP/TLS).
// Used only by the disposable runner, never loaded by the application itself.
require('../etapa1/guard.cjs');
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const allowed = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function deny() {
  if (process.env.CROSS_VERSION_NETWORK_LOG) fs.appendFileSync(process.env.CROSS_VERSION_NETWORK_LOG, 'blocked-external-request\n');
  throw new Error('External request blocked by synthetic cross-version guard');
}
function checkHttp(value) {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  if (!allowed.has(url.hostname)) deny();
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => { checkHttp(args[0]); return originalFetch(...args); };
for (const name of ['node:http', 'node:https']) {
  const client = require(name);
  for (const method of ['request', 'get']) {
    const original = client[method];
    client[method] = function (...args) {
      const first = args[0];
      if (typeof first === 'string' || first instanceof URL) checkHttp(first);
      else if (!allowed.has(first.hostname || first.host || 'localhost')) deny();
      return original.apply(this, args);
    };
  }
}
function check(args) {
  const first = args[0];
  // Internal Node calls may pass normalizeArgs' [options, callback] pair.
  const options = Array.isArray(first) ? first[0] : first;
  if (options && typeof options === 'object' && options.path) return; // Playwright pipe
  const host = options && typeof options === 'object' ? options.host || options.hostname || 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!allowed.has(host)) deny();
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { check(args); return connect.apply(this, args); };
const tlsConnect = tls.connect;
tls.connect = function (...args) { check(args); return tlsConnect.apply(this, args); };
