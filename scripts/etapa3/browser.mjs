import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const db=new PrismaClient(),browser=await chromium.launch({headless:true}),results=[],pages=[];
try{
 const area=await db.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});const room=await db.room.findUniqueOrThrow({where:{number:'512'}});
 await db.user.update({where:{id:f.users.maid.id},data:{departmentId:area.id}});
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const width of [1280,390]){
  const contexts=[];
  async function session(key){const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);await context.addCookies([{name:'lor_session',value:f.users[key].token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});const page=await context.newPage();pages.push(page);page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);page.on('pageerror',error=>console.error('Synthetic page error:',error.message));return {context,page};}
  const admin=await session('admin'),maid=await session('maid');const key=randomUUID(),title=`ETAPA3_HK_${width}`;
  const create=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:'/ejecutar '+JSON.stringify([{action:'createHkWorkAction',fields:{requestKey:key,title,description:'Limpiar tras revisión de fuga sintética',workKind:'LIMPIEZA',workDate:date,departmentId:area.id,roomId:room.id,priority:'ALTA',effortMinutes:'25',assignedToId:f.users.maid.id}}]),requestKey:randomUUID()}});
  const createBody=await create.json();assert.equal(create.status(),200,createBody.error);assert.match(createBody.reply,/Completado/);
  const work=await db.housekeepingRequest.findUniqueOrThrow({where:{requestKey:key}});const href=`http://localhost:3000/admin/housekeeping?area=${area.id}&aviso=${work.humanId}`;
  async function open(page){await page.goto(href);await page.locator(`#aviso-${work.humanId}`).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal overflow');}
  async function act(page,label,note,extra){const card=page.locator(`#aviso-${work.humanId}`);if(note){await card.getByRole('button',{name:label,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('textarea[name=note]').fill(note);if(extra)await dialog.locator('select[name=severity]').selectOption(extra);const [post]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/admin/housekeeping'),dialog.getByRole('button',{name:'Confirmar',exact:true}).click()]);await post.finished();try{await dialog.waitFor({state:'hidden',timeout:15000});}catch(error){const alert=dialog.getByRole('alert');console.error('Etapa3 dialog failure:',await alert.count()?await alert.innerText():'sin alerta visible');throw error;}}else{await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/admin/housekeeping'),card.getByRole('button',{name:label,exact:true}).click()]);}await open(page);}
  await open(maid.page);await act(maid.page,'Comenzar');await act(maid.page,'Informar impedimento','Fuga de agua sintética');
  await open(admin.page);await act(admin.page,'Solicitar Mantenimiento','Reparar fuga sintética','ALTA');
  const linked=await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id},include:{maintenanceEntry:true}});assert.ok(linked.maintenanceEntry);
  const completeMessage=`Finaliza Mantenimiento #${linked.maintenanceEntry.humanId}: Válvula reparada y comprobada ${width}`;const resultKey=randomUUID();
  const response=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:completeMessage,requestKey:resultKey}});const body=await response.json();assert.equal(response.status(),200,body.error);assert.match(body.reply,/Completado/);
  const retry=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:completeMessage,requestKey:resultKey}});assert.equal(retry.status(),200);assert.equal(await db.housekeepingEvent.count({where:{requestId:work.id,action:'MANTENIMIENTO_RESULTADO'}}),1);
  await open(maid.page);const result=maid.page.getByRole('region',{name:'Resultado de Mantenimiento',exact:true});await result.getByText(`Válvula reparada y comprobada ${width}`,{exact:false}).waitFor();assert.equal(await result.getByRole('link',{name:'Ver incidencia'}).count(),0,'Area-only user gets scoped result, not a generic book link');
  assert.equal((await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}})).status,'BLOQUEADO');await act(maid.page,'Retomar','Resultado revisado, acceso seguro');await act(maid.page,'Marcar terminado','Limpieza realizada');
  assert.equal((await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}})).status,'POR_REVISAR');await open(admin.page);await act(admin.page,'Aprobar revisión','Inspección conforme');
  const final=await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}});assert.equal(final.status,'RESUELTO');assert.equal(final.inspectedById,f.users.admin.id);assert.equal(final.humanId,work.humanId);assert.deepEqual(await db.room.findUniqueOrThrow({where:{id:room.id}}),room);
  const query=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:`Consulta el resultado de Housekeeping #${work.humanId}`,requestKey:randomUUID()}});assert.equal(query.status(),200);const queryBody=await query.json();assert.match(queryBody.reply,/Inspección conforme/);assert.match(queryBody.reply,/Válvula reparada/);
  results.push({width,scenario:'HK-impediment-maintenance-native-Fronti-result-retry-resume-inspection',status:'passed',physicalSafari:false,provider:'not-used'});
  for(const context of contexts)await context.close();
 }
 console.log('Etapa 3 authenticated desktop/mobile journeys passed.',JSON.stringify(results));
}catch(error){
 const failed=await db.frontiExecutionStep.findMany({where:{execution:{userId:{in:Object.values(f.users).map(u=>u.id)}},status:{notIn:['SUCCEEDED','PENDING']}},select:{action:true,status:true,result:true},take:20,orderBy:{startedAt:'desc'}});
 console.error('Synthetic native failure results:',JSON.stringify(failed));
 for(const page of pages)if(!page.isClosed()){try{console.error('Synthetic visible page:',(await page.locator('main').innerText({timeout:1000})).slice(-5000));}catch{}}
 throw error;
}finally{writeFileSync('etapa3-browser-results.json',JSON.stringify(results,null,2));await browser.close();await db.$disconnect();}
