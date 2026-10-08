import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createUser,createShift,openShiftAs,prisma,seedCatalog,resetOperationalData,ROLE_KEYS} from './helpers';
import type {CurrentUser} from '@/server/auth/current-user';
import {receiveHandover,prepareHandover,confirmHandoverReviewStep,sendHandover,closeShift,cancelHandoverPreparation} from '@/server/services/shifts';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePageUser:async()=>auth.user}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('next/navigation',()=>({notFound(){throw Error('not found');},useRouter:()=>({refresh(){},push(){},replace(){}}),usePathname:()=>'/turno/entrega/test',useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/components/operational/comments',()=>({Comments:()=>null}));
vi.mock('@/components/operational/cash-box',()=>({CashBox:()=>null}));
vi.mock('@/components/operational/form-draft-session',()=>({ClearHandoverDrafts:()=>null}));
import HandoverPage from '@/app/(app)/turno/entrega/[id]/page';

describe('acta real: participantes y revisión por rol',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('conserva el participante que terminó por cierre y la evidencia del retirado, sin imprimirlo como entregante ni asignar auditor nominal',async()=>{
    const issuer=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST,name:'Emisor sintético'});const removed=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST,name:'RETIRADO_NO_ENTREGA_164'});const support=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST,name:'APOYO_CIERRE_NORMAL_164'});auth.user=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const shift=await createShift({userId:issuer.id,type:'DIA'});await openShiftAs(issuer,shift);await receiveHandover(issuer,{shiftId:shift.id});
    await prisma.shiftAssignment.createMany({data:[{shiftId:shift.id,userId:removed.id,role:'APOYO',activatedAt:new Date(),leftAt:new Date(),removedExplicitly:true},{shiftId:shift.id,userId:support.id,role:'APOYO',activatedAt:new Date()}]});
    const handover=await prepareHandover(issuer,shift.id);await confirmHandoverReviewStep(issuer,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(issuer,{handoverId:handover.id,step:'FINAL'});await sendHandover(issuer,{shiftId:shift.id});await closeShift(issuer,{shiftId:shift.id});
    const html=renderToStaticMarkup(await HandoverPage({params:Promise.resolve({id:handover.id}),searchParams:Promise.resolve({})}));const print=html.match(/<article class="handover-print"[\s\S]*?<\/article>/)?.[0];expect(print).toBeDefined();expect(print).toContain(issuer.name);expect(print).toContain(support.name);expect(print).not.toContain(removed.name);expect(html).not.toContain('Erick Herrera o auditor designado');expect(html).toContain('Supervisión / Administrador de sistema');
    expect(await prisma.shiftAssignment.findUnique({where:{shiftId_userId:{shiftId:shift.id,userId:removed.id}}})).toMatchObject({removedExplicitly:true});expect(await prisma.shiftAssignment.findUnique({where:{shiftId_userId:{shiftId:shift.id,userId:support.id}}})).toMatchObject({removedExplicitly:false,leftAt:expect.any(Date)});
  });
  it('rechaza la URL conocida para un lector sin capacidad de turno o revisión antes de consultar el acta',async()=>{
    const reader=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});auth.user={...reader,permissions:[]};
    const query=vi.spyOn(prisma.shiftHandover,'findUnique');
    try {await expect(HandoverPage({params:Promise.resolve({id:'folio-conocido-sintetico'}),searchParams:Promise.resolve({})})).rejects.toThrow('not found');expect(query).not.toHaveBeenCalled();}finally{query.mockRestore();}
  });

  it('una preparación anulada conserva el acta y excluye informe y botón de impresión en su URL',async()=>{
    const issuer=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});auth.user=issuer;
    const shift=await createShift({userId:issuer.id,type:'DIA'});await openShiftAs(issuer,shift);await receiveHandover(issuer,{shiftId:shift.id});const handover=await prepareHandover(issuer,shift.id);await cancelHandoverPreparation(issuer,shift.id);
    const html=renderToStaticMarkup(await HandoverPage({params:Promise.resolve({id:handover.id}),searchParams:Promise.resolve({})}));expect(html).not.toContain('handover-print');expect(html).not.toContain('Imprimir informe de turno');expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'ANULADA'});
  });

});
