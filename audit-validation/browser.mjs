import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const fixtures = JSON.parse(readFileSync('/tmp/browser-fixtures.json', 'utf8'));
const expected = { A: [0,2,3,4], B: [1,3], supervisor: [2,3,4], admin: [2,3,4] };
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, user] of Object.entries(fixtures.users)) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name: 'lor_session', value: user.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/notifications/stream') || url.pathname.startsWith('/api/alarms') || url.pathname.startsWith('/api/auth/pulse')) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      for (const path of ['/seguimientos', '/libro', '/historial', '/buscar?q=BROWSER', `/libro/${fixtures.entryId}`, ...(name === 'admin' ? ['/admin/eliminados'] : [])]) {
        const response = await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200, `${name} ${path} status`);
        assert.ok(!page.url().includes('/login') && !page.url().includes('/aceptar-terminos'), 'Real authenticated session required');
        const html = await response.text();
        if (path === '/seguimientos') {
          for (const i of expected[name]) await page.getByText(fixtures.rows[i].action, { exact: true }).first().waitFor({ state: 'visible' });
        }
        const visible = await page.locator('body').innerText();
        for (const [i, row] of fixtures.rows.entries()) {
          if (!expected[name].includes(i)) {
            assert.ok(!html.includes(row.id) && !html.includes(row.action), `${name} ${path} unauthorized HTML/RSC projection`);
            assert.ok(!visible.includes(row.action), `${name} ${path} unauthorized UI`);
          } else if (path === '/seguimientos') assert.ok(visible.includes(row.action), `${name} positive read ${row.action}`);
        }
        results.push({ actor: name, viewport: viewport.width, path, status: 'passed' });
      }
      const report = await context.request.get('http://127.0.0.1:3000/api/libro/reporte?clase=followup');
      assert.equal(report.status(), 200, `${name} report status: ${await report.text()}`);
      const pdf = (await report.body()).toString('latin1');
      for (const [i, row] of fixtures.rows.entries()) assert.equal(pdf.includes(row.action), expected[name].includes(i), `${name} PDF policy`);
      const unread = await context.request.get('http://127.0.0.1:3000/api/notifications/unread');
      assert.equal(unread.status(), 200);
      assert.equal((await unread.json()).notifications, expected[name].length);
      const payload = await page.evaluate(async endpoint => {
        const response = await fetch('/api/push/payload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
        return { status: response.status, body: await response.json() };
      }, `https://synthetic.invalid/${name}/${viewport.width}`);
      assert.equal(payload.status, 200, `${name} native same-origin payload: ${JSON.stringify(payload.body)}`);
      const json = payload.body;
      assert.equal(json.unread, expected[name].length);
      assert.equal(json.newCount, expected[name].length);
      for (const [i, row] of fixtures.rows.entries()) if (!expected[name].includes(i)) assert.ok(!JSON.stringify(json).includes(row.action) && !JSON.stringify(json).includes(row.id));
      const deleted = await context.request.get('http://127.0.0.1:3000/api/libro/reporte?clase=followup&eliminados=1');
      assert.equal(deleted.status(), name === 'admin' ? 200 : 403, `${name} deleted authorization`);
      results.push({ actor: name, viewport: viewport.width, path: 'report API, real PDF and deleted denial', status: 'passed' });
      await context.close();
    }
  }
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto('http://127.0.0.1:3000/seguimientos');
  assert.ok(page.url().includes('/login'), 'Anonymous route must redirect');
  results.push({ actor: 'anonymous', path: '/seguimientos', status: 'passed' });
  await anonymous.close();
} finally { await browser.close(); writeFileSync('browser-results.json', JSON.stringify({ checks: results.length, results }, null, 2)); }
console.log(`Authenticated synthetic browser checks passed: ${results.length}`);
