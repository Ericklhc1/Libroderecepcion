import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CurrentUser} from '@/server/auth/current-user';
import {createUser,createShift,seedCatalog,resetOperationalData,prisma,ROLE_KEYS} from './helpers';
import {listPendingClosureReviews,reviewShiftClosure} from '@/server/services/closure-review';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePageUser:async()=>auth.user}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('@/components/supervision/closure-review-form',()=>({ClosureReviewForm:()=> <span>FORMULARIO_VALIDAR</span>}));
import ClosureReviewPage from '@/app/(app)/supervision/cierres/[id]/page';

describe('cierre histórico: evidencia vigente en ficha, Centro y Fronti',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
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
