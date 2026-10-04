import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const db=new PrismaClient(),browser=await chromium.launch({headless:true}),results=[];
try{
  const room=await db.room.findUniqueOrThrow({where:{number:'512'}});
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addCookies([{name:'lor_session',value:f.users.admin.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
    await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});
    const page=await context.newPage();page.setDefaultTimeout(12000);
    const source=await db.operationalEntry.create({data:{type:'NOVEDAD',title:`PRUEBA AUTOMÁTICO DE IA · Fronti intención ${width}`,description:'Conservar contexto sin retranscripción',createdById:f.users.admin.id,roomId:room.id}});
    await page.goto(`http://localhost:3000/libro/${source.id}`);
    const response=await context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:'Fronti, manda esto a Mantenimiento y avísame cuando esté listo.',requestKey:randomUUID(),pageContext:{pathname:`/libro/${source.id}`}}});
    const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));assert.equal(body.confirmations?.length,1,JSON.stringify(body));
    const card=body.confirmations[0];assert.ok(card.detail.includes(`Asunto #${source.humanId}`));
    for(const internal of ['entryId','departmentId','requestKey','revision',source.id])assert.ok(!card.detail.includes(internal));
    assert.equal(await db.task.count({where:{entryId:source.id}}),0,'La propuesta no ejecuta');
    const id=card.token.replace('fronti-plan:','');
    await page.goto(`http://localhost:3000/fronti/procedimientos?ejecucion=${id}`);
    await page.getByRole('heading',{name:'Solicitudes de Fronti',exact:true}).waitFor();
    const advanced=page.locator('details').filter({has:page.getByText('Opciones avanzadas · Delegaciones',{exact:true})});
    assert.equal(await advanced.getAttribute('open'),null);
    const authorize=page.getByRole('button',{name:'Autorizar solicitud',exact:true});await authorize.waitFor();
    assert.equal(await page.getByRole('button',{name:'Cancelar pendientes',exact:true}).count(),1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const authorizationResponse=page.waitForResponse(r=>r.url().endsWith('/api/fronti')&&r.request().method()==='POST');
    await authorize.click();
    const authorizationResult=await authorizationResponse;
    assert.equal(authorizationResult.status(),200,authorizationResult.status()===200?'':await authorizationResult.text());
    await page.getByRole('heading',{name:'Resultado: Completado',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Autorizar solicitud',exact:true}).count(),0);
    const task=await db.task.findFirstOrThrow({where:{entryId:source.id}});
    assert.equal(task.description,source.description);assert.equal(task.roomId,room.id);
    assert.equal(await db.task.count({where:{entryId:source.id}}),1);
    await page.getByRole('link',{name:'Abrir registro original',exact:true}).click();
    await page.waitForURL(`**/libro/${source.id}`);
    const original=await page.locator('[aria-label="Continuidad del asunto"]').innerText();assert.ok(original.includes(`Asunto #${source.humanId}`));
    assert.ok(await db.auditLog.count({where:{entity:'FrontiExecution',entityId:id}})>0);
    for(const [route,current] of [['/notificaciones','Recibidos'],['/alertas','Recordatorios'],['/seguimientos?mios=1','Pendientes que continúan']]){
      await page.goto(`http://localhost:3000${route}`);
      const notices=page.getByRole('navigation',{name:'Avisos',exact:true});await notices.waitFor();
      assert.equal(await notices.getByRole('link').count(),3);
      assert.equal(await notices.getByRole('link',{name:current,exact:true}).getAttribute('aria-current'),'page');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    const cancelledSource=await db.operationalEntry.create({data:{type:'NOVEDAD',title:`PRUEBA AUTOMÁTICO DE IA · Cancelar Fronti ${width}`,description:'Cancelación conserva el asunto',createdById:f.users.admin.id,roomId:room.id}});
    const cancelResponse=await context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:`Manda el asunto #${cancelledSource.humanId} a Mantenimiento`,requestKey:randomUUID()}});
    const cancelBody=await cancelResponse.json();assert.equal(cancelResponse.status(),200,JSON.stringify(cancelBody));assert.equal(cancelBody.confirmations?.length,1,JSON.stringify(cancelBody));
    const cancelId=cancelBody.confirmations[0].token.replace('fronti-plan:','');
    await db.operationalEntry.update({where:{id:cancelledSource.id},data:{deletedAt:new Date()}});
    await page.goto(`http://localhost:3000/fronti/procedimientos?ejecucion=${cancelId}`);
    await page.getByRole('heading',{name:'El origen cambió o no está disponible',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Autorizar solicitud',exact:true}).count(),0);
    await page.getByRole('button',{name:'Cancelar pendientes',exact:true}).click();
    await page.getByRole('heading',{name:'Resultado: Cancelado',exact:true}).waitFor();
    assert.equal(await db.task.count({where:{entryId:cancelledSource.id}}),0);
    assert.equal(await page.getByRole('button',{name:'Autorizar solicitud',exact:true}).count(),0);
    results.push({width,naturalIntent:true,onlyExplicitConfirmationExecutes:true,sameSourceContext:true,oneTask:true,nativeAudit:true,humanCard:true,advancedClosed:true,cancellation:true,archivedSourceCanCancel:true,noticeRoutesPreserved:true,mobileOverflow:false});
    await context.close();
  }
}finally{writeFileSync('etapa4-intent-browser-results.json',JSON.stringify(results,null,2));await browser.close();await db.$disconnect();}
