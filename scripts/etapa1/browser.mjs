import './guard.cjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const browser=await chromium.launch({headless:true});
console.log("Synthetic browser",browser.version());
const results=[];const timings=[];let activePage;const streams=new Map();const inFlight=new Map();
function persist(){writeFileSync('etapa1-browser-results.json',JSON.stringify({browser:browser.version(),results,timings},null,2));}
async function measured(label,work){const start=performance.now();try{const result=await work();if(/^(assign|resolve) visible/.test(label))assert.ok(performance.now()-start<=3000,`${label} exceeds visible update budget of 3000 ms`);return result;}finally{const ms=Math.round(performance.now()-start);timings.push({label,ms});console.log('Timing',label,ms);}}
async function submit(page,button){
 const started=performance.now();
 const path=new URL(page.url()).pathname;
 const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===path).then(response=>{timings.push({label:'POST headers '+path,ms:Math.round(performance.now()-started)});console.log('POST headers',path,Math.round(performance.now()-started));persist();return response;});
 await button.click({noWaitAfter:true});
 const response=await pending;assert.ok(response.ok(),'Server action response succeeds');
 const observation={label:'POST body completion '+path,ms:null,status:'pending'};timings.push(observation);persist();
 // Observe body completion separately. UI latency is measured from click to actual DOM state.
 void response.finished().then(error=>{observation.ms=Math.round(performance.now()-started);observation.status=error?'aborted':'completed';persist();}).catch(()=>{observation.status='unavailable';persist();});
}
async function actor(name,width){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addCookies([{name:'lor_session',value:f.users[name].token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});
 const page=await context.newPage();
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');const posts=new Set();
 cdp.on('Network.requestWillBeSent',e=>{inFlight.set(e.requestId,{method:e.request.method,path:new URL(e.request.url).pathname});if(e.request.method==='POST'&&new URL(e.request.url).pathname==='/coordinacion')posts.add(e.requestId);});
 cdp.on('Network.responseReceived',async e=>{if(posts.has(e.requestId)){try{const s=await cdp.send('Network.streamResourceContent',{requestId:e.requestId});streams.set(e.requestId,[s.bufferedData]);}catch{console.log('CDP body diagnostics unavailable');}}});
 cdp.on('Network.dataReceived',e=>{if(posts.has(e.requestId)&&e.data){const list=streams.get(e.requestId)??[];list.push(e.data);streams.set(e.requestId,list);}});
 cdp.on('Network.loadingFinished',e=>{inFlight.delete(e.requestId);if(posts.has(e.requestId))console.log('POST stream finished',e.encodedDataLength);});
 cdp.on('Network.loadingFailed',e=>{if(posts.has(e.requestId))console.log('POST transport failure',e.errorText,e.canceled);inFlight.delete(e.requestId);});
 page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);page.on('pageerror',error=>console.error('Browser page error:',error.message));return {context,page};
}
try{
 for(const [index,width] of [1280,390].entries()){
  console.log('Starting synthetic viewport',width);const t=f.tasks[index];const admin=await actor('admin',width);const worker=await actor('worker',width);
  activePage=admin.page;const response=await measured(`navigation coordinator ${width}`,()=>admin.page.goto(`http://localhost:3000/coordinacion?area=${f.areaId}`));
  assert.equal(response.status(),200);assert.equal(new URL(admin.page.url()).pathname,'/coordinacion','Synthetic session must pass real authentication');
  await admin.page.getByRole('heading',{name:'Coordinación y continuidad',exact:true}).waitFor();
  console.log('Coordinator heading visible',width);
  if(width===1280){
    await admin.page.getByRole('button',{name:'Reducir barra lateral a iconos',exact:true}).click();
    assert.equal(await admin.page.locator('aside nav a').count(),1,'Compact sidebar shows group controls, not every module');
    await admin.page.locator('aside').getByRole('button',{name:'Operación',exact:true}).click();
    await admin.page.locator('[aria-label="Opciones de Operación"]').waitFor();
    await admin.page.keyboard.press('Escape');
    await admin.page.locator('[aria-label="Opciones de Operación"]').waitFor({state:'hidden'});
    await admin.page.getByRole('button',{name:'Ampliar barra lateral',exact:true}).click();
  }else{
    await admin.page.getByRole('button',{name:'Más',exact:true}).click();
    const menu=admin.page.getByRole('dialog',{name:'Todo el menú'});await menu.waitFor();
    const box=await menu.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<900,'Mobile menu remains above bottom navigation');
    await menu.getByRole('button',{name:'Cerrar',exact:true}).click();await menu.waitFor({state:'hidden'});
  }
  console.log('Navigation controls verified',width);
  const card=admin.page.locator('article').filter({hasText:t.title});
  await card.getByText('Recepción, siguiente acción y relevo',{exact:true}).click();
  await card.locator('select[name="ownerId"]').selectOption(f.users.worker.id);
  await card.locator('textarea[name="nextAction"]').fill('Atender y registrar resultado sintético');
  await measured(`assign visible ${width}`,async()=>{await submit(admin.page,card.getByRole('button',{name:'Asignar y solicitar recepción',exact:true}));await card.locator('strong').filter({hasText:/^Etapa1 worker$/}).waitFor();});console.log('Assignment visible',width);
  activePage=worker.page;await worker.page.goto(`http://localhost:3000/coordinacion?area=${f.areaId}&mios=1`);
  assert.ok(!(await worker.page.content()).includes('ETAPA1_PRIVATE_TASK'));
  const own=worker.page.locator('article').filter({hasText:t.title});
  await own.getByText('Recepción, siguiente acción y relevo',{exact:true}).click();
  await submit(worker.page,own.getByRole('button',{name:'Confirmar recepción',exact:true}));
  await own.getByRole('button',{name:'Guardar siguiente acción',exact:true}).waitFor();console.log('Receipt visible',width);
  assert.ok(await worker.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal mobile overflow');
  await measured(`navigation task ${width}`,()=>worker.page.goto(`http://localhost:3000/tareas/${t.id}`));
  await measured(`resolve visible ${width}`,async()=>{await submit(worker.page,worker.page.getByRole('button',{name:'Resolver',exact:true}));await worker.page.getByText('Completada',{exact:true}).first().waitFor();});console.log('Resolution visible',width);
  await worker.page.goto(`http://localhost:3000/coordinacion?area=${f.areaId}&historial=1`);
  await worker.page.locator('article').filter({hasText:t.title}).waitFor();
  const maid=await actor('maid',width);await maid.page.goto('http://localhost:3000/coordinacion');
  assert.ok(!(await maid.page.content()).includes(t.title),'Area-only account cannot read reception work');
  results.push({width,flow:'assign-receive-resolve-original-source',privacy:'passed',mobileOverflow:'passed'});
  await admin.context.close();await worker.context.close();await maid.context.close();
 }
 const anon=await browser.newContext();const page=await anon.newPage();await page.goto('http://localhost:3000/coordinacion');assert.ok(page.url().includes('/login'));await anon.close();
 console.log('Etapa 1 authenticated desktop/mobile journeys passed.');
}catch(error){
 for(const chunks of streams.values()) {const data=Buffer.concat(chunks.map(c=>Buffer.from(c,'base64'))).toString('utf8');const rows=[...data.matchAll(/(?:^|\n)([0-9a-f]+):/g)].map(m=>m[1]);const refs=[...data.matchAll(/\$(?:L|@)?([0-9a-f]+)(?:["\n:])/g)].map(m=>m[1]);console.log('Synthetic Flight structure',JSON.stringify({bytes:Buffer.byteLength(data),rows,missingRefs:[...new Set(refs.filter(r=>!rows.includes(r)))],hasActionResult:/1:\{"ok":true/.test(data)}));}
 console.log('Requests still in progress (paths only)',JSON.stringify([...inFlight.values()]));
 if(activePage)console.error('Synthetic browser failure',activePage.url(),(await activePage.locator('body').innerText()).slice(0,6500));throw error;}finally{writeFileSync('etapa1-browser-results.json',JSON.stringify({browser:browser.version(),results,timings},null,2));console.log('Synthetic timings',JSON.stringify(timings));await browser.close();}
