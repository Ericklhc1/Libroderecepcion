import {markReadableNotifications} from '@/server/services/notification-access';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {createFollowUp,updateFollowUp} from '@/server/services/followups';
import {followUpReadWhere,followUpReadSql,notificationReadWhere} from '@/server/services/followup-access';
import {searchOperationalRecords} from '@/server/services/global-search';
import {getNotificationFeedForUser} from '@/server/services/notification-feed';
import {getUnreadCountsForUser} from '@/server/services/notification-poll';
import {getWebPushPayload} from '@/server/services/web-push';
import {buildHandoverSnapshot,visibleSnapshotItems,visibleHandover} from '@/server/services/handover-snapshot';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));

describe('AROH Simple · continuidad derivada y avisos históricos',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  async function fixture(visibility:'PRIVADO'|'OPERATIVO'='PRIVADO'){
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const source=await prisma.followUp.create({data:{action:'E4_ORIGEN_RESERVADO',visibility,ownerId:owner.id,createdById:owner.id}});
    const task=await prisma.task.create({data:{title:'E4_TRABAJO_RESERVADO',followUpId:source.id,createdById:owner.id,assigneeId:owner.id}});
    return{owner,reader,source,task};
  }
  it('crear, reasignar o ampliar una continuidad no comparte el origen reservado',async()=>{
    const f=await fixture();
    await expect(createFollowUp(f.owner,{taskId:f.task.id,action:'Atención derivada',ownerId:f.reader.id})).rejects.toThrow('reservado');
    await expect(createFollowUp(f.owner,{taskId:f.task.id,action:'Atención derivada'})).rejects.toThrow('reserva');
    expect(await prisma.followUp.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    const derived=await createFollowUp(f.owner,{taskId:f.task.id,action:'Atención derivada',visibility:'PRIVADO'});
    await expect(updateFollowUp(f.owner,{id:derived.id,ownerId:f.reader.id})).rejects.toThrow('reservado');
    await expect(updateFollowUp(f.owner,{id:derived.id,visibility:'OPERATIVO'})).rejects.toThrow('reserva');
    expect(await prisma.followUp.findUniqueOrThrow({where:{id:derived.id}})).toMatchObject({visibility:'PRIVADO',ownerId:f.owner.id});
    expect(await prisma.notification.count({where:{userId:f.reader.id}})).toBe(0);
  });
  it('los enlaces históricos y ciclos conservan reserva sin reescribir su evidencia',async()=>{
    const f=await fixture();
    const child=await prisma.followUp.create({data:{action:'E4_COPIA_HISTORICA',visibility:'OPERATIVO',taskId:f.task.id,createdById:f.owner.id,ownerId:f.reader.id}});
    await prisma.task.update({where:{id:f.task.id},data:{followUpId:child.id}});
    await prisma.followUp.update({where:{id:child.id},data:{sourceEntity:'FollowUp',sourceId:f.source.id}});
    expect(await prisma.followUp.count({where:{id:child.id,AND:[followUpReadWhere(f.reader)]}})).toBe(0);
    expect(await prisma.followUp.count({where:{id:child.id,AND:[followUpReadWhere(f.owner)]}})).toBe(1);
    const rows=await prisma.$queryRaw<Array<{id:string}>>`SELECT f.id FROM "FollowUp" f WHERE ${followUpReadSql(f.reader)}`;
    expect(rows.map(r=>r.id)).not.toContain(child.id);
    expect((await searchOperationalRecords(f.reader,'E4_COPIA_HISTORICA')).some(r=>r.entityId===child.id)).toBe(false);
    expect((await searchOperationalRecords(f.owner,'E4_COPIA_HISTORICA')).some(r=>r.entityId===child.id)).toBe(true);
    expect(await prisma.followUp.findUniqueOrThrow({where:{id:child.id}})).toMatchObject({action:'E4_COPIA_HISTORICA',visibility:'OPERATIVO'});
  });
  it('campana, historial, Fronti y push excluyen avisos antiguos tras restringir el origen',async()=>{
    const f=await fixture('OPERATIVO');
    const alert=await prisma.alert.create({data:{title:'E4_AVISO_RESERVADO',type:'TAREA_VENCIDA',taskId:f.task.id}});
    const signal='signal-reserved-history';
    await prisma.auditLog.create({data:{entity:'FrontiProactiveSignal',entityId:signal,action:'CREAR',summary:'E4_SECRETO',after:{sourceEntity:'Task',sourceEntityId:f.task.id}}});
    const visible=await prisma.notification.create({data:{userId:f.reader.id,type:'ACTUALIZACION_OPERATIVA',title:'Aviso público',createdAt:new Date(Date.now()-2000)}});
    for(const [entity,entityId] of [['FollowUp',f.source.id],['Task',f.task.id],['Alert',alert.id],['FrontiProactiveSignal',signal]]){
      await prisma.notification.create({data:{userId:f.reader.id,type:'ACCION_REQUERIDA',title:'E4_SECRETO',body:'E4_SECRETO',entity,entityId,link:`/tareas/${f.task.id}`}});
    }
    expect((await getNotificationFeedForUser(f.reader.id)).unread).toBe(5);
    await prisma.followUp.update({where:{id:f.source.id},data:{visibility:'PRIVADO'}});
    const snapshot=await getNotificationFeedForUser(f.reader.id,1);
    expect(snapshot.unread).toBe(1);expect(snapshot.items.map(n=>n.id)).toEqual([visible.id]);
    expect((await getUnreadCountsForUser(f.reader.id)).notifications).toBe(1);
    expect(await prisma.notification.count({where:{userId:f.reader.id,AND:[notificationReadWhere(f.reader)]}})).toBe(1);
    expect(JSON.stringify(await executeFrontiPageContextTool(f.reader,resolveFrontiPageContext({pathname:'/notificaciones'})))).not.toContain('E4_SECRETO');
    const endpoint='https://push.invalid/reserved-history';
    await prisma.pushSubscription.create({data:{userId:f.reader.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    const push=await getWebPushPayload({userId:f.reader.id,endpoint});
    expect(push.unread).toBe(1);expect(push.newCount).toBe(1);expect(push.items.map(n=>n.id)).toEqual([visible.id]);
    expect(await markReadableNotifications(f.reader.id)).toMatchObject({count:1});
    const hiddenNotice=await prisma.notification.findFirstOrThrow({where:{title:'E4_SECRETO'}});
    expect(await markReadableNotifications(f.reader.id,hiddenNotice.id)).toMatchObject({count:0});
    expect(await prisma.notification.count({where:{title:'E4_SECRETO',readAt:null}})).toBe(4);
    await prisma.followUp.update({where:{id:f.source.id},data:{visibility:'OPERATIVO'}});
    expect((await getNotificationFeedForUser(f.reader.id)).unread).toBe(4);
  });
  it('el relevo incluye continuidad operativa de compañeros y excluye lo reservado',async()=>{
    const f=await fixture('OPERATIVO');const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const hidden=await prisma.followUp.create({data:{action:'E4_PRIVADO',visibility:'PRIVADO',ownerId:f.owner.id,createdById:f.owner.id}});
    const snapshot=await buildHandoverSnapshot(reception,new Date(),{shiftId:null});
    expect(snapshot.some(item=>item.refType==='followup'&&item.refId===f.source.id)).toBe(true);
    expect(snapshot.some(item=>item.refType==='task'&&item.refId===f.task.id)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('E4_PRIVADO');
    const visible=await visibleSnapshotItems(reception,[{refType:'followup',refId:f.source.id,title:'Continuidad de un compañero',detail:''},{refType:'followup',refId:hidden.id,title:'E4_PRIVADO',detail:''}],true);
    const historical={items:[{section:'continuidad',level:'INFORMATIVO' as const,refType:'followup',refId:hidden.id,title:'E4_PRIVADO',detail:''}],snapshot:{items:[{refType:'followup',refId:hidden.id,title:'E4_PRIVADO',detail:''}]}};
    expect(JSON.stringify(await visibleHandover(f.owner,historical))).not.toContain('E4_PRIVADO');
    expect(JSON.stringify(historical)).toContain('E4_PRIVADO');
    expect(visible[0]?.title).toBe('Continuidad de un compañero');expect(visible[1]?.title).toBe('Asunto reservado');
  });
});
