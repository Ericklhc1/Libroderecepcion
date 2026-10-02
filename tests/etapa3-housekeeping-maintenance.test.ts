import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser} from './helpers';
import {ROLE_KEYS} from '@/lib/permissions';
import type {CurrentUser} from '@/server/auth/current-user';
import {hotelDateKey} from '@/domain/time';
import {createHkWork,changeHkWork,getHkWorkday} from '@/server/services/housekeeping-work';
import {changeEntryStatus,updateEntry} from '@/server/services/entries';
import {executeFrontiCommand} from '@/server/ai/execution/commands';
import {parseNaturalHousekeeping} from '@/server/ai/execution/natural-housekeeping';
let actor:CurrentUser;
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:async()=>{
 const row=await prisma.user.findUnique({where:{id:actor.id},include:{role:{include:{permissions:{include:{permission:true}}}}}});
 return row?.active?{...actor,roleKey:row.role.key,roleId:row.roleId,departmentId:row.departmentId,permissions:row.role.permissions.map(p=>p.permission.key)}:null;
}}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
describe('Etapa 3: resultado entre áreas sin duplicar trabajo',()=>{
 let admin:CurrentUser,maid:CurrentUser,other:CurrentUser,supervisor:CurrentUser,area:string,roomId:string;
 beforeAll(seedCatalog);
 beforeEach(async()=>{
  await resetOperationalData();admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});other=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});supervisor=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});actor=admin;
  area=(await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}})).id;roomId=(await prisma.room.findUniqueOrThrow({where:{number:'512'}})).id;
  await prisma.user.updateMany({where:{id:{in:[admin.id,maid.id,other.id,supervisor.id]}},data:{departmentId:area}});
 });
 async function change(user:CurrentUser,id:string,action:Parameters<typeof changeHkWork>[1]['action'],note='Hecho declarado',extra:Record<string,unknown>={}){const r=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id}});return changeHkWork(user,{id,version:r.version,action,note,...extra});}
 async function blocked(){const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Limpieza solicitada',description:'Limpiar tras revisión de fuga',departmentId:area,workDate:hotelDateKey(new Date()),workKind:'LIMPIEZA',roomId,priority:'ALTA',effortMinutes:25,assignedToId:maid.id});await change(maid,r.id,'COMENZAR');await change(maid,r.id,'IMPEDIMENTO','Fuga de agua');return change(supervisor,r.id,'MANTENIMIENTO','Reparar fuga',{severity:'ALTA'});}
 it('devuelve resultado y evidencia, exige retomar e inspeccionar, sin cambios comerciales',async()=>{
  const r=await blocked();const roomBefore=await prisma.room.findUniqueOrThrow({where:{id:roomId}});
  await expect(change(maid,r.id,'RETOMAR')).rejects.toThrow('resultado vigente');
  await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'RESUELTO',resolution:'Válvula reparada y probada'});
  const current=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}});expect(current.status).toBe('BLOQUEADO');expect(current.assignedToId).toBe(maid.id);expect(current.humanId).toBe(r.humanId);expect(current.version).toBeGreaterThan(r.version);
  const board=await getHkWorkday(maid,{focusId:r.humanId});expect(board.requests[0]?.maintenanceEntry?.resolution).toBe('Válvula reparada y probada');expect((await getHkWorkday(other,{focusId:r.humanId})).requests).toHaveLength(0);
  await expect(changeHkWork(maid,{id:r.id,version:r.version,action:'RETOMAR',note:'Formulario anterior'})).rejects.toThrow('cambió');
  await change(maid,r.id,'RETOMAR','Resultado revisado, acceso seguro');await change(maid,r.id,'TERMINAR','Limpieza realizada');await change(supervisor,r.id,'APROBAR','Inspección conforme');
  expect((await getHkWorkday(admin,{focusId:r.humanId})).requests[0]?.resolution).toContain('Inspección conforme');
  expect(await prisma.room.findUniqueOrThrow({where:{id:roomId}})).toEqual(roomBefore);expect(await prisma.roomStay.count()).toBe(0);expect(await prisma.shift.count()).toBe(0);
  expect(await prisma.task.count({where:{entryId:r.maintenanceEntryId}})).toBe(1);expect(await prisma.followUp.count({where:{entryId:r.maintenanceEntryId}})).toBe(1);
 });
 it('rechaza un resultado vacío y revierte la transición y sus derivados',async()=>{
  const r=await blocked();const before=await prisma.operationalEntry.findUniqueOrThrow({where:{id:r.maintenanceEntryId!}});const events=await prisma.housekeepingEvent.count({where:{requestId:r.id}});
  await expect(changeEntryStatus(admin,{id:before.id,status:'RESUELTO',resolution:'   '})).rejects.toThrow('resultado de Mantenimiento');
  expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:before.id}})).status).toBe(before.status);expect(await prisma.housekeepingEvent.count({where:{requestId:r.id}})).toBe(events);
 });
 it('reintentos concurrentes generan un solo resultado y conservan ambas identidades vinculadas',async()=>{
  const r=await blocked();const command={id:r.maintenanceEntryId!,status:'RESUELTO' as const,resolution:'Fuga corregida'};
  const attempts=await Promise.allSettled([changeEntryStatus(admin,command),changeEntryStatus(admin,command)]);expect(attempts.some(x=>x.status==='fulfilled')).toBe(true);
  await changeEntryStatus(admin,command);expect(await prisma.housekeepingEvent.count({where:{requestId:r.id,action:'MANTENIMIENTO_RESULTADO'}})).toBe(1);
  expect(await prisma.housekeepingRequest.count({where:{maintenanceEntryId:r.maintenanceEntryId}})).toBe(1);expect(await prisma.operationalEntry.count({where:{id:r.maintenanceEntryId!}})).toBe(1);
 });
 it('ediciones del resultado y reapertura quedan en el mismo historial, sin resolver Housekeeping',async()=>{
  const r=await blocked();await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'RESUELTO',resolution:'Ajuste inicial'});
  await updateEntry(admin,{id:r.maintenanceEntryId!,resolution:'Prueba adicional completada'});await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'EN_CURSO',reason:'Revisión adicional'});
  await expect(change(maid,r.id,'RETOMAR')).rejects.toThrow('resultado vigente');
  const events=await prisma.housekeepingEvent.findMany({where:{requestId:r.id,action:{startsWith:'MANTENIMIENTO_'}}});expect(events.map(e=>e.action)).toEqual(expect.arrayContaining(['MANTENIMIENTO_RESULTADO','MANTENIMIENTO_REABIERTO']));expect(events.some(e=>e.note?.includes('Prueba adicional completada'))).toBe(true);
  expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('BLOQUEADO');
 });
 it('no envía la actualización a una persona que perdió el acceso al área',async()=>{
  const r=await blocked();const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.RECEPTIONIST}});await prisma.user.update({where:{id:maid.id},data:{roleId:role.id,departmentId:(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id}});
  const before=await prisma.notification.count({where:{userId:maid.id,entityId:r.id}});await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'RESUELTO',resolution:'Reparación terminada'});expect(await prisma.notification.count({where:{userId:maid.id,entityId:r.id}})).toBe(before);
 });
 it('Fronti completa instrucciones naturales por pasos nativos y un reintento no duplica el efecto',async()=>{
  const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Reposición',description:'Reponer tras revisión',departmentId:area,workDate:hotelDateKey(new Date()),workKind:'REPOSICION',roomId,priority:'MEDIA',effortMinutes:10,assignedToId:admin.id});
  const key=randomUUID();const taking=`Toma Housekeeping #${r.humanId}`;expect((await executeFrontiCommand(taking,key))?.reply).toContain('Completado');expect((await executeFrontiCommand(taking,key))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(`Informa impedimento en Housekeeping #${r.humanId}: Falta reparar fuga`,randomUUID()))?.reply).toContain('Completado');
  const before=await prisma.frontiExecution.count();expect((await executeFrontiCommand(`Solicita Mantenimiento para Housekeeping #${r.humanId}: Reparar fuga`,randomUUID()))?.reply).toContain('gravedad');expect(await prisma.frontiExecution.count()).toBe(before);
  expect((await executeFrontiCommand(`Solicita Mantenimiento para Housekeeping #${r.humanId} con gravedad ALTA: Reparar fuga`,randomUUID()))?.reply).toContain('Completado');
  const maintenance=(await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id},include:{maintenanceEntry:true}})).maintenanceEntry!;
  expect((await executeFrontiCommand(`Finaliza Mantenimiento #${maintenance.humanId}: Reparación comprobada`,randomUUID()))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(`Consulta el resultado de Housekeeping #${r.humanId}`))?.reply).toContain('Reparación comprobada');
  expect((await executeFrontiCommand(`Retoma Housekeeping #${r.humanId}: Resultado revisado`,randomUUID()))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(`Finaliza Housekeeping #${r.humanId}: Reposición terminada`,randomUUID()))?.reply).toContain('Completado');
  expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('RESUELTO');
 });
 it('no interpreta citas, negaciones, preguntas ni ausencia de un folio como autorización',()=>{
  for(const message of ['No finaliza Housekeeping #123: prueba','Documento ajeno: Toma Housekeeping #123','¿Toma Housekeeping #123?','Toma Housekeeping','Toma Housekeeping #123\nFinaliza Mantenimiento #456: texto'])expect(parseNaturalHousekeeping(message)).toBeNull();
 });
});
