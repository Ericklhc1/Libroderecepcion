import {beforeAll,beforeEach,expect,it} from 'vitest';
import {seedCatalog,resetOperationalData,createUser,prisma,ROLE_KEYS} from './helpers';
import {getDashboardData} from '@/server/services/dashboard';
import {groupDisplayRows} from '@/domain/display-groups';
beforeAll(seedCatalog);beforeEach(resetOperationalData);
it('cuenta un grupo grande sin cargar todos sus originales ni ocultar otras prioridades',async()=>{
  const user=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
  await prisma.task.createMany({data:Array.from({length:210},()=>({title:'Duplicada masiva',createdById:user.id,priority:'CRITICA' as const,dueAt:new Date(Date.now()-10000)}))});
  await prisma.task.create({data:{title:'Otra prioridad',createdById:user.id,priority:'ALTA',dueAt:new Date(Date.now()-10000)}});
  const data=await getDashboardData(user);
  const groups=groupDisplayRows(data.attention,row=>JSON.stringify([row.kind,row.tone,row.title,row.reason,row.action]));
  expect(data.attentionTotal).toBe(211);expect(groups).toHaveLength(2);
  const duplicate=groups.find(group=>group.row.title==='Duplicada masiva')!;
  expect(duplicate.items).toHaveLength(20);expect(duplicate.row.duplicateCount).toBe(210);
  expect(groups.some(group=>group.row.title==='Otra prioridad')).toBe(true);
});
it('elige nueve claves críticas antes de otras prioridades y conserva el desbordamiento',async()=>{
  const user=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
  await prisma.task.createMany({data:Array.from({length:20},(_,i)=>({title:`CRITICA_${i}`,createdById:user.id,priority:'CRITICA' as const,dueAt:new Date(Date.now()-10000)}))});
  await prisma.task.createMany({data:Array.from({length:20},(_,i)=>({title:`MEDIA_${i}`,createdById:user.id,priority:'MEDIA' as const,dueAt:new Date(Date.now()-20000)}))});
  const data=await getDashboardData(user);expect(data.attentionTotal).toBe(40);
  expect(data.attention).toHaveLength(9);expect(data.attention.every(row=>row.title.startsWith('CRITICA_'))).toBe(true);
});
