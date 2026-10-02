import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));const db=new PrismaClient(),browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});await context.addCookies([{name:'lor_session',value:f.users.admin.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});const page=await context.newPage();page.setDefaultTimeout(12000);
  await page.goto('http://localhost:3000/custodia');assert.ok(await page.getByRole('heading',{name:'Objetos olvidados y custodia'}).isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.getByRole('button',{name:'Registrar objeto',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Registrar objeto encontrado'});await dialog.locator('input[name=item]').fill('Objeto sintético '+width);await dialog.locator('input[name=foundLocation]').fill('Lobby sintético');const local=new Date(Date.now()-60000).toISOString().slice(0,16);await dialog.locator('input[name=foundAt]').fill(local);await dialog.locator('input[name=custodyLocation]').fill('Gabinete sintético');await dialog.getByRole('button',{name:'Guardar en custodia'}).click();await dialog.waitFor({state:'hidden'});
  const row=await db.lostFoundItem.findFirstOrThrow({where:{item:'Objeto sintético '+width}});await page.reload();await page.getByText('#'+row.humanId+' ·',{exact:false}).waitFor();
  const article=page.locator('article').filter({hasText:'Objeto sintético '+width});await article.getByRole('button',{name:'Registrar entrega'}).click();dialog=page.getByRole('dialog',{name:'Registrar entrega'});await dialog.locator('textarea[name=note]').fill('Entrega sintética completada');await dialog.locator('textarea[name=evidenceNote]').fill('Acta sintética '+width);await dialog.getByRole('button',{name:'Cerrar custodia'}).click();await dialog.waitFor({state:'hidden'});
  const final=await db.lostFoundItem.findUniqueOrThrow({where:{id:row.id}});assert.equal(final.status,'ENTREGADO');assert.equal(final.evidenceNote,'Acta sintética '+width);assert.equal(await db.lostFoundEvent.count({where:{itemId:row.id}}),2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));results.push({width,scenario:'lost-found-register-custody-delivery-evidence',status:'passed',physicalSafari:false});await context.close();
 }
 console.log('Etapa 3 block 2 custody desktop/mobile journeys passed.',JSON.stringify(results));
}finally{writeFileSync('etapa3-block2-browser-results.json',JSON.stringify(results,null,2));await browser.close();await db.$disconnect();}
