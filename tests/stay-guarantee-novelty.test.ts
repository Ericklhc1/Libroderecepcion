import {beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {ensureUnresolvedGuaranteeIncidents} from '@/server/services/stay-guarantee-incidents';
import {readEntries} from '@/server/services/entry-visibility';
async function setup(){const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const reservation=await prisma.reservationReference.create({data:{code:'GUARANTEE-SYNTHETIC-CHECKOUT'}});const guarantee=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:50000,createdById:author.id,reservationReferenceId:reservation.id,guestName:'Huésped sintético'}});return{author,reservation,guarantee};}
describe('incidencia de garantía del motor existente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  for(const enabled of [false,true])for(const mutation of ['return','close','delete','update-open'] as const)it(`relee garantía tras ${mutation} concurrente, modo simple ${enabled}`,async()=>{
    const {author,reservation,guarantee}=await setup();await prisma.systemSetting.create({data:{key:'book.simpleNovelties',category:'pruebas',value:enabled}});
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let locked!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});
    const change=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "Guarantee" WHERE "id"=${guarantee.id} FOR UPDATE`;await tx.guarantee.update({where:{id:guarantee.id},data:mutation==='delete'?{deletedAt:new Date()}:mutation==='update-open'?{state:'VIGENTE',amount:70000}:{state:mutation==='return'?'DEVUELTA':'CERRADA'}});locked();await gate;});
    let attempt:Promise<number>|undefined;
    try{
      await ready;attempt=ensureUnresolvedGuaranteeIncidents(author,reservation.id,'408');
      let waiting=false;for(let index=0;index<100&&!waiting;index++){
        const rows=await prisma.$queryRaw<{count:bigint}[]>`SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Guarantee"%FOR UPDATE%'`;
        waiting=Number(rows[0]?.count??0)>0;if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);release();await change;expect(await attempt).toBe(mutation==='update-open'?1:0);
      expect(await prisma.operationalEntry.count()).toBe(mutation==='update-open'?1:0);expect(await prisma.alert.count()).toBe(mutation==='update-open'?1:0);
      if(mutation==='update-open'){const entry=await prisma.operationalEntry.findFirstOrThrow();expect(entry.description).toContain('estado VIGENTE');expect(entry.description).toContain('CLP 70000');expect((await prisma.auditLog.findFirstOrThrow({where:{entityId:entry.id}})).after).toMatchObject({state:'VIGENTE'});}else expect(await prisma.auditLog.count({where:{entity:'OperationalEntry'}})).toBe(0);
    }finally{release();await change;await attempt;}
  });

  it('la deduplicación no depende de que el recepcionista pueda leer el origen reservado',async()=>{
    const {author,reservation,guarantee}=await setup();const other=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});expect(await ensureUnresolvedGuaranteeIncidents(author,reservation.id,'408')).toBe(1);
    const original=await prisma.operationalEntry.findFirstOrThrow({where:{tags:{has:`garantia-post-salida:${guarantee.id}`}}});const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await prisma.operationalEntry.update({where:{id:original.id},data:{hiddenFromDepartments:{connect:{id:area.id}}}});expect(await readEntries(prisma,other).count({where:{id:original.id}})).toBe(0);
    expect(await ensureUnresolvedGuaranteeIncidents(other,reservation.id,'408')).toBe(0);expect(await prisma.operationalEntry.count({where:{tags:{has:`garantia-post-salida:${guarantee.id}`}}})).toBe(1);expect((await prisma.alert.findUniqueOrThrow({where:{dedupeKey:`guarantee-unresolved-checkout:${guarantee.id}`}})).entryId).toBe(original.id);
  });
  it('dos comprobaciones concurrentes conservan una incidencia y el texto/auditoría reflejan su dueño real',async()=>{
    const {author,reservation,guarantee}=await setup();await prisma.systemSetting.create({data:{key:'book.simpleNovelties',category:'pruebas',value:true}});
    const results=await Promise.all([ensureUnresolvedGuaranteeIncidents(author,reservation.id,'408'),ensureUnresolvedGuaranteeIncidents(author,reservation.id,'408')]);expect(results.sort()).toEqual([0,1]);
    const entry=await prisma.operationalEntry.findFirstOrThrow({where:{tags:{has:`garantia-post-salida:${guarantee.id}`}}});expect(entry.ownerId).toBeNull();const alert=await prisma.alert.findUniqueOrThrow({where:{dedupeKey:`guarantee-unresolved-checkout:${guarantee.id}`}});expect(alert.message).toContain('sin asignación individual');expect(alert.message).not.toContain('asignada inicialmente');const audit=await prisma.auditLog.findFirstOrThrow({where:{entityId:entry.id,summary:{contains:'Incidencia automática'}}});expect(audit.after).toMatchObject({ownerId:null});
  });
});
