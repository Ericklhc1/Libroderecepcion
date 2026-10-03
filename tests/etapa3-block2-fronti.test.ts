import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser} from './helpers';
import {ROLE_KEYS} from '@/lib/permissions';
import type {CurrentUser} from '@/server/auth/current-user';
import {coordinateWork} from '@/server/services/coordination';
import {invokeNativeAction} from '@/server/ai/execution/catalog';

let actor:CurrentUser;
vi.mock('@/server/auth/guard',async original=>({...await original<object>(),requireUser:async()=>actor}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));

describe('Etapa 3 bloque 2: Fronti usa coordinación nativa',()=>{
 beforeAll(seedCatalog);beforeEach(resetOperationalData);
 it('responde una aclaración mediante el adaptador nativo sin duplicar el asunto',async()=>{
  const requester=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});actor=requester;
  const area=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
  const entry=await prisma.operationalEntry.create({data:{type:'NOVEDAD',title:'Revisar equipo',description:'Confirmar condición',departmentId:area.id,createdById:requester.id,ownerId:owner.id,workAssignedAt:new Date(),workAcknowledgedAt:new Date(),workAcknowledgedById:owner.id,workStartedAt:new Date(),workNextAction:'Revisar'}});
  await coordinateWork(owner,{kind:'entry',id:entry.id,updatedAt:entry.updatedAt,requestKey:randomUUID(),action:'ACLARACION',nextAction:'Indicar si el equipo sigue fuera de servicio'});
  const waiting=await prisma.operationalEntry.findUniqueOrThrow({where:{id:entry.id}});
  const result=await invokeNativeAction({action:'coordinateWorkAction',fields:{kind:'entry',id:entry.id,updatedAt:waiting.updatedAt.toISOString(),requestKey:randomUUID(),action:'RESPONDER_ACLARACION',nextAction:'Sí, sigue fuera de servicio'}});
  expect(result.ok,JSON.stringify(result)).toBe(true);
  const answered=await prisma.operationalEntry.findUniqueOrThrow({where:{id:entry.id}});expect(answered.id).toBe(entry.id);expect(answered.status).toBe('EN_ESPERA');expect(answered.workNextAction).toContain('Aclaración recibida');
  actor=owner;
  const resumed=await invokeNativeAction({action:'coordinateWorkAction',fields:{kind:'entry',id:entry.id,updatedAt:answered.updatedAt.toISOString(),requestKey:randomUUID(),action:'RETOMAR_ACLARACION',nextAction:'Continuar atención'}});
  expect(resumed.ok,JSON.stringify(resumed)).toBe(true);
  const final=await prisma.operationalEntry.findUniqueOrThrow({where:{id:entry.id}});expect(final.status).toBe('EN_CURSO');expect(final.workNextAction).toBe('Continuar atención');
  expect(await prisma.operationalEntry.count({where:{id:entry.id}})).toBe(1);
 });
});
