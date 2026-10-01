import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { hotelDateKey } from '@/domain/time';
import { createHkWork, changeHkWork, getHkWorkday, saveHkRoutine, prepareHkDay, confirmHkAvailability, saveHkHandover, receiveHkHandover, delegateHk, revokeHkDelegation, organizeLegacyHkWork } from '@/server/services/housekeeping-work';
import { changeHousekeepingRequest } from '@/server/services/housekeeping';
import { searchOperationalRecords } from '@/server/services/global-search';
import { getEntry } from '@/server/services/entries';
import { hkAllowedActions, hkNextStatus, hkInspectionRequired } from '@/domain/housekeeping-work';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';

describe('Housekeeping: trabajo, área, inspección y continuidad',()=>{
  let admin:CurrentUser,manager:CurrentUser,supervisor:CurrentUser,maid:CurrentUser,other:CurrentUser,reception:CurrentUser,area:string,roomId:string;
  const date=()=>hotelDateKey(new Date());
  beforeAll(seedCatalog);
  beforeEach(async()=>{
    await resetOperationalData();
    area=(await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}})).id;
    roomId=(await prisma.room.findUniqueOrThrow({where:{number:'512'}})).id;
    admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});manager=await createUser({roleKey:ROLE_KEYS.HK_MANAGER});supervisor=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT,name:'Mucama A'});other=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT,name:'Mucama B'});reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    await prisma.user.updateMany({where:{id:{in:[admin.id,manager.id,supervisor.id,maid.id,other.id]}},data:{departmentId:area}});
  });
  const input=()=>({requestKey:randomUUID(),title:'Limpiar habitación 512',description:'Revisar limpieza y reposición.',departmentId:area,workDate:date(),workKind:'LIMPIEZA' as const,roomId,priority:'MEDIA' as const,effortMinutes:35});
  async function change(user:CurrentUser,id:string,action:Parameters<typeof changeHkWork>[1]['action'],note='Verificado',assignedToId?:string){const r=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id}});return changeHkWork(user,{id,version:r.version,action,note,assignedToId});}
  it('ejecuta el circuito completo, devuelve correcciones y comunica el resultado sin alterar el PMS',async()=>{
    const r=await createHkWork(reception,input());expect(r.requiresInspection).toBe(true);
    await change(supervisor,r.id,'ASIGNAR','Limpiar y revisar amenities',maid.id);
    await change(maid,r.id,'COMENZAR');await change(maid,r.id,'TERMINAR','Habitación limpia');
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('POR_REVISAR');
    await expect(change(maid,r.id,'APROBAR')).rejects.toThrow();
    await change(supervisor,r.id,'CORREGIR','Reponer toalla faltante');await change(maid,r.id,'COMENZAR');await change(maid,r.id,'TERMINAR','Toalla repuesta');await change(supervisor,r.id,'APROBAR','Inspección conforme');
    const done=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}});expect(done.inspectedById).toBe(supervisor.id);expect(done.resolvedAt).not.toBeNull();
    expect((await getHkWorkday(reception)).requests[0]?.resolution).toContain('Inspección conforme');
    expect(await prisma.notification.count({where:{userId:reception.id,entityId:r.id,title:{contains:'Resultado'}}})).toBe(1);
    expect(await prisma.roomStay.count()).toBe(0);expect(await prisma.shift.count()).toBe(0);expect(await prisma.room.count()).toBe(89);
  });
  it('sólo muestra asignaciones propias a la mucama, niega ejecución ajena y bloquea inspección propia incluso al administrador',async()=>{
    const r=await createHkWork(supervisor,{...input(),assignedToId:maid.id});
    expect((await getHkWorkday(other)).requests).toHaveLength(0);expect((await getHkWorkday(maid)).requests).toHaveLength(1);
    expect((await searchOperationalRecords(other,`#${r.humanId}`))).toHaveLength(0);
    await expect(change(other,r.id,'COMENZAR')).rejects.toThrow();
    const own=await createHkWork(admin,{...input(),assignedToId:admin.id});
    await change(admin,own.id,'COMENZAR');await change(admin,own.id,'TERMINAR');await expect(change(admin,own.id,'APROBAR')).rejects.toThrow('otra persona');
  });
  it('los permisos de un cargo no permiten escribir fuera del área ni eludir el flujo mediante acciones antiguas',async()=>{
    const receptionArea=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;
    const outsider=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});await prisma.user.update({where:{id:outsider.id},data:{departmentId:receptionArea}});
    const r=await createHkWork(supervisor,{...input(),assignedToId:maid.id});
    await expect(change(outsider,r.id,'ASIGNAR','Intento',other.id)).rejects.toThrow();
    await expect(changeHousekeepingRequest(admin,{id:r.id,version:1,action:'CONFIRMAR'})).rejects.toThrow('tablero diario');
    await expect(createHkWork(reception,{...input(),assignedToId:maid.id})).rejects.toThrow('asignación');
    await expect(createHkWork(supervisor,{...input(),departmentId:receptionArea})).rejects.toThrow();
    expect((await getHkWorkday(outsider)).requests).toHaveLength(0);
  });
  it('permite reposición sencilla sin inspección y obliga inspección en limpieza y trabajo crítico',async()=>{
    expect(hkInspectionRequired('REVISION')).toBe(true);expect(hkNextStatus('EN_GESTION','TERMINAR',true)).toBe('POR_REVISAR');expect(hkAllowedActions('BLOQUEADO',true)).not.toContain('TERMINAR');
    const r=await createHkWork(supervisor,{...input(),workKind:'REPOSICION',assignedToId:maid.id});
    await change(maid,r.id,'COMENZAR');await change(maid,r.id,'TERMINAR','Toallas entregadas');expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('RESUELTO');
  });
  it('rechaza identidades inactivas, áreas incorrectas y personas declaradas no disponibles',async()=>{
    await confirmHkAvailability(supervisor,{departmentId:area,workDate:date(),userId:maid.id,available:false,note:'Ausente'});
    await expect(createHkWork(supervisor,{...input(),assignedToId:maid.id})).rejects.toThrow('no disponible');
    await prisma.user.update({where:{id:other.id},data:{active:false}});await expect(createHkWork(supervisor,{...input(),assignedToId:other.id})).rejects.toThrow('activo');
    await expect(createHkWork(supervisor,{...input(),roomId:undefined,location:'Vestíbulo'})).rejects.toThrow('habitación');
  });
  it('prepara rutinas de manera idempotente, conserva snapshots y no crea 89 limpiezas',async()=>{
    const routine=await saveHkRoutine(manager,{departmentId:area,title:'Vestíbulo',description:'Limpiar superficies',location:'Vestíbulo',effortMinutes:25,requiresInspection:false,active:true});
    const results=await Promise.all([prepareHkDay(supervisor,area,date()),prepareHkDay(supervisor,area,date())]);expect(results.reduce((n,r)=>n+r.created,0)).toBe(1);
    expect(await prisma.housekeepingRequest.count()).toBe(1);expect(await prisma.housekeepingEvent.count()).toBe(1);
    await saveHkRoutine(manager,{departmentId:area,id:routine.id,version:1,title:'Vestíbulo nuevo',description:'Otra instrucción',location:'Vestíbulo',effortMinutes:40,requiresInspection:true,active:true});
    expect((await prisma.housekeepingRequest.findFirstOrThrow()).description).toBe('Limpiar superficies');
    await expect(saveHkRoutine(supervisor,{departmentId:area,title:'X',description:'X',location:'X',effortMinutes:10,requiresInspection:false,active:true})).rejects.toThrow();
  });
  it('requiere confirmación para asignar propuestas y compara minutos estimados sin fingir asistencia',async()=>{
    await confirmHkAvailability(supervisor,{departmentId:area,workDate:date(),userId:maid.id,available:true,note:'Disponible'});
    const r=await createHkWork(supervisor,input());const board=await getHkWorkday(supervisor);
    expect(board.suggestions[0]?.userId).toBe(maid.id);expect(board.workload.find(p=>p.id===maid.id)?.available).toBe(true);
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).assignedToId).toBeNull();expect(await prisma.shiftAssignment.count()).toBe(0);
  });
  it('conserva continuidad y un relevo inmutable, exige otro receptor y no cierra trabajos',async()=>{
    const r=await createHkWork(supervisor,{...input(),assignedToId:maid.id});await change(maid,r.id,'COMENZAR');await change(maid,r.id,'IMPEDIMENTO','Falta acceso');
    const hand=await saveHkHandover(supervisor,{requestKey:randomUUID(),departmentId:area,workDate:date(),note:'Confirmar acceso antes de continuar'});
    await expect(receiveHkHandover(supervisor,hand.id)).rejects.toThrow('otra persona');await receiveHkHandover(manager,hand.id);
    await change(maid,r.id,'RETOMAR');expect(JSON.stringify((await prisma.housekeepingHandover.findUniqueOrThrow({where:{id:hand.id}})).snapshot)).toContain('Falta acceso');
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('EN_GESTION');
  });
  it('vincula una incidencia única a Mantenimiento sin inventar su resolución',async()=>{
    const r=await createHkWork(supervisor,{...input(),assignedToId:maid.id});await change(maid,r.id,'COMENZAR');await change(maid,r.id,'IMPEDIMENTO','Fuga de agua');await change(supervisor,r.id,'MANTENIMIENTO','Revisar fuga bajo lavamanos');
    const stored=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}});expect(stored.status).toBe('BLOQUEADO');expect(stored.maintenanceEntryId).not.toBeNull();await expect(change(supervisor,r.id,'MANTENIMIENTO','Reintento')).rejects.toThrow('Ya existe');
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:stored.maintenanceEntryId!}})).status).toBe('ABIERTO');
  });
  it('una instrucción editada invalida el trabajo por revisar y el resultado vuelve al registro original',async()=>{
    const source=await prisma.operationalEntry.create({data:{type:'NOVEDAD',title:'Atención 512',description:'Instrucción inicial',roomId,createdById:reception.id}});
    const r=await createHkWork(reception,{...input(),sourceEntryId:source.id});await change(supervisor,r.id,'ASIGNAR','Atender',maid.id);await change(maid,r.id,'COMENZAR');await change(maid,r.id,'TERMINAR','Hecho');
    await prisma.operationalEntry.update({where:{id:source.id},data:{description:'Nueva instrucción',updatedAt:new Date(Date.now()+2000)}});await expect(change(supervisor,r.id,'APROBAR')).rejects.toThrow('instrucción cambió');await change(supervisor,r.id,'RECONFIRMAR','Revisada nueva instrucción');
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('PENDIENTE');expect((await getEntry(source.id)).housekeepingRequest?.humanId).toBe(r.humanId);expect((await getEntry(source.id)).status).toBe('ABIERTO');
  });
  it('sólo una actualización concurrente modifica la misma versión',async()=>{
    const r=await createHkWork(supervisor,{...input(),assignedToId:maid.id});const results=await Promise.allSettled([changeHkWork(maid,{id:r.id,version:1,action:'COMENZAR'}),changeHkWork(maid,{id:r.id,version:1,action:'IMPEDIMENTO',note:'No hay acceso'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await prisma.housekeepingEvent.count({where:{requestId:r.id}})).toBe(2);
  });
  it('la cobertura temporal vence y se revoca sin ampliar áreas ni permitir inspección propia',async()=>{
    const replacement={...maid,permissions:maid.permissions};const d=await delegateHk(manager,{departmentId:area,userId:maid.id,permission:'housekeeping.assign',startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+3600000),reason:'Cobertura del supervisor'});
    const r=await createHkWork(replacement,input());await change(replacement,r.id,'ASIGNAR','Asignación por cobertura',other.id);await revokeHkDelegation(manager,d.id);await expect(change(replacement,r.id,'ASIGNAR','Otra',other.id)).rejects.toThrow();
  });
  it('Fronti respeta el alcance, expone propuestas verificadas y no lee reserva privada de llaves',async()=>{
    const r=await createHkWork(supervisor,{...input(),assignedToId:maid.id});await prisma.supervisorKey.create({data:{ownerId:supervisor.id,code:'PRIVADA-HK',destination:'Reserva personal'}});
    const response=await executeFrontiPageContextTool(maid,resolveFrontiPageContext({pathname:'/admin/housekeeping',search:`?fecha=${date()}&area=${area}`,title:'Housekeeping'}));
    const json=JSON.stringify(response);expect(json).toContain(String(r.humanId));expect(json).not.toContain('PRIVADA-HK');expect(json).not.toContain(other.name);
    await expect(executeFrontiPageContextTool(maid,resolveFrontiPageContext({pathname:'/libro'}))).rejects.toThrow('limitado');
  });
  it('incorpora avisos anteriores al trabajo diario conservando folio e historial',async()=>{
    const old=await prisma.housekeepingRequest.create({data:{requestKey:randomUUID(),departmentId:area,title:'Aviso anterior',description:'Reposición',location:'Vestíbulo',createdById:supervisor.id}});
    await organizeLegacyHkWork(supervisor,{id:old.id,version:1,departmentId:area,workDate:date(),workKind:'REPOSICION',effortMinutes:10,requiresInspection:false,assignedToId:maid.id,note:'Organizar atención pendiente'});
    const next=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:old.id}});expect(next.humanId).toBe(old.humanId);expect(next.workflowVersion).toBe(1);expect(next.status).toBe('PENDIENTE');
  });
});
