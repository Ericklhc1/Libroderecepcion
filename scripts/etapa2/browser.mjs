import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for (const width of [1280,390]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addCookies([{name:'lor_session',value:f.users.admin.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
  await page.goto('http://localhost:3000/fronti/procedimientos');
  await page.getByRole('heading',{name:'Procedimientos de Fronti',exact:true}).waitFor();
  const key=randomUUID();const message=`Crea una tarea: ETAPA2_FRONTI_${width}`;
  const started=performance.now();
  const response=await context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message,requestKey:key}});
  const body=await response.json();const elapsed=Math.round(performance.now()-started);
  assert.equal(response.status(),200,body.error);assert.match(body.reply,/SUCCEEDED/);
  assert.ok(elapsed<=2000,`Fronti exact command took ${elapsed} ms; budget 2000 ms`);
  const href=/\/fronti\/procedimientos\?ejecucion=[a-z0-9]+/.exec(body.reply)?.[0];assert.ok(href);
  const retry=await context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message,requestKey:key}});assert.equal(retry.status(),200);assert.ok((await retry.json()).reply.includes(href));
  await page.goto('http://localhost:3000'+href);await page.getByRole('heading',{name:'Resultado: Completado',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.getByRole('button',{name:'Abrir Fronti',exact:true}).first().click();
  const panel=page.getByRole('region',{name:'Fronti',exact:true});
  await panel.getByRole('textbox',{name:'Mensaje para Fronti',exact:true}).fill(`Crea una tarea: ETAPA2_CHAT_${width}`);
  const visibleStart=performance.now();
  const [uiResponse]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/fronti'),panel.getByRole('button',{name:'Enviar a Fronti',exact:true}).click()]);
  const uiBody=await uiResponse.json();assert.equal(uiResponse.status(),200,uiBody.error);assert.match(uiBody.reply,/SUCCEEDED/);
  const uiId=/ejecucion=([a-z0-9]+)/.exec(uiBody.reply)?.[1];assert.ok(uiId);
  await panel.getByText(new RegExp(uiId)).waitFor();
  const visibleMs=Math.round(performance.now()-visibleStart);assert.ok(visibleMs<=3000,`Fronti visible result took ${visibleMs} ms; budget 3000 ms`);
  results.push({width,scenario:'actual-chat-input-to-visible-result',ms:visibleMs,budgetMs:3000,status:'passed',provider:'not-used'});
  await panel.getByRole('button',{name:'Minimizar Fronti',exact:true}).click();
  const summary=await context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:'/resumen',requestKey:randomUUID()}});assert.equal(summary.status(),200);assert.match((await summary.json()).reply,/Coordinación: \/coordinacion/);
  await page.goto('http://localhost:3000/coordinacion/automatizaciones');await page.getByRole('heading',{name:'Reglas y procedimientos',exact:true}).waitFor();assert.ok((await page.locator('body').innerText()).includes('deshabilitada'));
  results.push({width,scenario:'authenticated-exact-command-retry-private-history-summary-paused-rules',ms:elapsed,budgetMs:2000,status:'passed',provider:'not-used'});await context.close();
 }
 console.log('Etapa 2 authenticated Fronti desktop/mobile journeys passed.');
} finally {writeFileSync('etapa2-browser-results.json',JSON.stringify({results,physicalSafari:false},null,2));await browser.close();}
