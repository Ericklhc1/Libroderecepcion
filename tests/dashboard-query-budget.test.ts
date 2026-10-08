import {beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {seedCatalog,resetOperationalData,createUser,prisma,ROLE_KEYS} from './helpers';
beforeAll(seedCatalog);beforeEach(resetOperationalData);
it('mantiene el presupuesto de veinte consultas con nueve grupos de cada fuente',async()=>{
  const user=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
  await prisma.task.createMany({data:Array.from({length:27},(_,i)=>({title:`Task ${i%9}`,createdById:user.id,priority:'CRITICA' as const,dueAt:new Date(Date.now()-10000)}))});
  await prisma.followUp.createMany({data:Array.from({length:27},(_,i)=>({action:`Follow ${i%9}`,createdById:user.id,ownerId:user.id,visibility:'OPERATIVO' as const,scheduledAt:new Date(Date.now()-10000)}))});
  const counted=new PrismaClient({log:[{emit:'event',level:'query'}]});let queries=0;counted.$on('query',()=>{queries++;});
  const shared=globalThis as unknown as {prisma:PrismaClient|undefined};const previous=shared.prisma;shared.prisma=counted;
  try{
    vi.resetModules();const {getDashboardData}=await import('@/server/services/dashboard');
    const data=await getDashboardData(user);
    expect(data.attentionTotal).toBe(54);expect(data.overdueTasks).toHaveLength(27);expect(data.followUps).toHaveLength(27);
    expect(queries).toBeGreaterThan(0);expect(queries).toBeLessThanOrEqual(20);
  }finally{shared.prisma=previous;await counted.$disconnect();vi.resetModules();}
});
