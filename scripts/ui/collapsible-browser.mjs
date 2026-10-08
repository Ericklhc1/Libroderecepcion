import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const fixture=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const browser=await chromium.launch({headless:true});
const results=[];
try{
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addCookies([{name:'lor_session',value:fixture.users.admin.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      return url.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(path=>url.pathname.startsWith(path))?route.abort():route.continue();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(12000);

    await page.goto('http://localhost:3000/admin');
    await page.getByRole('heading',{name:'Administración',exact:true}).waitFor();
    const summaries=page.locator('[data-disclosure-summary]');
    assert.ok(await summaries.count()>=4,'Administración debe exponer grupos plegables');
    const peopleSummary=summaries.filter({hasText:'Personas y acceso'}).first();
    const peopleDetails=peopleSummary.locator('xpath=..');
    assert.equal(await peopleDetails.evaluate(el=>el.open),true,'Administración inicia su grilla abierta');
    await peopleDetails.locator('a[href="/admin/usuarios"]').waitFor();
    const openHeight=(await peopleDetails.boundingBox())?.height??0;
    await peopleSummary.click();assert.equal(await peopleDetails.evaluate(el=>el.open),false);
    const closedHeight=(await peopleDetails.boundingBox())?.height??0;
    assert.ok(openHeight>closedHeight+20,'Plegar una sección conserva contenido real');
    await peopleSummary.click();assert.equal(await peopleDetails.evaluate(el=>el.open),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Administración no debe generar overflow horizontal');

    await page.goto('http://localhost:3000/admin/fronti');
    await page.getByRole('heading',{name:'Fronti',exact:true}).waitFor();
    const diagnostic=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Diagnóstico'})}).first();
    assert.equal(await diagnostic.evaluate(el=>el.open),true,'El diagnóstico principal debe abrir por defecto');
    const access=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Acceso por usuario'})}).first();
    assert.equal(await access.evaluate(el=>el.open),false);
    await access.locator('summary').click();
    assert.equal(await access.evaluate(el=>el.open),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Fronti no debe generar overflow horizontal');

    await page.goto('http://localhost:3000/indicadores');
    await page.getByRole('heading',{name:'Indicadores',exact:true}).waitFor();
    assert.ok(await page.locator('[data-disclosure-summary]').count()>=4,'Indicadores debe agrupar sus bloques principales');
    assert.equal(await page.locator('[data-disclosure-summary]').filter({hasText:'Tareas'}).first().locator('xpath=..').evaluate(el=>el.open),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Indicadores no debe generar overflow horizontal');

    await page.goto('http://localhost:3000/supervision/salud');
    await page.getByRole('heading',{name:'Salud operativa',exact:true}).waitFor();
    assert.ok(await page.locator('[data-disclosure-summary]').count()>=7,'Salud operativa debe plegar sus bloques');
    assert.equal(await page.locator('details').filter({hasText:'Turnos y cierre'}).first().evaluate(el=>el.open),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Salud operativa no debe generar overflow horizontal');

    await page.goto('http://localhost:3000/coordinacion/automatizaciones');
    await page.getByRole('heading',{name:'Reglas y procedimientos',exact:true}).waitFor();
    assert.ok(await page.locator('[data-disclosure-summary]').filter({hasText:'Tus últimas 50 políticas'}).count()===1,'Automatizaciones debe plegar el historial');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Automatizaciones no debe generar overflow horizontal');

    results.push({width,adminGroups:await summaries.count(),status:'passed',physicalSafari:false});
    await context.close();
  }
  console.log('Collapsible sections desktop/mobile journeys passed.',JSON.stringify(results));
}finally{
  writeFileSync('collapsible-sections-browser-results.json',JSON.stringify({browser:browser.version(),results},null,2));
  await browser.close();
}
