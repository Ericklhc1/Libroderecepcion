import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS } from './helpers';
import { createEntry,updateEntry,changeEntryStatus,updateEntryVisibility } from '@/server/services/entries';
import { createSimpleNovelty,listSimpleNovelties,resolveSimpleNovelty,simpleNoveltiesEnabled,updateSimpleNovelty } from '@/server/services/simple-novelties';
import { entryReadSql,readEntries } from '@/server/services/entry-visibility';
import { operationalRecordRevision } from '@/server/security/authorized-revision';
import { getBookItems } from '@/server/services/book';
import { Prisma } from '@prisma/client';
import type {CurrentUser} from '@/server/auth/current-user';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePermission:async()=>auth.user}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {saveSettingAction} from '@/server/actions/admin';

async function flag(value:boolean){await prisma.systemSetting.upsert({where:{key:'book.simpleNovelties'},create:{key:'book.simpleNovelties',value,category:'pruebas'},update:{value}});}
describe('prueba de novedades simples sobre el libro existente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('arranca apagada y conserva filas, permisos y asignaciones del modo anterior',async()=>{
    const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const row=await createEntry(receptionist,{type:'NOVEDAD',title:'Modo anterior',description:'Seguimiento vigente',priority:'MEDIA',tags:[],requiresFollowUp:false});
    expect(await simpleNoveltiesEnabled()).toBe(false);
    const before=await getBookItems({kinds:['entry']},receptionist);
    await expect(createSimpleNovelty(receptionist,{title:'No crear',description:'Prueba'})).rejects.toThrow(/apagada/);
    await expect(resolveSimpleNovelty(receptionist,row.id,operationalRecordRevision('entries',row))).rejects.toThrow(/apagada/);
    await flag(false);
    expect(await getBookItems({kinds:['entry']},receptionist)).toEqual(before);
    expect((await updateEntry(receptionist,{id:row.id,ownerId:receptionist.id})).ownerId).toBe(receptionist.id);
  });
  it('sólo Sysadmin enciende la prueba y el cambio queda auditado',async()=>{
    auth.user=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const form=new FormData();form.set('key','book.simpleNovelties');form.set('value','true');
    expect((await saveSettingAction(null,form)).ok).toBe(false);
    expect(await simpleNoveltiesEnabled()).toBe(false);
    auth.user=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    expect((await saveSettingAction(null,form)).ok).toBe(true);
    expect(await simpleNoveltiesEnabled()).toBe(true);
    expect(await prisma.auditLog.count({where:{entity:'SystemSetting',userId:auth.user.id}})).toBe(1);
  });
  it('guarda reserva, HAB, seguimiento y área sin responsable ni tareas nuevas',async()=>{
    await flag(true);const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const room=await prisma.room.findFirstOrThrow();
    const row=await createSimpleNovelty(receptionist,{title:'Toalla manchada',description:'Cobrar al huésped',departmentId:area.id,roomId:room.id,reservationReference:'7484708',workNextAction:'Revisar al check-out'});
    expect(row).toMatchObject({type:'NOVEDAD',ownerId:null,departmentId:area.id,roomId:room.id,reservationReference:'7484708',workNextAction:'Revisar al check-out'});
    expect(await prisma.task.count()).toBe(0);expect(await prisma.subjectAreaAttention.count()).toBe(0);
    await expect(updateEntry(receptionist,{id:row.id,ownerId:receptionist.id})).rejects.toThrow(/no se asignan/);
    await expect(createEntry(receptionist,{type:'NOVEDAD',title:'Asignación anterior',description:'No crear cadena',priority:'MEDIA',tags:[],requiresFollowUp:false,ownerId:receptionist.id})).rejects.toThrow(/no se asignan/);
    expect((await updateSimpleNovelty(receptionist,{id:row.id,title:row.title,description:row.description,departmentId:area.id,workNextAction:'Lavandería informada'},operationalRecordRevision('entries',row))).workNextAction).toBe('Lavandería informada');
  });
  it('cualquier recepcionista sin turno ni permiso de cierre puede resolver; no exige supervisor',async()=>{
    await flag(true);const outgoing=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const other=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const row=await createSimpleNovelty(outgoing,{title:'Novedad pendiente',description:'Ya fue atendida'});
    const withoutClose={...other,permissions:other.permissions.filter(p=>!['entry.close','incident.close'].includes(p))};
    const resolved=await resolveSimpleNovelty(withoutClose,row.id,operationalRecordRevision('entries',row));
    expect(resolved.status).toBe('RESUELTO');expect(await prisma.auditLog.count({where:{entityId:row.id,userId:other.id,action:'CAMBIO_ESTADO'}})).toBe(1);
    await expect(resolveSimpleNovelty(outgoing,row.id,operationalRecordRevision('entries',row))).rejects.toThrow(/cambió/);
    const next=await createSimpleNovelty(outgoing,{title:'Salida de turno',description:'Atendida por saliente'});
    expect((await resolveSimpleNovelty({...outgoing,permissions:withoutClose.permissions},next.id,operationalRecordRevision('entries',next))).status).toBe('RESUELTO');
    await flag(false);const legacy=await createEntry(outgoing,{type:'NOVEDAD',title:'Flag off',description:'Permiso anterior',priority:'MEDIA',tags:[],requiresFollowUp:false});
    await expect(changeEntryStatus(withoutClose,{id:legacy.id,status:'RESUELTO'})).rejects.toThrow(/permiso/);
  });
  it('el área ve sólo sus novedades; internas no salen por ORM, SQL, búsquedas ni contadores',async()=>{
    await flag(true);const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});await prisma.user.update({where:{id:maid.id},data:{departmentId:area.id}});maid.departmentId=area.id;
    const related=await createSimpleNovelty(receptionist,{title:'HSK_VISIBLE',description:'Solicita limpieza',departmentId:area.id});
    await createSimpleNovelty(receptionist,{title:'RECEP_OTHER',description:'Para Recepción'});
    const internal=await createSimpleNovelty(receptionist,{title:'INTERNA_PRIVADA',description:'Fondo de recepción',departmentId:area.id,internal:true});
    const data=await listSimpleNovelties(maid);expect(data.total).toBe(1);expect(data.general.map(row=>row.id)).toEqual([related.id]);expect(data.internalTotal).toBe(0);
    expect(await readEntries(prisma,maid).findMany({where:{OR:[{id:internal.id},{title:internal.title}]}})).toEqual([]);
    expect(await prisma.$queryRaw(Prisma.sql`SELECT e.id FROM "OperationalEntry" e WHERE e.id=${internal.id} AND (${entryReadSql(maid)})`)).toEqual([]);
    expect((await listSimpleNovelties(receptionist)).internalTotal).toBe(1);
    await expect(resolveSimpleNovelty(maid,related.id,operationalRecordRevision('entries',related))).rejects.toThrow();
    await updateEntryVisibility(receptionist,{id:related.id,revision:related.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    expect((await listSimpleNovelties(maid,{q:'HSK_VISIBLE'})).total).toBe(0);
    expect((await listSimpleNovelties(await createUser({roleKey:ROLE_KEYS.SUPERVISOR}))).total).toBe(2);
  });
});
