import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {notify} from '@/server/notifications';
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
describe('avisos nuevos internos, sin correo automático',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('conserva campana sin encolar correo aunque la política sea obligatoria',async()=>{
    const user=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    await prisma.user.update({where:{id:user.id},data:{email:'synthetic-internal@example.invalid',emailNotificationsEnabled:true}});
    await notify({userId:user.id,type:'ACCION_REQUERIDA',title:'Revisar área',internalOnly:true});
    expect(await prisma.notification.count({where:{userId:user.id,title:'Revisar área'}})).toBe(1);
    expect(await prisma.operationalMailOutbox.count()).toBe(0);
  });
  it('mezclar avisos internos y existentes no filtra el contenido interno al correo',async()=>{
    const user=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    await prisma.user.update({where:{id:user.id},data:{email:'synthetic-mixed@example.invalid',emailNotificationsEnabled:true}});
    await notify([{userId:user.id,type:'ACCION_REQUERIDA',title:'INTERNAL_ONLY_TITLE',body:'INTERNAL_ONLY_BODY',internalOnly:true},{userId:user.id,type:'ACCION_REQUERIDA',title:'Comportamiento existente'}]);
    expect(await prisma.notification.count({where:{userId:user.id}})).toBe(2);
    const mail=await prisma.operationalMailOutbox.findFirstOrThrow();
    expect(mail.subject).toContain('Comportamiento existente');expect(mail.text).not.toContain('INTERNAL_ONLY');
  });
});
