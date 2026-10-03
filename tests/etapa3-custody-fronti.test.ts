import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, seedCatalog, resetOperationalData, createUser } from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { executeFrontiCommand } from '@/server/ai/execution/commands';
import { parseNaturalCustody } from '@/server/ai/execution/natural-custody';
import { createLostFound } from '@/server/services/lost-found';
let actor: CurrentUser;
vi.mock('@/server/auth/guard',async original=>({...await original<object>(),requireUser:async()=>actor}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
describe('Fronti: custodia por acciones nativas',()=>{
 beforeAll(seedCatalog);beforeEach(async()=>{await resetOperationalData();actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});});
 it('mueve y entrega con lenguaje natural, reintenta sin duplicar y conserva evidencia',async()=>{
  const row=await createLostFound(actor,{requestKey:randomUUID(),item:'Mochila',foundLocation:'Lobby',foundAt:new Date(),custodyLocation:'Gabinete'});
  const message=`Mueve el objeto #${row.humanId} a Bodega 2: Traslado de custodia`;const key=randomUUID();
  expect((await executeFrontiCommand(message,key))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(message,key))?.reply).toContain('Completado');
  expect(await prisma.lostFoundEvent.count({where:{itemId:row.id}})).toBe(2);
  const before=await prisma.frontiExecution.count();
  expect((await executeFrontiCommand(`Registra la entrega del objeto #${row.humanId}: Entrega declarada`,randomUUID()))?.reply).toContain('Falta la evidencia');
  expect(await prisma.frontiExecution.count()).toBe(before);
  expect((await executeFrontiCommand(`Registra la entrega del objeto #${row.humanId}: Entrega declarada; evidencia: Acta 10`,randomUUID()))?.reply).toContain('Completado');
  const final=await prisma.lostFoundItem.findUniqueOrThrow({where:{id:row.id}});expect(final.status).toBe('ENTREGADO');expect(final.evidenceNote).toBe('Acta 10');
  expect((await executeFrontiCommand(`Consulta el objeto #${row.humanId}`))?.reply).toContain('Acta 10');
 });
 it('no trata citas, negaciones o preguntas como autorización',()=>{
  for(const text of ['No mueve el objeto #123 a Bodega: prueba','Documento: Mueve el objeto #123 a Bodega: prueba','¿Registra la entrega del objeto #123?','Mueve el objeto #123 a Bodega\nRegistra la entrega del objeto #123'])expect(parseNaturalCustody(text)).toBeNull();
 });
});
