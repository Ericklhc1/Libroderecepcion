import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {SignJWT} from 'jose';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const fixture=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const db=new PrismaClient();const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const results=[];
async function context(key,width){const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.addCookies([{name:'lor_session',value:fixture.users[key].token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);await ctx.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(path=>url.pathname.startsWith(path))?route.abort():route.continue();});const page=await ctx.newPage();page.setDefaultTimeout(15000);return{ctx,page};}
async function toggle(page,value){await page.goto('http://localhost:3000/admin/parametros?categoria=pruebas');const control=page.locator('[id="value-book.simpleNovelties"]');await control.selectOption(String(value));await control.locator('xpath=ancestor::form').getByRole('button',{name:'Guardar',exact:true}).click();await page.getByText('Parámetro actualizado.',{exact:true}).waitFor();assert.equal((await db.systemSetting.findUnique({where:{key:'book.simpleNovelties'}})).value,value);}
try{
  const area=await db.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});await db.user.update({where:{id:fixture.users.maid.id},data:{departmentId:area.id}});
  const template=await db.user.findUniqueOrThrow({where:{id:fixture.users.admin.id}});const role=await db.role.findUniqueOrThrow({where:{key:'RECEPCIONISTA'}});
  const outgoing=await db.user.create({data:{name:'Recepcionista saliente sintético',username:'simple_outgoing_ui',passwordHash:'synthetic-no-login',roleId:role.id,departmentId:fixture.areaId,mustChangePassword:false,tutorialDoneAt:template.tutorialDoneAt,tutorialKnownModules:template.tutorialKnownModules}});
  for(const accepted of await db.legalAcceptance.findMany({where:{userId:template.id}}))await db.legalAcceptance.create({data:{userId:outgoing.id,document:accepted.document,version:accepted.version}});
  const expiresAt=new Date(Date.now()+3600000);const session=await db.session.create({data:{userId:outgoing.id,expiresAt}});fixture.users.outgoing={id:outgoing.id,token:await new SignJWT({sub:outgoing.id,sid:session.id}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime()/1000)).sign(new TextEncoder().encode(process.env.AUTH_SECRET))};
  for(const width of [1280,390]){
    const admin=await context('admin',width);const errors=[];admin.page.on('pageerror',error=>errors.push(error.message));
    await toggle(admin.page,false);await admin.page.goto('http://localhost:3000/libro');assert.equal(await admin.page.getByText('Prueba de novedades simples',{exact:true}).count(),0);
    await toggle(admin.page,true);await admin.page.goto('http://localhost:3000/libro');await admin.page.getByText('Prueba de novedades simples',{exact:true}).waitFor();
    for(const internal of [false,true]){
      await admin.page.getByText('+ Nueva novedad',{exact:true}).click();const form=admin.page.locator('form').filter({has:admin.page.locator('[name="title"]')});
      const title=`${internal?'INTERNA':'SIMPLE'}_UI_${width}`;await form.locator('[name="title"]').fill(title);await form.locator('[name="description"]').fill('Descripción sintética de la novedad');await form.locator('[name="reservationReference"]').fill('7484708');await form.locator('[name="departmentId"]').selectOption(area.id);await form.locator('[name="workNextAction"]').fill('Seguimiento sintético');if(internal)await form.locator('[name="internal"]').check();
      await form.getByRole('button',{name:'Guardar novedad',exact:true}).click();await admin.page.getByRole('link',{name:new RegExp(title)}).waitFor();
      const row=await db.operationalEntry.findFirstOrThrow({where:{title}});assert.equal(row.ownerId,null);assert.equal(row.receptionInternal,internal);assert.equal(row.reservationReference,'7484708');
      await admin.page.goto('http://localhost:3000/libro');
    }
    const pagingPrefix=`PAGINA_UI_${width}`;await db.operationalEntry.createMany({data:Array.from({length:41},(_,index)=>({type:'NOVEDAD',title:`${pagingPrefix}_${index}`,description:'Paginación sintética',createdById:fixture.users.admin.id,departmentId:area.id,occurredAt:new Date(Date.now()+index*1000)}))});
    const maid=await context('maid',width);await maid.page.goto('http://localhost:3000/housekeeping');await maid.page.getByText(`SIMPLE_UI_${width}`,{exact:false}).waitFor();assert.equal(await maid.page.getByText(`INTERNA_UI_${width}`,{exact:false}).count(),0);assert.equal(await maid.page.getByText('Operativas internas de Recepción',{exact:false}).count(),0);await maid.page.goto(`http://localhost:3000/housekeeping?q=${pagingPrefix}&area=${area.id}`);await maid.page.getByRole('link',{name:'Más novedades →',exact:true}).click();await maid.page.getByText(`${pagingPrefix}_0`,{exact:false}).waitFor();assert.equal(new URL(maid.page.url()).searchParams.get('novedadesPagina'),'2');assert.equal(new URL(maid.page.url()).searchParams.get('q'),pagingPrefix);await maid.ctx.close();await db.operationalEntry.deleteMany({where:{title:{startsWith:pagingPrefix}}});
    const out=await context('outgoing',width);await out.page.goto('http://localhost:3000/libro');const row=out.page.locator('tr').filter({hasText:`SIMPLE_UI_${width}`});await row.getByRole('button',{name:'Marcar resuelta',exact:true}).click();await out.page.getByText('Novedad resuelta.',{exact:true}).waitFor();assert.equal((await db.operationalEntry.findFirstOrThrow({where:{title:`SIMPLE_UI_${width}`}})).status,'RESUELTO');await out.ctx.close();
    await toggle(admin.page,false);await admin.page.goto('http://localhost:3000/libro');assert.equal(await admin.page.getByText('Prueba de novedades simples',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);await admin.ctx.close();results.push({width,flagOff:true,flagOn:true,areaVisibility:true,internalPrivacy:true,outgoingResolvedWithoutShift:true,areaPagination:true});
  }
  writeFileSync('simple-novelties-browser-results.json',JSON.stringify({status:'passed',results},null,2));console.log('Simple novelties journeys passed: 1280 and 390');
}finally{await db.systemSetting.updateMany({where:{key:'book.simpleNovelties'},data:{value:false}});await browser.close();await db.$disconnect();}
