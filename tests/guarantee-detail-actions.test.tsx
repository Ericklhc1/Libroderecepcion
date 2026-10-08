import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createUser,openShiftAs,prisma,seedCatalog,resetOperationalData,ROLE_KEYS} from './helpers';
import {receiveHandover} from '@/server/services/shifts';
import type {CurrentUser} from '@/server/auth/current-user';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePagePermission:async()=>auth.user}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('next/navigation',()=>({notFound(){throw Error('not found');}}));
vi.mock('@/components/cash/live-cash-forms',()=>({EditCashGuaranteeForm:()=> <span>EDITAR_GARANTIA</span>,ChargeCashGuaranteeForm:()=> <span>COBRAR_GARANTIA</span>,ReturnCashGuaranteeForm:()=> <span>DEVOLVER_GARANTIA</span>}));
import GuaranteePage from '@/app/(app)/caja/garantias/[id]/page';

describe('registro concreto de garantía: acciones consistentes con liquidación nativa',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  for(const state of ['PENDIENTE','VIGENTE','APLICADA_PARCIALMENTE','CERRADA'] as const)it(`estado ${state} en turno activo`,async()=>{
    const user=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});auth.user=user;const shift=await openShiftAs(user);await receiveHandover(user,{shiftId:shift.id});
    const g=await prisma.guarantee.create({data:{kind:'EFECTIVO',state,currency:'CLP',amount:10000,createdById:user.id,guestName:'Garantía sintética'}});const before=await prisma.guarantee.findUniqueOrThrow({where:{id:g.id}});
    const html=renderToStaticMarkup(await GuaranteePage({params:Promise.resolve({id:g.id})}));
    const settle=state==='VIGENTE'||state==='APLICADA_PARCIALMENTE';expect(html.includes('COBRAR_GARANTIA')).toBe(settle);expect(html.includes('DEVOLVER_GARANTIA')).toBe(settle);expect(html.includes('EDITAR_GARANTIA')).toBe(state!=='CERRADA');expect(await prisma.guarantee.findUnique({where:{id:g.id}})).toEqual(before);expect(await prisma.guaranteeSettlement.count()).toBe(0);
  });
  it('una garantía parcial sin saldo no anuncia otro cobro ni devolución',async()=>{
    const user=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});auth.user=user;const shift=await openShiftAs(user);await receiveHandover(user,{shiftId:shift.id});const g=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'APLICADA_PARCIALMENTE',currency:'CLP',amount:10000,appliedAmount:10000,createdById:user.id}});
    const html=renderToStaticMarkup(await GuaranteePage({params:Promise.resolve({id:g.id})}));expect(html).not.toContain('COBRAR_GARANTIA');expect(html).not.toContain('DEVOLVER_GARANTIA');
  });
});
