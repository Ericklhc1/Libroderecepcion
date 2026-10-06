/** Lightweight browser check of real navigation components. No Next server, DB, session or hotel data. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'aroh-compact-nav-'));
const output = process.env.NAV_QA_OUTPUT || temp;
mkdirSync(output, { recursive: true });
const navigationMock = `import {useSyncExternalStore} from 'react';
const subscribe = fn => { window.addEventListener('popstate', fn); return () => window.removeEventListener('popstate', fn); };
const current = () => location.protocol === 'file:' ? new URL(location.hash.slice(1) || '/libro?clase=entry&tipo=INCIDENCIA', 'http://synthetic.invalid') : location;
export const usePathname = () => useSyncExternalStore(subscribe, () => current().pathname);
export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(subscribe, () => current().search));`;
const linkMock = `import React from 'react'; export default function Link({href, onClick, children, ...props}) {
return <a {...props} href={href} onClick={event => { onClick?.(event); if(event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
event.preventDefault(); history.pushState({}, '', location.protocol === 'file:' ? '#' + href : href); window.dispatchEvent(new PopStateEvent('popstate')); }}>{children}</a>; }`;
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {DesktopNav, MobileNav} from '${root}/src/components/layout/nav';
import {FrontiLauncher, AccountMenu} from '${root}/src/components/layout/topbar-menus';
import {AppearanceProvider} from '${root}/src/components/appearance/appearance-provider';
import {visibleNavGroups} from '${root}/src/components/layout/nav-items';
import {ROLE_PERMISSIONS, ROLE_KEYS} from '${root}/src/lib/permissions';
const isHk = new URLSearchParams(location.search).has('housekeeping');
const groups = visibleNavGroups(ROLE_PERMISSIONS[isHk ? ROLE_KEYS.HK_ATTENDANT : ROLE_KEYS.SYSTEM_ADMIN], !isHk);
window.allowedGroups = groups;
createRoot(document.getElementById('root')).render(<AppearanceProvider>
<header className="aroh-topbar sticky top-0 z-30 border-b">
<div className="flex flex-wrap items-center gap-3 px-4 py-2"><div className="min-w-0 shrink-0"><span className="block text-sm font-semibold text-petrol-950">AROH <span className="text-gold-600">Central IA</span></span><span className="text-xs text-petrol-700">Hotel de prueba</span></div><input className="input-base min-w-0 flex-1" aria-label="Búsqueda global" placeholder="Buscar…"/><FrontiLauncher displayName="Fronti"/><AccountMenu userName="Cuenta de prueba" roleName="Rol sintético" initialsText="CP"/></div>
<div className="px-4 pb-2 text-xs text-petrol-700">Muestra local · datos sintéticos</div>
<DesktopNav groups={groups}/><MobileNav items={groups.flatMap(group => group.items)} groups={groups} hotelName="Hotel de prueba" roleName="Rol sintético"/>
</header><main className="mx-auto max-w-7xl space-y-4 p-4"><section className="card p-4"><h1>Prueba aislada de navegación</h1><p className="mt-2 text-sm text-slate-600">Componentes reales de la cabecera. No conecta con la operación del hotel.</p><button className="mt-4 min-h-11 rounded-md bg-petrol-800 px-4 text-white">Acción de ejemplo</button></section><div style={{height:900}}/></main>
</AppearanceProvider>);`;
await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, outfile: join(temp, 'app.js'), jsx: 'automatic', platform: 'browser', nodePaths: [resolve('node_modules')], plugins: [{ name: 'navigation-fixture', setup(plugin) {
  plugin.onResolve({filter: /^(next\/navigation|next\/link|@\/server\/actions\/auth)$/}, args => ({path: args.path, namespace: 'fixture'}));
  plugin.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: args.path === 'next/navigation' ? navigationMock : args.path === 'next/link' ? linkMock : 'export async function logoutAction() { throw new Error("No actions in navigation fixture"); }', loader: 'tsx', resolveDir: root}));
}}] });
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-c', 'tailwind.config.ts', '-i', 'src/app/globals.css', '-o', join(temp, 'app.css')], {stdio:'pipe'});
const html = '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navegación AROH · prueba aislada</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
writeFileSync(join(output, 'isolated-preview.html'), html
  .replace('<link rel="stylesheet" href="/app.css">', () => '<style>' + readFileSync(join(temp, 'app.css'), 'utf8') + '</style>')
  .replace('<script src="/app.js"></script>', () => '<script>' + readFileSync(join(temp, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script') + '</script>'));
if (process.env.NAV_QA_BUILD_ONLY === '1') { console.log('Synthetic preview built: ' + join(output, 'isolated-preview.html')); process.exit(0); }
const server = createServer((request,response) => { const pathname = new URL(request.url, 'http://localhost').pathname; response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html'); response.end(pathname === '/app.js' || pathname === '/app.css' ? readFileSync(join(temp, pathname.slice(1))) : html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
const focused = locator => locator.evaluate(node => node === document.activeElement);
try {
  browser = await chromium.launch({headless:true, env:{...process.env, XDG_CONFIG_HOME:join(temp,'config')}, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  for (const width of [1280, 1024, 390, 320]) {
    const context = await browser.newContext({viewport:{width,height:900}, colorScheme:'light', reducedMotion:'reduce'});
    await context.route('**/*', route => new URL(route.request().url()).origin === base && route.request().method() === 'GET' ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/libro?clase=entry&tipo=INCIDENCIA');
    const desktop = width >= 1024;
    const trigger = desktop ? page.getByRole('button', {name:'Operación',exact:true}) : page.getByRole('button', {name:'Más',exact:true});
    const panel = desktop ? page.locator('[aria-label="Accesos de Operación"]') : page.getByRole('dialog',{name:'Todo el menú'});
    if (desktop) { await trigger.focus(); await page.keyboard.press('ArrowDown'); }
    else await trigger.click();
    await panel.waitFor();
    if (desktop) {
      assert.ok(await focused(panel.locator('a').first()));
      await page.keyboard.press('End'); assert.ok(await focused(panel.locator('a').last()));
      await page.keyboard.press('Home'); assert.ok(await focused(panel.locator('a').first()));
      assert.equal(await panel.locator('a').count(),10);
      assert.ok((await panel.boundingBox()).height < 560, 'Root catalogue is compact with the current ten-module inventory');
    } else {
      assert.equal(await page.locator('[data-module-navigation="mobile"] button').count(),0);
      assert.ok(await focused(panel.getByRole('button',{name:'Cerrar',exact:true})));
      await page.keyboard.press('Shift+Tab'); assert.ok(await focused(panel.getByRole('button',{name:'Cerrar sesión',exact:true})));
      await page.keyboard.press('Tab'); assert.ok(await focused(panel.getByRole('button',{name:'Cerrar',exact:true})));
      const box = await panel.boundingBox(); const quick = await page.getByRole('navigation',{name:'Navegación rápida'}).boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= quick.y + 1);
    }
    assert.equal(await panel.getByRole('link',{name:'Incidencias',exact:true}).count(),0);
    assert.equal(await panel.locator('a[href="/libro?clase=entry"]').count(),1);
    if (width === 1280 || width === 390) await page.screenshot({path:join(output,`navigation-${width}-light.png`)});
    const views = panel.getByRole('button',{name:'Vistas de Novedades',exact:true});
    await views.click();
    assert.equal(await panel.locator('a[aria-current="page"]').getAttribute('href'),'/libro?clase=entry&tipo=INCIDENCIA');
    assert.equal(await panel.locator('a[href="/libro?clase=entry"]').count(),1);
    await views.click(); assert.equal(await panel.getByRole('link',{name:'Incidencias',exact:true}).count(),0);
    await views.click(); await panel.getByRole('link',{name:'Mis tareas',exact:true}).click();
    await panel.waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).search,'?clase=task');
    await page.goBack(); await panel.waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).searchParams.get('tipo'),'INCIDENCIA');
    await page.goForward(); await panel.waitFor({state:'hidden'});
    await trigger.click(); await page.keyboard.press('Escape'); await panel.waitFor({state:'hidden'}); assert.ok(await focused(trigger));
    if (desktop) {
      await trigger.click(); await page.keyboard.press('Tab'); assert.ok(await focused(panel.getByRole('button',{name:'Cerrar accesos'})));
      await page.keyboard.press('Shift+Tab'); await panel.waitFor({state:'hidden'}); assert.ok(await focused(trigger));
      await trigger.click(); await page.getByRole('textbox',{name:'Búsqueda global'}).click(); await panel.waitFor({state:'hidden'});
      await trigger.click(); await page.setViewportSize({width:1023,height:900}); await panel.waitFor({state:'hidden'});
      await page.setViewportSize({width,height:900});
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await trigger.click();
    if (width === 1280 || width === 390) await page.screenshot({path:join(output,`navigation-${width}-dark.png`)});
    await page.keyboard.press('Escape'); assert.ok(await focused(trigger));
    assert.equal(await trigger.evaluate(node => getComputedStyle(node).outlineStyle),'solid');
    assert.deepEqual(errors,[]);
    results.push({width,rootsUnique:true,secondaryClosed:true,queryAndHistory:true,keyboard:true,focusReturn:true,noOverflow:true,dark:true});
    await context.close();
  }
  const page = await browser.newPage({viewport:{width:390,height:900}});
  await page.goto(base + '/housekeeping?housekeeping=1');
  await page.getByRole('button',{name:'Más',exact:true}).click();
  const panel = page.getByRole('dialog',{name:'Todo el menú'});
  await panel.getByRole('link',{name:'Equipo y horarios',exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'Vistas de Equipo y horarios',exact:true}).count(),0);
  assert.equal(await panel.locator('a[href="/caja"]').count(),0);
  results.push({role:'HK_ATTENDANT',teamRootReachable:true,noEmptyDisclosure:true,restrictedRoutesAbsent:true});
  console.log(JSON.stringify({status:'passed',scope:'isolated real components; no Next server or database',results,output},null,2));
} finally {
  writeFileSync(join(output,'results.json'),JSON.stringify({results},null,2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
