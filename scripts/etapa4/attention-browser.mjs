import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const db=new PrismaClient(),browser=await chromium.launch({headless:true}),results=[];
try{
  const maintenance=await db.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
  const hk=await db.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
  const room=await db.room.findUniqueOrThrow({where:{number:'512'}});
  await db.user.update({where:{id:f.users.worker.id},data:{departmentId:maintenance.id}});
  for(const width of [1280,390]){
    const contexts=[];
    async function session(key){
      const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);
      await context.addCookies([{name:'lor_session',value:f.users[key].token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);
      await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});
      const page=await context.newPage();page.setDefaultTimeout(12000);return {context,page};
    }
    const origin=await session('admin'),worker=await session('worker'),maid=await session('maid');
    for(const area of [maintenance,hk]){
      const source=await db.operationalEntry.create({data:{type:'NOVEDAD',title:`PRUEBA AUTOMÁTICO DE IA · Atención ${area.key} ${width}`,description:'Contexto heredado sin transcripción',resolution:'Resultado histórico que requiere nueva atención',reopenedAt:new Date(),roomId:room.id,priority:'ALTA',createdById:f.users.admin.id}});
      await origin.page.goto(`http://localhost:3000/libro/${source.id}`);
      await origin.page.getByRole('button',{name:'Solicitar atención',exact:true}).click();
      const dialog=origin.page.getByRole('dialog');
      assert.equal(await dialog.locator('textarea').count(),0,'No vuelve a pedir la descripción');
      assert.equal(await dialog.locator('select[name=roomId]').count(),0,'No vuelve a pedir habitación');
      await dialog.locator('select[name=departmentId]').selectOption(area.id);
      await dialog.getByRole('button',{name:'Enviar solicitud',exact:true}).click();
      await dialog.waitFor({state:'hidden'});
      if(area.key==='MANTENIMIENTO'){
        const task=await db.task.findFirstOrThrow({where:{entryId:source.id}});
        assert.equal(task.roomId,room.id);assert.equal(task.description,source.description);
        const assigned=await origin.context.request.post('http://localhost:3000/api/operational-actions/coordination',{headers:{Origin:'http://localhost:3000'},data:{kind:'task',id:task.id,updatedAt:task.updatedAt.toISOString(),requestKey:randomUUID(),action:'ASIGNAR',ownerId:f.users.worker.id,nextAction:'Atender habitación y devolver resultado'}});
        assert.equal(assigned.status(),200,JSON.stringify(await assigned.json()));
        await worker.page.goto(`http://localhost:3000/tareas/${task.id}`);
        await worker.page.getByRole('button',{name:'Confirmar recepción',exact:true}).click();
        await worker.page.getByRole('button',{name:'Informar resultado',exact:true}).click();
        const taskResult=worker.page.getByRole('dialog');
        await taskResult.locator('textarea[name=evidenceProvided]').fill('Reparación comprobada; habitación lista para continuar');
        await taskResult.getByRole('button',{name:'Informar resultado',exact:true}).click();
        await taskResult.waitFor({state:'hidden'});
        await worker.page.getByRole('link',{name:'Ver resultado',exact:true}).waitFor();
        await origin.page.goto(`http://localhost:3000/libro/${source.id}`);
        await origin.page.getByText(/Resultado recibido · Completada/).waitFor();
        await origin.page.getByText('Reparación comprobada; habitación lista para continuar',{exact:true}).waitFor();
        assert.equal(await db.task.count({where:{entryId:source.id}}),1);
      }else{
        const work=await db.housekeepingRequest.findUniqueOrThrow({where:{sourceEntryId:source.id}});
        assert.equal(work.roomId,room.id);assert.equal(work.title,null);assert.equal(work.description,null);
        await origin.page.getByRole('link',{name:'Ver atención del área',exact:true}).click();
        const card=origin.page.locator(`[data-housekeeping-detail="${work.id}"]`);
        await card.getByRole('button',{name:'Asignar / reasignar',exact:true}).waitFor();
        const count=await card.locator('[aria-label="Acciones del asunto"] button,[aria-label="Acciones del asunto"] a,[aria-label="Acciones del asunto"] summary').evaluateAll(es=>es.filter(e=>e.checkVisibility()).length);
        assert.ok(count<=4,'Housekeeping prioriza una acción y conserva Más');
        assert.equal(await db.task.count({where:{entryId:source.id}}),0,'No añade motor paralelo');
        const assign=await origin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:'/ejecutar '+JSON.stringify([{action:'changeHkWorkAction',fields:{id:work.id,version:String(work.version),action:'ASIGNAR',assignedToId:f.users.maid.id,note:'Atender y devolver resultado al origen'}}]),requestKey:randomUUID()}});
        const assignedBody=await assign.json();assert.equal(assign.status(),200,assignedBody.error);assert.match(assignedBody.reply,/Completado/);
        const workHref=`http://localhost:3000/admin/housekeeping?area=${area.id}&aviso=${work.humanId}`;
        await maid.page.goto(workHref);
        const maidCard=maid.page.locator(`[data-housekeeping-detail="${work.id}"]`);
        await maidCard.getByRole('button',{name:'Confirmar recepción',exact:true}).click();
        await maidCard.getByText('Recibido',{exact:true}).waitFor();
        const startButton=maidCard.getByRole('button',{name:'Comenzar',exact:true});
        const beforeStart=await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id},select:{status:true,version:true,sourceVersion:true}});
        const startVersion=await startButton.locator('xpath=ancestor::form').locator('input[name=version]').inputValue();
        assert.equal(Number(startVersion),beforeStart.version,'El formulario de la siguiente acción usa la revisión recibida');
        await startButton.click();
        try { await maidCard.getByText('En proceso',{exact:true}).waitFor(); }
        catch(error){console.error('HK start diagnostic',JSON.stringify({before:beforeStart,formVersion:startVersion,after:await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id},select:{status:true,version:true,sourceVersion:true}}),visible:await maidCard.innerText(),forms:await maidCard.locator('form').evaluateAll(forms=>forms.map(form=>Object.fromEntries(new FormData(form))))}));throw error;}
        await maidCard.getByRole('button',{name:'Marcar terminado',exact:true}).click();
        const resultDialog=maid.page.getByRole('dialog',{name:'Marcar terminado',exact:true});
        await resultDialog.locator('textarea[name=note]').fill('Necesidad atendida y comprobada');
        await resultDialog.getByRole('button',{name:'Confirmar',exact:true}).click();
        await resultDialog.waitFor({state:'hidden'});
        await origin.page.goto(`http://localhost:3000/libro/${source.id}`);
        await origin.page.locator('#atencion-area').getByText('Necesidad atendida y comprobada',{exact:false}).waitFor();
        assert.equal((await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}})).status,'RESUELTO');
      }
      await origin.page.getByRole('button',{name:'Revisar y cerrar',exact:true}).click();
      const review=origin.page.getByRole('dialog');
      assert.ok((await review.locator('textarea[name=resolution]').inputValue()).length>0,'Resultado ya incluido; no se transcribe');
      assert.notEqual(await review.locator('textarea[name=resolution]').inputValue(),source.resolution,'La revisión usa el resultado actual del área, conserva el intento histórico');
      await review.getByRole('button',{name:'Revisar y cerrar',exact:true}).click();
      await review.waitFor({state:'hidden'});
      assert.equal((await db.operationalEntry.findUniqueOrThrow({where:{id:source.id}})).status,'CERRADO');
      assert.ok(await origin.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      results.push({width,area:area.key,sourceId:source.id,contextInherited:true,descriptionFields:0,roomFields:0,nativeWork:true,noDuplicateAttention:true});
    }
    for(const context of contexts)await context.close();
  }
}finally{writeFileSync('etapa4-attention-browser-results.json',JSON.stringify(results,null,2));await browser.close();await db.$disconnect();}
