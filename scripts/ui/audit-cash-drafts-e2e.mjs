import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { waitForNativeShiftReceipt } from './shift-action-observation.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
// Exercise restoration from session storage on history traversals, rather than
// reusing a frozen BFCache document with its previous actor and form state.
const db = new PrismaClient(), browser = await chromium.launch({headless:true,args:['--disable-features=BackForwardCache']}), results=[];
let activePage;
try {
  assert.equal(Boolean(process.env.SMTP_HOST),false,'Synthetic saves require no SMTP environment transport');
  for (const width of [1280,390]) {
    execFileSync(path.join(process.cwd(),'node_modules/.bin/tsx'),['scripts/etapa1/fixture.mts'],{stdio:'pipe'});
    const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
    assert.equal(await db.mailSettings.count(),0,'Synthetic saves require no database SMTP transport');
    await db.handoverElementType.updateMany({data:{active:false}});
    await db.cashFund.upsert({where:{currency:'CLP'},create:{currency:'CLP',amount:100000},update:{amount:100000,active:true}});
    const denomination=await db.cashDenomination.findUniqueOrThrow({where:{currency_value:{currency:'CLP',value:20000}}});
    const guarantee=await db.guarantee.create({data:{kind:'EFECTIVO',state:'VIGENTE',amount:50000,currency:'CLP',reference:'SYNTHETIC CASH DRAFT',createdById:f.users.admin.id}});
    const returnGuarantee=await db.guarantee.create({data:{kind:'EFECTIVO',state:'VIGENTE',amount:30000,currency:'CLP',reference:'SYNTHETIC RETURN DURING CLOSE',createdById:f.users.admin.id}});
    const now=new Date();
    const shift=await db.shift.create({data:{type:'DIA',date:now,status:'PREPARANDO_ENTREGA',plannedStart:new Date(Date.now()-3600000),plannedEnd:new Date(Date.now()+3600000),actualStart:now,createdById:f.users.admin.id}});
    await db.shiftAssignment.create({data:{shiftId:shift.id,userId:f.users.admin.id,activatedAt:now}});
    await db.shiftAssignment.create({data:{shiftId:shift.id,userId:f.users.worker.id,activatedAt:now}});
    const handover=await db.shiftHandover.create({data:{fromShiftId:shift.id,issuedById:f.users.admin.id,status:'BORRADOR'}});
    // A second draft is a navigation target only. Its assignment is not active,
    // preserving the one-active-participation constraint; no action is sent there.
    const otherShift=await db.shift.create({data:{type:'NOCHE',date:now,status:'PREPARANDO_ENTREGA',plannedStart:new Date(Date.now()+3600000),plannedEnd:new Date(Date.now()+7200000),createdById:f.users.admin.id}});
    await db.shiftAssignment.create({data:{shiftId:otherShift.id,userId:f.users.admin.id}});
    const otherHandover=await db.shiftHandover.create({data:{fromShiftId:otherShift.id,issuedById:f.users.admin.id,status:'BORRADOR'}});
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addCookies([{name:'lor_session',value:f.users.admin.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});
    const page=await context.newPage();activePage=page;page.setDefaultTimeout(12000);
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
    await page.addInitScript(()=>{
      const originalSet=Storage.prototype.setItem;
      for(const method of ['setItem','removeItem','getItem']){const original=Storage.prototype[method];Storage.prototype[method]=function(key,value){
        if(this===sessionStorage&&key.startsWith('aroh:form-draft')){try{let trace=[];try{trace=JSON.parse(sessionStorage.getItem('synthetic-draft-trace')??'[]');}catch{}let revision;try{if(method==='setItem'&&key.startsWith('aroh:form-draft:v1:'))revision=JSON.parse(value)?.revision;}catch{}trace.push({method,key,actor:key==='aroh:form-draft-user'?value:undefined,revision,at:Date.now(),source:new Error().stack?.split('\n').slice(2,4).join(' ')});originalSet.call(sessionStorage,'synthetic-draft-trace',JSON.stringify(trace.slice(-100)));}catch{}}
        return original.apply(this,arguments);
      };}
    });
    await page.addInitScript(()=>{window.__shiftUxActionResults=[];window.__shiftUxSubmissions=[];document.addEventListener('submit',event=>window.__shiftUxSubmissions.push({formId:event.target.id}),true);window.addEventListener('aroh:action-result',event=>window.__shiftUxActionResults.push(event.detail));});
    const url=`http://localhost:3000/turno/entrega/${handover.id}`;
    const otherUrl=`http://localhost:3000/turno/entrega/${otherHandover.id}`;
    const cashDraftKey=`aroh:form-draft:v1:cash:${f.users.admin.id}:${handover.id}:declarar`;
    const noteDraftKey=`aroh:form-draft:v1:handover-note:${f.users.admin.id}:${handover.id}`;
    let activeHandoverId=handover.id,activeActorId=f.users.admin.id;
    async function fillDraft(control,value){
      await control.fill(value);const name=await control.getAttribute('name');const key=name==='notes'||name.startsWith('d_')?`aroh:form-draft:v1:cash:${activeActorId}:${activeHandoverId}:declarar`:`aroh:form-draft:v1:handover-note:${activeActorId}:${activeHandoverId}`;
      await page.waitForFunction(({key,name,value})=>{try{return JSON.parse(sessionStorage.getItem(key)).values.some(([field,control])=>field===`${name}#0`&&control.value===value);}catch{return false;}},{key,name,value});
    }
    const activeForm=()=>page.locator('form[data-action-form-ready="true"]').filter({has:page.locator(`input[name=handoverId][value="${activeHandoverId}"]`)});
    const form=()=>activeForm().filter({has:page.getByRole('button',{name:'Guardar arqueo declarado',exact:true})});
    const quantity=()=>form().locator(`input[name="d_${denomination.id}"]`);
    const check=()=>form().locator(`input[name="g_${guarantee.id}"]`);
    async function submit(target,button) {
      const attempt={formId:await target.getAttribute('id'),offset:await page.evaluate(()=>window.__shiftUxActionResults.length)};
      const submissionOffset=await page.evaluate(()=>window.__shiftUxSubmissions.length);
      await target.getByRole('button',{name:button,exact:true}).click();
      const submitted=await page.evaluate(offset=>window.__shiftUxSubmissions.slice(offset),submissionOffset);assert.equal(submitted.length,1,'One native submit identifies the actual mounted form');attempt.formId=submitted[0].formId;
      await waitForNativeShiftReceipt(page,attempt,true);
    }
    activeHandoverId=handover.id;await page.goto(url);await fillDraft(quantity(),'5');await fillDraft(form().locator('textarea[name=notes]'),'SYNTHETIC borrador antes de salir');await check().check();
    await page.evaluate(()=>sessionStorage.setItem('synthetic-unrelated-preference','keep'));
    await page.getByRole('link',{name:`Devolver garantía #${returnGuarantee.humanId} en Caja`,exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/caja');
    assert.equal(await page.getByRole('button',{name:'Cobrar garantía',exact:true}).count(),0,'Charging a guarantee remains blocked during closing');
    const returnRow=page.locator('li').filter({hasText:`#${returnGuarantee.humanId}`});
    await returnRow.getByRole('button',{name:'Devolver',exact:true}).click();
    const returnForm=page.locator('form[data-action-form-ready="true"]').filter({has:page.getByRole('button',{name:'Registrar devolución',exact:true})});
    await returnForm.locator('input[name=confirmed]').check();await submit(returnForm,'Registrar devolución');
    assert.equal((await db.guarantee.findUniqueOrThrow({where:{id:returnGuarantee.id}})).state,'DEVUELTA');
    await page.getByRole('link',{name:'Volver al cierre',exact:true}).click();
    await page.waitForURL(url=>url.pathname===`/turno/entrega/${handover.id}`&&url.searchParams.get('paso')==='1');
    await page.getByText(/El registro guardado cambió después de este borrador/).waitFor();
    assert.equal(await quantity().inputValue(),'5');assert.equal(await form().locator('textarea[name=notes]').inputValue(),'SYNTHETIC borrador antes de salir');assert.equal(await check().isChecked(),false,'Returning another guarantee must not restore an unsent physical validation');
    activeHandoverId=otherHandover.id;await page.goto(otherUrl);await quantity().waitFor();
    assert.equal(await quantity().inputValue(),'','Another handover must not inherit quantities');
    assert.equal(await form().locator('textarea[name=notes]').inputValue(),'');assert.equal(await check().isChecked(),false);
    await fillDraft(quantity(),'4');await fillDraft(form().locator('textarea[name=notes]'),'SYNTHETIC segundo relevo');
    activeHandoverId=handover.id;await page.goto(url);
    await page.getByText(/El registro guardado cambió después de este borrador/).waitFor();
    assert.equal(await quantity().inputValue(),'5');assert.equal(await form().locator('textarea[name=notes]').inputValue(),'SYNTHETIC borrador antes de salir');assert.equal(await check().isChecked(),false,'A draft must not restore an unsent physical validation');
    activeHandoverId=otherHandover.id;await page.goBack();await page.waitForURL(otherUrl);await form().waitFor();await page.getByText(/Borrador recuperado de esta pestaña/).waitFor();assert.equal(await quantity().inputValue(),'4');assert.equal(await check().isChecked(),false);
    activeHandoverId=handover.id;await page.goForward();await page.waitForURL(url);await form().waitFor();await page.getByText(/El registro guardado cambió después de este borrador/).waitFor();assert.equal(await quantity().inputValue(),'5');assert.equal(await check().isChecked(),false);
    // Switch between two authenticated synthetic participants in this same tab.
    // The renderer regression separately exercises reuse without a document load.
    activeActorId=f.users.worker.id;await context.addCookies([{name:'lor_session',value:f.users.worker.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await page.reload();await page.waitForFunction(id=>sessionStorage.getItem('aroh:form-draft-user')===id,f.users.worker.id);await quantity().waitFor();
    assert.equal(await quantity().inputValue(),'','Another actor must not recover the first actor draft');assert.equal(await check().isChecked(),false);
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('aroh:form-draft:v1:')).length),0);
    await fillDraft(quantity(),'6');await fillDraft(form().locator('textarea[name=notes]'),'SYNTHETIC segundo actor');await check().check();
    activeActorId=f.users.admin.id;await context.addCookies([{name:'lor_session',value:f.users.admin.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await page.reload();await page.waitForFunction(id=>sessionStorage.getItem('aroh:form-draft-user')===id,f.users.admin.id);await quantity().waitFor();
    assert.equal(await quantity().inputValue(),'');assert.equal(await check().isChecked(),false);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('synthetic-unrelated-preference')),'keep');
    await fillDraft(quantity(),'5');await fillDraft(form().locator('textarea[name=notes]'),'SYNTHETIC borrador antes de salir');
    await check().check();await submit(form(),'Guardar arqueo declarado');
    await page.waitForFunction(key=>sessionStorage.getItem(key)===null,cashDraftKey);
    await page.reload();
    assert.equal(await quantity().inputValue(),'5');assert.equal(await form().locator('textarea[name=notes]').inputValue(),'SYNTHETIC borrador antes de salir');assert.equal(await check().isChecked(),true,'The recorded confirmation is shown when its cash revision is unchanged');
    await fillDraft(form().locator('textarea[name=notes]'),'SYNTHETIC borrador en conflicto');
    await db.cashCount.update({where:{handoverId_kind:{handoverId:handover.id,kind:'DECLARADO'}},data:{notes:'SYNTHETIC revisión guardada por otra ventana',countedAt:new Date()}});
    await page.reload();await page.getByText(/El registro guardado cambió después de este borrador/).waitFor();assert.equal(await form().locator('textarea[name=notes]').inputValue(),'SYNTHETIC borrador en conflicto');
    const originalRevision=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).revision,cashDraftKey);
    await fillDraft(form().locator('textarea[name=notes]'),'SYNTHETIC borrador en conflicto editado');
    await page.getByText(/El registro guardado cambió después de este borrador/).waitFor();
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).revision,cashDraftKey),originalRevision,'Editing does not acknowledge a newer saved revision');
    await page.reload();await page.getByText(/El registro guardado cambió después de este borrador/).waitFor();
    assert.equal(await form().locator('textarea[name=notes]').inputValue(),'SYNTHETIC borrador en conflicto editado');
    await submit(form(),'Guardar arqueo declarado');await page.waitForFunction(key=>sessionStorage.getItem(key)===null,cashDraftKey);await page.reload();
    await db.cashMovement.create({data:{id:randomUUID(),kind:'AJUSTE_ENTRADA',direction:'ENTRADA',amount:1,currency:'CLP',createdById:f.users.admin.id,affectsExpected:false,reference:'SYNTHETIC revision invalidates count'}});
    await page.reload();await page.getByText(/Caja cambió: confirma nuevamente/).waitFor();assert.equal(await check().isChecked(),false);assert.equal(await quantity().inputValue(),'5');
    // In the synthetic configuration without cash requirements, inspect the note step independently.
    await db.cashFund.updateMany({data:{active:false}});
    activeHandoverId=handover.id;await page.goto(`${url}?paso=2`);
    const note=()=>activeForm().filter({has:page.getByRole('button',{name:'Guardar nota para el turno siguiente',exact:true})});
    await fillDraft(note().locator('textarea[name=observation]'),'SYNTHETIC nota persistida');await fillDraft(note().locator('textarea[name=nextAction]'),'SYNTHETIC verificar respuesta');
    await submit(note(),'Guardar nota para el turno siguiente');await page.waitForFunction(key=>sessionStorage.getItem(key)===null,noteDraftKey);await page.reload();
    assert.equal(await note().locator('textarea[name=observation]').inputValue(),'SYNTHETIC nota persistida');assert.equal(await note().locator('textarea[name=nextAction]').inputValue(),'SYNTHETIC verificar respuesta');
    await fillDraft(note().locator('textarea[name=observation]'),'SYNTHETIC no enviado');
    activeHandoverId=otherHandover.id;await page.goto(`${otherUrl}?paso=2`);await note().waitFor();
    assert.equal(await note().locator('textarea[name=observation]').inputValue(),'','Another handover must not inherit the note');
    assert.equal(await note().locator('textarea[name=nextAction]').inputValue(),'');
    activeHandoverId=handover.id;await page.goto(`${url}?paso=2`);await note().getByText(/Borrador recuperado de esta pestaña/).waitFor();
    assert.equal(await note().locator('textarea[name=observation]').inputValue(),'SYNTHETIC no enviado');
    await page.goto('http://localhost:3000/perfil');
    await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.waitForURL('**/login');
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('aroh:form-draft:v1:')).length),0);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('synthetic-unrelated-preference')),'keep');
    assert.deepEqual(errors,[]);results.push({width,unsavedRestored:true,physicalDraftNotRestored:true,returnedGuaranteeDuringClosing:true,savedRestored:true,cashRevisionInvalidatesChecks:true,concurrentSavedRevisionWarned:true,staleWarningSurvivesEditAndReload:true,handoverAndHistoryIsolated:true,actorSwitchClearsDrafts:true,saveClearsBeforeReload:true,noteRestored:true,noteHandoverIsolated:true,logoutClearsOnlyDrafts:true});
    await context.close();
  }
} catch(error) {
  if(activePage&&!activePage.isClosed()){
    console.error('Synthetic draft trace',await activePage.evaluate(()=>sessionStorage.getItem('synthetic-draft-trace')));
    const draftMeta=await activePage.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('aroh:form-draft:v1:')).map(key=>({key,revision:JSON.parse(sessionStorage.getItem(key)).revision,savedAt:JSON.parse(sessionStorage.getItem(key)).savedAt})));console.error('Synthetic draft revisions',draftMeta);console.error('Synthetic saved revisions',await db.cashCount.findMany({where:{handoverId:{in:[...new Set(draftMeta.map(row=>row.key.split(':')[5]))]}},select:{handoverId:true,countedAt:true,kind:true}}));
    console.error('Synthetic form readiness',await activePage.locator('form').evaluateAll(forms=>forms.slice(0,20).map(form=>({id:form.id,ready:form.getAttribute('data-action-form-ready'),handoverId:form.querySelector('input[name=handoverId]')?.value,button:form.querySelector('button[type=submit]')?.textContent}))));
    console.error('Synthetic cash draft screen',(await activePage.locator('body').innerText()).slice(-12000));
  }
  throw error;
} finally {writeFileSync('audit-cash-drafts-browser-results.json',JSON.stringify(results,null,2));await browser.close();await db.$disconnect();}
console.log('Cash and handover drafts verified on synthetic desktop/mobile.');
