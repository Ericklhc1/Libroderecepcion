import {beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {ensureUnresolvedGuaranteeIncidents} from '@/server/services/stay-guarantee-incidents';
import {readEntries} from '@/server/services/entry-visibility';
async function setup(){const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const reservation=await prisma.reservationReference.create({data:{code:'GUARANTEE-SYNTHETIC-CHECKOUT'}});const guarantee=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:50000,createdById:author.id,reservationReferenceId:reservation.id,guestName:'Huésped sintético'}});return{author,reservation,guarantee};}
describe('incidencia de garantía del motor existente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
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
