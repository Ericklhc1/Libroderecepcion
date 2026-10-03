import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser} from './helpers';
import {parseHotelDateInput} from '@/domain/time';
import {ROLE_KEYS} from '@/lib/permissions';
import {createLostFound,changeLostFound,listLostFound} from '@/server/services/lost-found';
import {coordinateWork} from '@/server/services/coordination';

describe('Etapa 3 bloque 2: coordinación y custodia',()=>{
 beforeAll(seedCatalog);beforeEach(resetOperationalData);
 it('conserva un único objeto, historial y cierre con evidencia ante reintentos',async()=>{
  const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const custodian=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const key=randomUUID();const foundAt=new Date();
  const first=await createLostFound(admin,{requestKey:key,item:'Mochila negra',foundLocation:'Lobby',foundAt,custodyLocation:'Gabinete recepción',custodianId:custodian.id});
  const retry=await createLostFound(admin,{requestKey:key,item:'Mochila negra',foundLocation:'Lobby',foundAt,custodyLocation:'Gabinete recepción',custodianId:custodian.id});
  expect(retry.id).toBe(first.id);expect(await prisma.lostFoundItem.count({where:{requestKey:key}})).toBe(1);
  const moved=await changeLostFound(admin,{id:first.id,version:first.version,action:'MOVER',custodyLocation:'Caja fuerte de objetos',custodianId:custodian.id,note:'Cambio de custodia'});
  const attempts=await Promise.allSettled([
   changeLostFound(admin,{id:first.id,version:moved.version,action:'ENTREGAR',note:'Entrega registrada',evidenceNote:'Acta interna LF-001'}),
   changeLostFound(admin,{id:first.id,version:moved.version,action:'ENTREGAR',note:'Entrega duplicada',evidenceNote:'Acta interna LF-002'})
  ]);
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const final=await prisma.lostFoundItem.findUniqueOrThrow({where:{id:first.id}});expect(final.status).toBe('ENTREGADO');expect(final.evidenceNote).toMatch(/LF-00/);
  expect(await prisma.lostFoundEvent.count({where:{itemId:first.id}})).toBe(3);
 });
 it('rechaza mover un objeto cerrado y conserva evidencia al reabrir explícitamente',async()=>{
  const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
  const input={requestKey:randomUUID(),item:'Bolso',foundLocation:'Lobby',foundAt:new Date(),custodyLocation:'Gabinete'};
  const row=await createLostFound(admin,input);
  const closed=await changeLostFound(admin,{id:row.id,version:row.version,action:'DISPONER',note:'Disposición autorizada',evidenceNote:'Acta 42'});
  await expect(changeLostFound(admin,{id:row.id,version:closed.version,action:'MOVER',custodyLocation:'Otro lugar',note:'No debe reabrir'})).rejects.toThrow('cierre registrado');
  expect(await prisma.lostFoundItem.findUniqueOrThrow({where:{id:row.id}})).toEqual(closed);
  const reopened=await changeLostFound(admin,{id:row.id,version:closed.version,action:'REABRIR',note:'Corregir disposición registrada por error'});
  expect(reopened.status).toBe('EN_CUSTODIA');
  const logs=await prisma.auditLog.findMany({where:{entity:'LostFoundItem',entityId:row.id,action:'REABRIR'}});
  expect(logs[0]?.before).toMatchObject({evidenceNote:'Acta 42',finalAction:'Disposición autorizada'});
  await expect(createLostFound(admin,{...input,item:'Otro objeto'})).rejects.toThrow('reintento');
  expect((await createLostFound(admin,input)).id).toBe(row.id);
  const list=await listLostFound(admin,{q:'#'+row.humanId});expect(list).toHaveLength(1);
  expect(list[0]?.events.every(event=>event.actorName===admin.name)).toBe(true);
 });
 it('exige evidencia, evita sobrescrituras y no concede acceso por ser custodio',async()=>{
  const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
  const input={requestKey:randomUUID(),item:'Llave suelta',foundLocation:'Lobby',foundAt:new Date(),custodyLocation:'Gabinete'};
  await expect(createLostFound(admin,{...input,custodianId:maid.id})).rejects.toThrow('habilitado');
  const row=await createLostFound(admin,input);
  await expect(changeLostFound(admin,{id:row.id,version:row.version,action:'ENTREGAR',note:'Entrega'})).rejects.toThrow('evidencia');
  await expect(listLostFound(maid)).rejects.toThrow();
  const moved=await changeLostFound(admin,{id:row.id,version:row.version,action:'MOVER',note:'Actualizar lugar',custodyLocation:'Bodega'});
  await expect(changeLostFound(admin,{id:row.id,version:row.version,action:'MOVER',note:'Formulario antiguo',custodyLocation:'Pérdida'})).rejects.toThrow('cambió');
  expect((await prisma.lostFoundItem.findUniqueOrThrow({where:{id:row.id}})).version).toBe(moved.version);
 });
 it('interpreta el hallazgo sin zona en la hora del hotel, no en UTC',()=>{
  expect(parseHotelDateInput('2026-10-03T09:00').toISOString()).toBe('2026-10-03T12:00:00.000Z');
 });
 it('gerencia consulta pero no modifica custodia',async()=>{
  const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const manager=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});
  const row=await createLostFound(admin,{requestKey:randomUUID(),item:'Cargador',foundLocation:'Salón',foundAt:new Date(),custodyLocation:'Recepción'});
  expect((await listLostFound(manager)).map(x=>x.id)).toContain(row.id);
  await expect(changeLostFound(manager,{id:row.id,version:row.version,action:'MOVER',custodyLocation:'Oficina',note:'Mover'})).rejects.toThrow();
 });
 it('solicita aclaración al creador sin cambiar responsable ni crear otro asunto',async()=>{
  const creator=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const area=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
  const entry=await prisma.operationalEntry.create({data:{type:'INCIDENCIA',title:'Revisar filtración',description:'Se requiere revisión',severity:'MEDIA',departmentId:area.id,createdById:creator.id,ownerId:supervisor.id,workAssignedAt:new Date(),workAcknowledgedAt:new Date(),workAcknowledgedById:supervisor.id,workNextAction:'Revisar origen'}});
  await coordinateWork(supervisor,{kind:'entry',id:entry.id,updatedAt:entry.updatedAt,requestKey:randomUUID(),action:'ACLARACION',nextAction:'Indicar si la filtración continúa con lluvia'});
  const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:entry.id}});expect(current.ownerId).toBe(supervisor.id);expect(current.status).toBe('EN_ESPERA');expect(current.workNextAction).toContain('filtración');
  expect(await prisma.operationalEntry.count()).toBe(1);expect(await prisma.notification.count({where:{userId:creator.id,entityId:entry.id,type:'ACCION_REQUERIDA'}})).toBe(1);
 });
});
