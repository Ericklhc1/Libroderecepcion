import './guard.cjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const browser=await chromium.launch({headless:true});
const results=[];
async function actor(name,width){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addCookies([{name:'lor_session',value:f.users[name].token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});
 const page=await context.newPage();return {context,page};
}
try{
 for(const [index,width] of [1280,390].entries()){
  const t=f.tasks[index];const admin=await actor('admin',width);const worker=await actor('worker',width);
  const response=await admin.page.goto(`http://localhost:3000/coordinacion?area=${f.areaId}`);
  assert.equal(response.status(),200);
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
  const card=admin.page.locator('article').filter({hasText:t.title});
  await card.getByText('Recepción, siguiente acción y relevo',{exact:true}).click();
  await card.locator('select[name="ownerId"]').selectOption(f.users.worker.id);
  await card.locator('textarea[name="nextAction"]').fill('Atender y registrar resultado sintético');
  await card.getByRole('button',{name:'Asignar y solicitar recepción',exact:true}).click();
  await card.getByText('Etapa1 worker',{exact:true}).waitFor();
  await worker.page.goto(`http://localhost:3000/coordinacion?area=${f.areaId}&mios=1`);
  assert.ok(!(await worker.page.content()).includes('ETAPA1_PRIVATE_TASK'));
  const own=worker.page.locator('article').filter({hasText:t.title});
  await own.getByText('Recepción, siguiente acción y relevo',{exact:true}).click();
  await own.getByRole('button',{name:'Confirmar recepción',exact:true}).click();
  await own.getByRole('button',{name:'Guardar siguiente acción',exact:true}).waitFor();
  assert.ok(await worker.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal mobile overflow');
  await worker.page.goto(`http://localhost:3000/tareas/${t.id}`);
  await worker.page.getByRole('button',{name:'Resolver',exact:true}).click();
  await worker.page.getByRole('button',{name:'Resolver',exact:true}).waitFor({state:'hidden'});
  await worker.page.goto(`http://localhost:3000/coordinacion?area=${f.areaId}&historial=1`);
  await worker.page.locator('article').filter({hasText:t.title}).waitFor();
  const maid=await actor('maid',width);await maid.page.goto('http://localhost:3000/coordinacion');
  assert.ok(!(await maid.page.content()).includes(t.title),'Area-only account cannot read reception work');
  results.push({width,flow:'assign-receive-resolve-original-source',privacy:'passed',mobileOverflow:'passed'});
  await admin.context.close();await worker.context.close();await maid.context.close();
 }
 const anon=await browser.newContext();const page=await anon.newPage();await page.goto('http://localhost:3000/coordinacion');assert.ok(page.url().includes('/login'));await anon.close();
 writeFileSync('etapa1-browser-results.json',JSON.stringify(results,null,2));console.log('Etapa 1 authenticated desktop/mobile journeys passed.');
}finally{await browser.close();}
