import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { watchSyntheticNavigation } from './navigation-diagnostics.mjs';

const base = 'http://localhost:3000';
const blockedPolls = ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'];

export function isBlockedSyntheticRequest(value) {
  const url = new URL(value);
  return url.origin !== base || blockedPolls.some(path => url.pathname.startsWith(path));
}

// The proxy cannot forward: it has no upstream request/connect implementation.
// Both treatments share it; only the synthetic localhost origin bypasses it.
export function createDenyProxy() {
  let denied = 0;
  const sockets = new Set();
  const server = createServer((_request, response) => {
    denied += 1;
    response.writeHead(403, { Connection: 'close', 'Content-Length': '0' });
    response.end();
  });
  server.on('connect', (_request, socket) => {
    denied += 1;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('upgrade', (_request, socket) => { denied += 1; socket.destroy(); });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  return {
    server,
    count: () => denied,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

export async function configureSyntheticTransport(context, page, routed) {
  // Both cases have empty per-context caches and the same cache-disabled state.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (routed) {
    await context.route('**/*', route => isBlockedSyntheticRequest(route.request().url()) ? route.abort() : route.continue());
  } else {
    // Network-domain blocking leaves Fetch interception disabled. The deny proxy
    // remains the outer egress boundary, including CONNECT tunnels.
    await cdp.send('Network.setBlockedURLs', { urls: blockedPolls.map(path => base + path + '*') });
  }
  return cdp;
}

async function main() {
  await import('../etapa1/guard.cjs');
  const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
  const proxy = createDenyProxy();
  let browser;
  let stage = 'deny-proxy-start';
  const outcomes = [];
  try {
    await new Promise((resolve, reject) => {
      proxy.server.once('error', reject);
      proxy.server.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.server.address();
    assert.ok(address && typeof address !== 'string');
    stage = 'browser-start';
    browser = await chromium.launch({
      headless: true,
      proxy: { server: `http://127.0.0.1:${address.port}`, bypass: '<-loopback>,localhost:3000' },
    });
    for (const routed of [true, false]) {
      const mode = routed ? 'A-context-route' : 'B-network-domain';
      stage = mode + '-context';
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.setDefaultNavigationTimeout(12000);
        stage = mode + '-egress-sentinel';
        const denialsBefore = proxy.count();
        const denied = await page.goto('http://aroh-egress-sentinel.invalid/');
        assert.equal(denied?.status(), 403, 'The local proxy must reject the reserved external sentinel');
        assert.ok(proxy.count() > denialsBefore, 'The rejection must come from the non-forwarding local proxy');
        console.log('NAVIGATION_TRANSPORT_EGRESS ' + JSON.stringify({ mode, sentinelStatus: 403, localProxyRejected: true }));
        await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
        await configureSyntheticTransport(context, page, routed);
        const report = await watchSyntheticNavigation(page);
        stage = mode + '-source';
        await page.goto(base + '/libro?clase=entry&tipo=INCIDENCIA');
        assert.equal(new URL(page.url()).pathname, '/libro', 'Synthetic session must pass authentication');
        const nav = page.getByRole('navigation', { name: 'Módulos', exact: true });
        await nav.getByRole('button', { name: 'Operación', exact: true }).click();
        const panel = page.locator('[aria-label="Accesos de Operación"]');
        const link = panel.getByRole('link', { name: 'Mis tareas', exact: true });
        assert.equal(await link.getAttribute('href'), '/libro?clase=task');
        const origin = await page.evaluate(() => performance.timeOrigin);
        const start = Date.now();
        let navigated = false;
        let failure = null;
        stage = mode + '-activation';
        report.mark(stage, '/libro?clase=task');
        try {
          await link.click();
          await page.waitForURL(url => url.pathname === '/libro' && url.searchParams.get('clase') === 'task');
          navigated = true;
        } catch (error) {
          failure = error.name;
          await report(stage);
        }
        const sameDocument = (await page.evaluate(() => performance.timeOrigin)) === origin;
        outcomes.push({ mode, navigated, sameDocument, failure, elapsedMs: Date.now() - start, path: new URL(page.url()).pathname, timeoutMs: 12000 });
        console.log('NAVIGATION_TRANSPORT_OBSERVATION ' + JSON.stringify(outcomes.at(-1)));
      } finally { await context.close(); }
    }
    console.log('NAVIGATION_TRANSPORT_COMPARISON ' + JSON.stringify({ outcomes, proxyDenials: proxy.count(), applicationChanged: false }));
    assert.ok(outcomes.every(result => result.navigated && result.sameDocument), 'Transport probe retains real SPA success requirements in both cases');
  } catch (error) {
    // The existing journeys remain the gates. This probe also fails explicitly;
    // diagnostics never print a session token, a response body or an error stack.
    console.error('NAVIGATION_TRANSPORT_PROBE_FAILED ' + JSON.stringify({ stage, name: error.name, outcomes }));
    process.exitCode = 1;
  } finally {
    try { await browser?.close(); } finally { await proxy.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
