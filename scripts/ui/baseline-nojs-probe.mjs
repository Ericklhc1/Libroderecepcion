import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = '928f57b5fc6823229d160623e6253d4a7ce02fb3';
assert.equal(process.env.BASELINE_SHA, baseline);
const base = 'http://localhost:3101';
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true });
try {
  for (const path of ['/coordinacion', '/admin/housekeeping']) {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled });
      try {
        await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          return url.origin === base && !['/api/notifications/stream', '/api/alarms', '/api/auth/pulse', '/api/chat/stream'].includes(url.pathname) ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        const response = await page.goto(base + path);
        assert.equal(response?.status(), 200);
        assert.equal(new URL(page.url()).pathname, path, 'Synthetic baseline session must pass authentication');
        const heading = page.locator('h1').first();
        await heading.waitFor({ state: javaScriptEnabled ? 'visible' : 'attached' });
        const visible = await heading.isVisible();
        const ancestors = await heading.evaluate(element => {
          const result = [];
          for (let node = element; node && result.length < 12; node = node.parentElement) {
            const style = getComputedStyle(node);
            result.push({ tag: node.tagName, hidden: node.hidden, display: style.display, rects: node.getClientRects().length });
          }
          return result;
        });
        console.log('BASELINE_NOJS_OBSERVATION ' + JSON.stringify({ sha: baseline, buildId: process.env.BASELINE_BUILD_ID, path, javaScriptEnabled, headingVisible: visible, ancestors }));
        if (javaScriptEnabled && path === '/coordinacion') {
          const link = page.locator('a[href^="/coordinacion?"]:visible').first();
          assert.equal(await link.count(), 1, 'Published baseline must expose its existing coordination view link');
          const target = new URL(await link.getAttribute('href'), base);
          const timeOrigin = await page.evaluate(() => performance.timeOrigin);
          let navigated = false;
          let failure = null;
          try {
            await link.click();
            await page.waitForURL(url => url.pathname === target.pathname && url.search === target.search);
            navigated = true;
          } catch (error) { failure = error.name; }
          console.log('BASELINE_SPA_OBSERVATION ' + JSON.stringify({ sha: baseline, buildId: process.env.BASELINE_BUILD_ID, path, expectedQueryKeys: [...target.searchParams.keys()], navigated, sameDocument: (await page.evaluate(() => performance.timeOrigin)) === timeOrigin, failure }));
        }
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
