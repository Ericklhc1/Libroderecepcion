import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CurrentUser} from '@/server/auth/current-user';
import {createUser,createShift,seedCatalog,resetOperationalData,prisma,ROLE_KEYS} from './helpers';
import {listPendingClosureReviews,reviewShiftClosure} from '@/server/services/closure-review';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePageUser:async()=>auth.user}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){},push(){},replace(){},prefetch(){}}),usePathname:()=>'/alertas/sistema',useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('@/components/supervision/closure-review-form',()=>({ClosureReviewForm:()=> <span>FORMULARIO_VALIDAR</span>}));
import {resolveAlert,softDeleteAlert} from '@/server/services/alerts';
import {createTask} from '@/server/services/tasks';
import AlertsPage from '@/app/(app)/alertas/sistema/page';
import ClosureReviewPage from '@/app/(app)/supervision/cierres/[id]/page';

describe('cierre histórico: evidencia vigente en ficha, Centro y Fronti',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('un cierre archivado conserva la revisión obligatoria en Centro, ficha y Fronti hasta Validar',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});auth.user=supervisor;
    const shift=await createShift({userId:reception.id,type:'DIA'});
    await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date(),closedById:reception.id}});
    const archived=await prisma.shift.update({where:{id:shift.id},data:{archivedAt:new Date(),archivedById:supervisor.id}});
    expect((await listPendingClosureReviews(supervisor)).map(r=>r.id)).toContain(shift.id);
    expect(renderToStaticMarkup(await ClosureReviewPage({params:Promise.resolve({id:shift.id})}))).toContain('FORMULARIO_VALIDAR');
    expect(await executeFrontiPageContextTool(supervisor,resolveFrontiPageContext({pathname:`/supervision/cierres/${shift.id}`}))).toMatchObject({snapshot:{pending:true}});
    const observed=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'OBSERVADA',note:'Falta evidencia sintética',revision:archived.updatedAt.toISOString()});
    expect((await listPendingClosureReviews(supervisor)).map(r=>r.id)).toContain(shift.id);
    const validated=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'VALIDADA',note:'Evidencia sintética conforme',revision:observed.updatedAt.toISOString()});
    expect(validated.archivedAt).toEqual(archived.archivedAt);
    expect((await listPendingClosureReviews(supervisor)).map(r=>r.id)).not.toContain(shift.id);
    expect(await prisma.auditLog.count({where:{entity:'Shift',entityId:shift.id,action:'CAMBIO_ESTADO'}})).toBe(2);
  });
  it('una alerta histórica sólo enlaza el cierre y no permite resolverlo ni crear tareas invisibles',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});auth.user=supervisor;
    const shift=await createShift({userId:reception.id,type:'DIA'});
    await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date(),closedById:reception.id}});
    const old=await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});
    const legacy=await prisma.alert.create({data:{type:'OTRO',title:'Validar cierre de turno',dedupeKey:`shift-validation:${shift.id}`}});
    const count=await prisma.auditLog.count();
    await expect(resolveAlert(supervisor,{id:legacy.id,note:'Intento de resolución directa'})).rejects.toThrow(/Centro de Supervisión/);
    await expect(softDeleteAlert(supervisor,{id:legacy.id,reason:'Intento de omisión'})).rejects.toThrow(/se conservan/);
    await expect(createTask(supervisor,{title:'Tarea invisible prohibida',alertId:legacy.id,priority:'MEDIA',tags:[],checklist:[]})).rejects.toThrow(/Centro de Supervisión/);
    expect(await prisma.alert.findUnique({where:{id:legacy.id}})).toMatchObject({status:'NUEVA'});expect(await prisma.task.count()).toBe(0);expect(await prisma.auditLog.count()).toBe(count);
    expect((await listPendingClosureReviews(supervisor)).map(r=>r.id)).toContain(shift.id);
    const html=renderToStaticMarkup(await AlertsPage({searchParams:Promise.resolve({})}));
    expect(html).toContain(`/supervision/cierres/${shift.id}`);expect(html).toContain('Validar / Observar');expect(html).not.toContain('Crear tarea desde la alerta');expect(html).not.toContain('Resolver señal');
    const validated=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'VALIDADA',note:'Caja y evidencias revisadas',revision:old.updatedAt.toISOString()});
    expect(validated.closureReviewDecision).toBe('VALIDADA');expect((await listPendingClosureReviews(supervisor)).map(r=>r.id)).not.toContain(shift.id);
    expect(await prisma.auditLog.count({where:{entity:'Shift',entityId:shift.id,summary:{startsWith:'Cierre validado'},reason:'Caja y evidencias revisadas'}})).toBe(1);
    expect(await prisma.alert.findUnique({where:{id:legacy.id}})).toMatchObject({status:'NUEVA'});
  });
  for(const reviewer of [true,false])it(`el enlace histórico usa permisos de revisión y no de alertas: reviewer=${reviewer}`,async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const shift=await createShift({userId:reception.id,type:'DIA'});
    await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date()}});await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});await prisma.alert.create({data:{type:'OTRO',title:'Validar cierre de turno',dedupeKey:`shift-validation:${shift.id}`}});
    auth.user={...supervisor,permissions:supervisor.permissions.filter(p=>reviewer?!['alert.manage','supervision.center.view'].includes(p):p!=='shift.manage')};
    const html=renderToStaticMarkup(await AlertsPage({searchParams:Promise.resolve({})}));
    if(reviewer){expect(html).toContain(`/supervision/cierres/${shift.id}`);expect(html).toContain('Validar / Observar');}else{expect(html).not.toContain(`/supervision/cierres/${shift.id}`);expect(html).not.toContain('Validar / Observar');}
    expect(html).not.toContain('Crear tarea desde la alerta');
  });
  for(const status of ['NUEVA','RESUELTA'] as const)it(`una alerta eliminada ${status} no habilita revisión ni acredita validación`,async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});auth.user=supervisor;
    const shift=await createShift({userId:reception.id,type:'DIA'});
    await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date()}});
    const old=await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});
    const legacy=await prisma.alert.create({data:{type:'OTRO',title:'Validar cierre de turno',dedupeKey:`shift-validation:${shift.id}`,status,deletedAt:new Date()}});
    const html=renderToStaticMarkup(await ClosureReviewPage({params:Promise.resolve({id:shift.id})}));
    expect(html).not.toContain('FORMULARIO_VALIDAR');expect(html).not.toContain('VALIDADA (histórica)');expect(html).toContain('Sin solicitud vigente');
    expect((await listPendingClosureReviews(supervisor)).map(r=>r.id)).not.toContain(shift.id);
    expect(await executeFrontiPageContextTool(supervisor,resolveFrontiPageContext({pathname:`/supervision/cierres/${shift.id}`}))).toMatchObject({snapshot:{pending:false}});
    await expect(reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'VALIDADA',note:'Prueba',revision:old.updatedAt.toISOString()})).rejects.toThrow(/no tiene una validación pendiente/);
    expect(await prisma.alert.findUnique({where:{id:legacy.id}})).not.toBeNull();
  });
});
