import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, createUser, resetOperationalData, seedCatalog } from './helpers';
import { prisma as servicePrisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { substitutionSchema } from '@/domain/operational-automation';
import { hotelWallDateTime } from '@/domain/time';
import { saveAutomation, simulateAutomation, runOperationalAutomations, revokeAutomation } from '@/server/services/operational-automation';
import * as availabilityServices from '@/server/services/substitution-availability';
import * as substitutionServices from '@/server/services/automation-substitutions';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import { createEntry } from '@/server/services/entries';
import { coordinateWork } from '@/server/services/coordination';
import { createHkWork, confirmHkAvailability, delegateHk } from '@/server/services/housekeeping-work';
import { saveScheduleCollaborator, saveScheduleTemplate } from '@/server/services/schedule-catalog';
import { addScheduleSlot, cancelScheduleSlot, createSchedulePlan, publishSchedulePlan } from '@/server/services/schedules';

vi.mock('@/server/services/legal-acceptance', () => ({ hasAcceptedCurrentTerms: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/services/web-push-scheduler', () => ({ scheduleWebPushForUsers: vi.fn() }));
vi.mock('@/server/ai/fronti-proactive-scheduler', () => ({ scheduleFrontiProactiveSweep: vi.fn() }));
vi.mock('@/server/services/operational-mail', async original => ({ ...await original<object>(), tryDeliverOperationalMail: vi.fn() }));

// PostgreSQL acceptance tests. The ordinary suite/global setup owns its disposable DB.
// Date alone is frozen: Prisma, transaction locks, and timeout handling remain real.
const ORIGINAL_DAY = '2090-10-01';
const SLOT_DAY = '2090-10-02';
const BASE_TIME = hotelWallDateTime(ORIGINAL_DAY, 8);
type Configuration = z.input<typeof substitutionSchema>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function barrier(promise: Promise<void>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No se alcanzó la barrera: ${label}`)), 10_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

describe('Suplencia futura: aceptación con PostgreSQL y servicios nativos', () => {
  let admin: CurrentUser;
  let first: CurrentUser;
  let second: CurrentUser;
  let area: string;
  let hkArea: string;

  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(BASE_TIME);
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Autorizador sintético' });
    first = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Suplente primero' });
    second = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Suplente segundo' });
    area = (await prisma.department.findUniqueOrThrow({ where: { key: 'RECEPCION' } })).id;
    hkArea = (await prisma.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } })).id;
    await prisma.user.updateMany({ where: { id: { in: [admin.id, first.id, second.id] } }, data: { departmentId: area } });
    admin = { ...admin, departmentId: area };
    first = { ...first, departmentId: area };
    second = { ...second, departmentId: area };
    vi.stubEnv('AROH_AUTOMATION_EXECUTION_ENABLED', 'true');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const configuration = (overrides: Partial<Configuration> = {}): Configuration => ({
    trigger: 'UNASSIGNED', kind: 'task', priority: null, receiptMinutes: 1,
    mode: 'APPLY', candidateIds: [first.id], requirePublishedSchedule: true,
    waitForPublishedSchedule: true, nextAction: 'Recibir y atender el trabajo original', maxItems: 25,
    ...overrides,
  });
  const policy = async (overrides: Partial<Configuration> = {}, options: { enabled?: boolean; expiresAt?: Date; departmentId?: string } = {}) => {
    const saved = await saveAutomation(admin, {
      name: 'Suplencia futura sintética', kind: 'SUBSTITUTION', departmentId: options.departmentId ?? area,
      configuration: configuration(overrides), enabled: options.enabled ?? true,
      expiresAt: options.expiresAt ?? hotelWallDateTime('2090-10-10', 18),
    });
    return prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } });
  };
  const task = (overrides: Partial<Parameters<typeof createTask>[1]> = {}) => createTask(admin, {
    title: 'Pendiente sintético de suplencia', departmentId: area, priority: 'MEDIA', tags: [], checklist: [], ...overrides,
  });
  const mutation = async (planId: string) => ({
    planId, version: (await prisma.schedulePlan.findUniqueOrThrow({ where: { id: planId } })).version,
    requestKey: randomUUID(), reason: 'Planificación sintética revisada',
  });
  async function schedule(person = first, options: { date?: string; startTime?: string; endTime?: string; departmentId?: string } = {}) {
    const departmentId = options.departmentId ?? area;
    const date = options.date ?? SLOT_DAY;
    const collaborator = await saveScheduleCollaborator(admin, { userId: person.id, departmentIds: [departmentId], functionName: 'Colaborador sintético', active: true });
    const plan = await createSchedulePlan(admin, { departmentId, startDate: ORIGINAL_DAY, endDate: '2090-10-15' });
    const template = await saveScheduleTemplate(admin, {
      departmentId, code: `FH_${randomUUID().slice(0, 8)}`, label: 'Franja sintética',
      startTime: options.startTime ?? '08:00', endTime: options.endTime ?? '16:00', crossesMidnight: false,
    });
    await addScheduleSlot(admin, await mutation(plan.id), { collaboratorId: collaborator.id, date, kind: 'TURNO', templateId: template.id });
    if ((await prisma.schedulePlan.findUniqueOrThrow({ where: { id: plan.id } })).status !== 'PUBLICADO') {
      await publishSchedulePlan(admin, await mutation(plan.id));
    }
    return prisma.scheduleSlot.findFirstOrThrow({ where: { planId: plan.id, collaboratorId: collaborator.id, date: new Date(date), cancelledAt: null } });
  }
  async function preview(policyId: string, workId: string) {
    const saved = await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: policyId } });
    const config = substitutionSchema.parse(saved.configuration);
    const work = await availabilityServices.readSubstitutionWork(admin, config.kind, workId);
    expect(work).not.toBeNull();
    return availabilityServices.previewSubstitutionAvailability(admin, saved, work!, new Date());
  }
  async function effectsSnapshot() {
    return {
      tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }),
      assignments: await prisma.taskAssignment.findMany({ orderBy: { id: 'asc' } }),
      housekeeping: await prisma.housekeepingRequest.findMany({ orderBy: { id: 'asc' } }),
      runs: await prisma.operationalAutomationRun.findMany({ orderBy: { id: 'asc' } }),
      notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
      outbox: await prisma.operationalMailOutbox.count(),
      audit: await prisma.auditLog.count(),
      hkEvents: await prisma.housekeepingEvent.count(),
      shifts: await prisma.shift.count(),
      shiftAssignments: await prisma.shiftAssignment.count(),
      cash: await prisma.cashMovement.count(),
      slots: await prisma.scheduleSlot.findMany({ orderBy: { id: 'asc' } }),
    };
  }
  const sweep = () => runOperationalAutomations(new Date());
  const noSuccess = async (policyId: string) => expect(await prisma.operationalAutomationRun.count({ where: { policyId, status: 'SUCCEEDED' } })).toBe(0);

  it('conserva intervención en políticas antiguas: el opt-in omitido se guarda false', async () => {
    const work = await task();
    await schedule();
    const raw = configuration();
    delete raw.waitForPublishedSchedule;
    expect(substitutionSchema.parse(raw).waitForPublishedSchedule).toBe(false);
    const created = await saveAutomation(admin, { name: 'Política anterior sin opt-in', kind: 'SUBSTITUTION', departmentId: area, configuration: raw, enabled: true, expiresAt: hotelWallDateTime('2090-10-10', 18) });
    const saved = await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: created.id } });
    expect(substitutionSchema.parse(saved.configuration).waitForPublishedSchedule).toBe(false);
    const simulation = await simulateAutomation(admin, saved.id);
    expect(simulation.effects[0]).toMatchObject({ id: work.id, eligible: false, substituteId: null, availability: { state: 'FUTURE_SLOT' } });
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 1 });
    expect((await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).enabled).toBe(false);
    expect(await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } })).toEqual([expect.objectContaining({ status: 'INTERVENTION' })]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).assigneeId).toBeNull();
  });

  it('rechaza espera futura sin exigir horario publicado antes de guardar la política', async () => {
    await expect(policy({ requirePublishedSchedule: false })).rejects.toThrow('horario publicado');
    expect(await prisma.operationalAutomation.count()).toBe(0);
    expect(await prisma.operationalAutomationRun.count()).toBe(0);
  });

  it('la vista previa es sólo lectura y el inicio futuro más cercano gana al orden de candidatos', async () => {
    const work = await task();
    await schedule(first, { date: '2090-10-03' });
    const nearest = await schedule(second);
    const saved = await policy({ candidateIds: [first.id, second.id] }, { enabled: false });
    const before = await effectsSnapshot();
    expect(await preview(saved.id, work.id)).toMatchObject({
      state: 'FUTURE_SLOT', eligibleNow: false, planningOnly: true,
      selection: { userId: second.id, candidatePosition: 1, slotId: nearest.id, startAt: nearest.startAt },
    });
    const simulation = await simulateAutomation(admin, saved.id);
    expect(simulation.effects[0]).toMatchObject({ id: work.id, eligible: false, substituteId: null, availability: { state: 'FUTURE_SLOT', responsible: second.name } });
    expect(await effectsSnapshot()).toEqual(before);
    expect(await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(saved);
  });

  it('espera sin consumir ocurrencia ni avisar; aplica una sola vez al abrirse la franja sin recibir ni comenzar', async () => {
    const work = await task();
    const slot = await schedule();
    const saved = await policy();
    const before = await effectsSnapshot();
    for (const at of [BASE_TIME, new Date(slot.startAt!.getTime() - 60_000), new Date(slot.startAt!.getTime() - 1)]) {
      vi.setSystemTime(at);
      expect(await sweep()).toMatchObject({ attempted: 0, failed: 0 });
      expect(await effectsSnapshot()).toEqual(before);
      expect((await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).enabled).toBe(true);
    }
    vi.setSystemTime(slot.startAt!);
    expect(await sweep()).toMatchObject({ attempted: 1, failed: 0 });
    const applied = await prisma.task.findUniqueOrThrow({ where: { id: work.id } });
    expect(applied).toMatchObject({ assigneeId: first.id, status: 'PENDIENTE', workAcknowledgedAt: null, workAcknowledgedById: null, workStartedAt: null, workAssignedAt: slot.startAt });
    const after = await effectsSnapshot();
    await sweep(); await sweep();
    expect(await effectsSnapshot()).toEqual(after);
    expect(await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } })).toEqual([expect.objectContaining({
      status: 'SUCCEEDED', stateKey: `substitution:task:${work.id}`, result: expect.objectContaining({ sourceId: work.id, substituteId: first.id }),
    })]);
    expect(await prisma.taskAssignment.count({ where: { taskId: work.id, userId: first.id, removedAt: null } })).toBe(1);
    expect(await prisma.notification.count({ where: { entity: 'Task', entityId: work.id, userId: first.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entity: 'Task', entityId: work.id, action: 'CAMBIO_RESPONSABLE' } })).toBe(1);
    expect(after.shifts).toBe(0); expect(after.shiftAssignments).toBe(0); expect(after.cash).toBe(0);
  });

  it('PROPOSE también espera y luego conserva un aviso único sin asignar', async () => {
    const work = await task();
    const slot = await schedule();
    const saved = await policy({ mode: 'PROPOSE' });
    const before = await effectsSnapshot();
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 0 });
    expect(await effectsSnapshot()).toEqual(before);
    vi.setSystemTime(slot.startAt!);
    expect(await sweep()).toMatchObject({ attempted: 1, failed: 0 });
    await sweep();
    expect(await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).toEqual(before.tasks[0]);
    const runs = await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } });
    expect(runs).toEqual([expect.objectContaining({ status: 'SUCCEEDED', result: expect.objectContaining({ mode: 'PROPOSE', sourceId: work.id }) })]);
    expect(await prisma.notification.count({ where: { entity: 'OperationalAutomation', entityId: runs[0]!.id, userId: admin.id } })).toBe(1);
    expect(await prisma.taskAssignment.count({ where: { taskId: work.id } })).toBe(0);
  });

  it.each(['entry', 'housekeeping'] as const)('al abrir la franja usa el servicio nativo de %s sin fabricar recepción o inicio', async kind => {
    const departmentId = kind === 'housekeeping' ? hkArea : area;
    const person = kind === 'housekeeping' ? await createUser({ roleKey: ROLE_KEYS.HK_ATTENDANT }) : first;
    await prisma.user.update({ where: { id: person.id }, data: { departmentId } });
    const slot = await schedule(person, { departmentId });
    const work = kind === 'entry'
      ? await createEntry(admin, { type: 'NOVEDAD', title: 'Novedad sintética por atender', description: 'Mantener continuidad original', departmentId, priority: 'MEDIA', tags: [], requiresFollowUp: false })
      : await createHkWork(admin, { requestKey: randomUUID(), title: 'Reposición pendiente sintética', description: 'Reponer material declarado', workKind: 'REPOSICION', workDate: ORIGINAL_DAY, departmentId, location: 'Zona sintética', priority: 'MEDIA', effortMinutes: 20 });
    const saved = await policy({ kind, candidateIds: [person.id] }, { departmentId });
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 0 });
    vi.setSystemTime(slot.startAt!);
    expect(await sweep()).toMatchObject({ attempted: 1, failed: 0 });
    await sweep();
    if (kind === 'entry') {
      expect(await prisma.operationalEntry.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({ ownerId: person.id, workAcknowledgedAt: null, workStartedAt: null, status: 'ABIERTO' });
      expect(await prisma.auditLog.count({ where: { entity: 'OperationalEntry', entityId: work.id, action: 'CAMBIO_RESPONSABLE' } })).toBe(1);
    } else {
      expect(await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({ assignedToId: person.id, acknowledgedAt: null, startedAt: null, status: 'PENDIENTE' });
      expect(await prisma.housekeepingEvent.count({ where: { requestId: work.id, action: 'ASIGNAR' } })).toBe(1);
    }
    expect(await prisma.operationalAutomationRun.count({ where: { policyId: saved.id, status: 'SUCCEEDED' } })).toBe(1);
    expect(await prisma.shift.count()).toBe(0);
    expect(await prisma.shiftAssignment.count()).toBe(0);
  });

  it.each(['pausa', 'revocación', 'caducidad', 'permiso del autorizador'] as const)('%s durante la espera impide un efecto nuevo', async change => {
    const work = await task();
    const slot = await schedule();
    const expiresAt = new Date(slot.startAt!.getTime() + 60_000);
    const saved = await policy({}, { expiresAt });
    await sweep();
    const before = await prisma.task.findUniqueOrThrow({ where: { id: work.id } });
    if (change === 'pausa') await saveAutomation(admin, { id: saved.id, version: saved.version, name: saved.name, kind: saved.kind, departmentId: area, configuration: saved.configuration, expiresAt, enabled: false });
    if (change === 'revocación') await revokeAutomation(admin, saved.id, saved.version);
    if (change === 'permiso del autorizador') {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.HK_ATTENDANT } });
      await prisma.user.update({ where: { id: admin.id }, data: { roleId: role.id } });
    }
    vi.setSystemTime(change === 'caducidad' ? expiresAt : slot.startAt!);
    await sweep();
    await noSuccess(saved.id);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).toEqual(before);
    expect(await prisma.taskAssignment.count({ where: { taskId: work.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { entity: 'Task', entityId: work.id, userId: first.id } })).toBe(0);
  });

  it.each(['recibido', 'en curso', 'otro responsable'] as const)('revalida el origen %s entre simulación y escritura y no lo pisa', async change => {
    const work = await task({ assigneeId: admin.id });
    const slot = await schedule();
    const saved = await policy({ trigger: 'UNRECEIVED' });
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 120_000));
    await sweep();
    vi.setSystemTime(slot.startAt!);
    const originalPreview = availabilityServices.previewSubstitutionAvailability;
    let injected = false;
    let expectedSource: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> | undefined;
    vi.spyOn(availabilityServices, 'previewSubstitutionAvailability').mockImplementationOnce(async (...args) => {
      const result = await originalPreview(...args);
      expect(result.eligibleNow).toBe(true);
      vi.setSystemTime(new Date(Date.now() + 1));
      const current = await prisma.task.findUniqueOrThrow({ where: { id: work.id } });
      if (change === 'en curso') await changeTaskStatus(admin, { id: work.id, status: 'EN_CURSO' });
      else await coordinateWork(admin, { kind: 'task', id: work.id, updatedAt: current.updatedAt, requestKey: randomUUID(), action: change === 'recibido' ? 'RECIBIR' : 'ASIGNAR', ownerId: change === 'otro responsable' ? second.id : undefined, nextAction: 'Cambio humano concurrente verificado' });
      expectedSource = await prisma.task.findUniqueOrThrow({ where: { id: work.id } });
      injected = true;
      return result;
    });
    await sweep();
    expect(injected).toBe(true);
    expect(expectedSource).toBeDefined();
    expect(await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).toEqual(expectedSource);
    expect(await prisma.operationalAutomationRun.count({ where: { policyId: saved.id } })).toBe(0);
    expect(await prisma.taskAssignment.count({ where: { taskId: work.id, userId: first.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { entity: 'Task', entityId: work.id, userId: first.id } })).toBe(0);
  });

  it.each(['OVERDUE','BLOCKED'] as const)('%s conserva al responsable que recibe durante la espera, también en barridos posteriores',async trigger=>{
    const work=await task({assigneeId:admin.id,dueAt:new Date(BASE_TIME.getTime()-60_000)});
    if(trigger==='BLOCKED')await changeTaskStatus(admin,{id:work.id,status:'BLOQUEADA',blockedReason:'Impedimento comunicado antes de recibir'});
    const slot=await schedule();
    const saved=await policy({trigger});
    expect((await preview(saved.id,work.id)).state).toBe('FUTURE_SLOT');
    expect(await sweep()).toMatchObject({attempted:0,failed:0});
    vi.setSystemTime(new Date(BASE_TIME.getTime()+60_000));
    const current=await prisma.task.findUniqueOrThrow({where:{id:work.id}});
    await coordinateWork(admin,{kind:'task',id:work.id,updatedAt:current.updatedAt,requestKey:randomUUID(),action:'RECIBIR',nextAction:'Responsable original recibió y continuará personalmente'});
    const received=await prisma.task.findUniqueOrThrow({where:{id:work.id}});
    expect(received.workAcknowledgedAt).not.toBeNull();expect(received.workStartedAt).toBeNull();expect(received.assigneeId).toBe(admin.id);
    expect(received.updatedAt.getTime()).not.toBe(current.updatedAt.getTime());
    for(const at of [new Date(),slot.startAt!,new Date(slot.startAt!.getTime()+60_000)]){
      vi.setSystemTime(at);
      expect(await preview(saved.id,work.id)).toMatchObject({state:'WORK_CHANGED',selection:null,eligibleNow:false});
      expect(await sweep()).toMatchObject({attempted:0,failed:0});
      expect(await prisma.task.findUniqueOrThrow({where:{id:work.id}})).toEqual(received);
    }
    expect(await prisma.operationalAutomationRun.count({where:{policyId:saved.id}})).toBe(0);
    expect(await prisma.taskAssignment.count({where:{taskId:work.id,userId:first.id}})).toBe(0);
    expect(await prisma.notification.count({where:{entity:'Task',entityId:work.id,userId:first.id}})).toBe(0);
    expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:saved.id}})).enabled).toBe(true);
  });

  it.each(['ACEPTADA','DEVUELTA'] as const)('conserva tarea histórica %s sin marcas posteriores aunque esté vencida',async status=>{
    const work=await task({assigneeId:admin.id,dueAt:new Date(BASE_TIME.getTime()-60_000)});
    // Synthetic legacy row: receipt metadata was introduced without historical backfill.
    await prisma.task.update({where:{id:work.id},data:{status,workAssignedAt:null,workAcknowledgedAt:null,workAcknowledgedById:null,workStartedAt:null}});
    const slot=await schedule();
    const saved=await policy({trigger:'OVERDUE'});
    const before=await effectsSnapshot();
    for(const at of [BASE_TIME,slot.startAt!,new Date(slot.startAt!.getTime()+60_000)]){
      vi.setSystemTime(at);
      expect(await preview(saved.id,work.id)).toMatchObject({state:'WORK_CHANGED',reasonCode:'WORK_NO_LONGER_PENDING',selection:null,eligibleNow:false});
      expect(await sweep()).toMatchObject({attempted:0,failed:0});
      expect(await effectsSnapshot()).toEqual(before);
    }
    expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:saved.id}})).enabled).toBe(true);
  });

  it('conserva HK histórico RECIBIDO sin marcas de recepción o inicio aunque esté vencido',async()=>{
    const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT,name:'Suplente HK sintético'});
    await prisma.user.updateMany({where:{id:{in:[admin.id,maid.id]}},data:{departmentId:hkArea}});
    const work=await createHkWork(admin,{requestKey:randomUUID(),title:'Trabajo HK histórico sintético',description:'Conservar la responsabilidad recibida',workKind:'REPOSICION',workDate:ORIGINAL_DAY,departmentId:hkArea,location:'Zona sintética',priority:'MEDIA',effortMinutes:20,assignedToId:admin.id,dueAt:new Date(BASE_TIME.getTime()-60_000)});
    await prisma.housekeepingRequest.update({where:{id:work.id},data:{status:'RECIBIDO',workAssignedAt:null,acknowledgedAt:null,startedAt:null}});
    const slot=await schedule(maid,{departmentId:hkArea});
    const saved=await policy({kind:'housekeeping',trigger:'OVERDUE',candidateIds:[maid.id]},{departmentId:hkArea});
    const before=await effectsSnapshot();
    for(const at of [BASE_TIME,slot.startAt!,new Date(slot.startAt!.getTime()+60_000)]){
      vi.setSystemTime(at);
      expect(await preview(saved.id,work.id)).toMatchObject({state:'WORK_CHANGED',reasonCode:'WORK_NO_LONGER_PENDING',selection:null,eligibleNow:false});
      expect(await sweep()).toMatchObject({attempted:0,failed:0});
      expect(await effectsSnapshot()).toEqual(before);
    }
    expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:saved.id}})).enabled).toBe(true);
  });

  it.each(['disponibilidad','delegación'] as const)('%s HK recíproca A→B y B→A conserva las dos escrituras sin deadlock de FK',async kind=>{
    const peerCreated=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN,name:'Segundo coordinador sintético'});
    await prisma.user.updateMany({where:{id:{in:[admin.id,peerCreated.id]}},data:{departmentId:hkArea}});
    const left={...admin,departmentId:hkArea},right={...peerCreated,departmentId:hkArea};
    const bothLocked=deferred();let acquired=0;
    const nativeTransaction=servicePrisma.$transaction.bind(servicePrisma);
    async function holdReciprocalLocks<T>(body:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{maxWait?:number;timeout?:number;isolationLevel?:Prisma.TransactionIsolationLevel}):Promise<T>{
      return nativeTransaction(async realTx=>{
        const nativeQuery=realTx.$queryRaw.bind(realTx);
        const wrapped=new Proxy(realTx,{get(target,key,receiver){
          if(key==='$queryRaw')return async(...args:Parameters<Prisma.TransactionClient['$queryRaw']>)=>{
            const result=await nativeQuery(...args);
            const sql=Array.isArray(args[0])?args[0].join(' '):String(args[0]);
            if(sql.includes('FROM "User"')&&/FOR (?:NO KEY )?UPDATE/.test(sql)){
              acquired++;if(acquired===2)bothLocked.resolve();
              await barrier(bothLocked.promise,'ambos coordinadores conservan sus locks de destinatario');
            }
            return result;
          };
          return Reflect.get(target,key,receiver);
        }}) as Prisma.TransactionClient;
        return body(wrapped);
      },{...options,timeout:15_000});
    }
    vi.spyOn(servicePrisma,'$transaction').mockImplementationOnce(holdReciprocalLocks).mockImplementationOnce(holdReciprocalLocks);
    const perform=(actor:CurrentUser,target:CurrentUser)=>kind==='disponibilidad'
      ?confirmHkAvailability(actor,{departmentId:hkArea,workDate:SLOT_DAY,userId:target.id,available:false,note:'Indisponibilidad sintética confirmada por otra persona'})
      :delegateHk(actor,{departmentId:hkArea,userId:target.id,permission:'housekeeping.assign',startsAt:new Date(),endsAt:hotelWallDateTime(SLOT_DAY,18),reason:'Cobertura recíproca sintética autorizada'});
    const results=await Promise.allSettled([perform(left,right),perform(right,left)]);
    expect(acquired).toBe(2);
    expect(results.map(result=>result.status)).toEqual(['fulfilled','fulfilled']);
    if(kind==='disponibilidad'){
      const rows=await prisma.housekeepingDayMember.findMany({where:{departmentId:hkArea,workDate:SLOT_DAY,userId:{in:[left.id,right.id]}}});
      expect(rows).toHaveLength(2);expect(rows.every(row=>row.available===false)).toBe(true);
      expect(await prisma.auditLog.count({where:{entity:'HousekeepingWork',userId:{in:[left.id,right.id]},summary:{contains:'DISPONIBILIDAD'}}})).toBe(2);
    }else{
      const rows=await prisma.housekeepingDelegation.findMany({where:{departmentId:hkArea,userId:{in:[left.id,right.id]},grantedById:{in:[left.id,right.id]}}});
      expect(rows).toHaveLength(2);expect(rows.some(row=>row.userId===left.id&&row.grantedById===right.id)).toBe(true);expect(rows.some(row=>row.userId===right.id&&row.grantedById===left.id)).toBe(true);
      expect(await prisma.auditLog.count({where:{entity:'HousekeepingWork',userId:{in:[left.id,right.id]},summary:{contains:'DELEGAR'}}})).toBe(2);
    }
  });

  it('avanza sobre 25 esperas de la primera página y atiende un registro listo en la segunda', async () => {
    const currentSlot = await schedule(first);
    await schedule(second, { date: '2090-10-03' });
    const waiting = [];
    for (let index = 0; index < 25; index++) waiting.push(await task({ title: `Espera sintética ${index}`, assigneeId: first.id, dueAt: hotelWallDateTime(ORIGINAL_DAY, 9, index) }));
    const ready = await task({ title: 'Listo detrás de las esperas', assigneeId: admin.id, dueAt: hotelWallDateTime(SLOT_DAY, 17) });
    const saved = await policy({ trigger: 'UNRECEIVED', candidateIds: [first.id, second.id] });
    vi.setSystemTime(currentSlot.startAt!);
    const simulation = await simulateAutomation(admin, saved.id);
    expect(simulation.effects).toHaveLength(25);
    expect(simulation.effects.every(effect => !effect.eligible)).toBe(true);
    expect(simulation).toMatchObject({ nextPage: 26, waitingObserved: 25 });
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 0 });
    expect((await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).scanPage).toBe(26);
    expect(await sweep()).toMatchObject({ attempted: 1, failed: 0 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ready.id } })).assigneeId).toBe(first.id);
    expect(await prisma.task.count({ where: { id: { in: waiting.map(row => row.id) }, assigneeId: first.id } })).toBe(25);
    expect(await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } })).toEqual([expect.objectContaining({ stateKey: `substitution:task:${ready.id}`, status: 'SUCCEEDED' })]);
  });

  it('conserva avance por fila si se agota el presupuesto tras una espera y no repite siempre la primera', async () => {
    const earlier = await task({ title: 'Primera espera lenta', dueAt: hotelWallDateTime(SLOT_DAY, 9) });
    const later = await task({ title: 'Segunda espera por revisar', dueAt: hotelWallDateTime(SLOT_DAY, 10) });
    await schedule();
    const saved = await policy();
    const before = await effectsSnapshot();
    const nativePreview = availabilityServices.previewSubstitutionAvailability;
    const previewSpy = vi.spyOn(availabilityServices, 'previewSubstitutionAvailability').mockImplementationOnce(async (...args) => {
      const result = await nativePreview(...args);
      expect(args[2].id).toBe(earlier.id);
      expect(result.state).toBe('FUTURE_SLOT');
      // Consume precisely the existing runner's 15-second read budget, without
      // sleeping, touching timers, or supplying an unrelated future runner time.
      vi.setSystemTime(new Date(Date.now() + 15_000));
      return result;
    });
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 0 });
    expect((await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).scanPage).toBe(2);
    expect(await effectsSnapshot()).toEqual(before);
    previewSpy.mockClear();
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 0 });
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy.mock.calls[0]?.[2].id).toBe(later.id);
    expect((await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).scanPage).toBe(1);
    expect(await effectsSnapshot()).toEqual(before);
  });

  it.each(['rol', 'horario cancelado', 'ausencia publicada'] as const)('el cambio de %s invalida la oportunidad prevista', async change => {
    const work = await task();
    const slot = await schedule();
    const saved = await policy();
    expect((await preview(saved.id, work.id)).state).toBe('FUTURE_SLOT');
    await sweep();
    if (change === 'rol') {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.HK_ATTENDANT } });
      await prisma.user.update({ where: { id: first.id }, data: { roleId: role.id } });
    } else if (change === 'horario cancelado') await cancelScheduleSlot(admin, await mutation(slot.planId), slot.id);
    else await addScheduleSlot(admin, await mutation(slot.planId), { collaboratorId: slot.collaboratorId, date: SLOT_DAY, kind: 'AUSENCIA', note: 'Ausencia sintética privada' }, slot.id);
    vi.setSystemTime(slot.startAt!);
    expect((await preview(saved.id, work.id)).selection).toBeNull();
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 1 });
    expect(await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } })).toEqual([expect.objectContaining({ status: 'INTERVENTION' })]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).assigneeId).toBeNull();
  });

  it.each([ORIGINAL_DAY, SLOT_DAY])('Housekeeping respeta no disponibilidad del día %s, tanto origen como jornada futura', async vetoDay => {
    const maid = await createUser({ roleKey: ROLE_KEYS.HK_ATTENDANT, name: 'Ejecutor HK sintético' });
    await prisma.user.update({ where: { id: maid.id }, data: { departmentId: hkArea } });
    const slot = await schedule(maid, { departmentId: hkArea });
    const work = await createHkWork(admin, { requestKey: randomUUID(), title: 'Reposición pendiente sintética', description: 'Reponer material declarado', workKind: 'REPOSICION', workDate: ORIGINAL_DAY, departmentId: hkArea, location: 'Zona sintética', priority: 'MEDIA', effortMinutes: 20 });
    const saved = await policy({ kind: 'housekeeping', candidateIds: [maid.id] }, { departmentId: hkArea });
    expect((await preview(saved.id, work.id)).selection?.userId).toBe(maid.id);
    await confirmHkAvailability(admin, { departmentId: hkArea, workDate: vetoDay, userId: maid.id, available: false, note: 'Detalle privado de indisponibilidad sintética' });
    const before = await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: work.id } });
    vi.setSystemTime(slot.startAt!);
    const result = await preview(saved.id, work.id);
    expect(result.selection).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Detalle privado');
    expect(await sweep()).toMatchObject({ attempted: 0, failed: 1 });
    expect(await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: work.id } })).toEqual(before);
    expect(await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } })).toEqual([expect.objectContaining({ status: 'INTERVENTION' })]);
    expect(await prisma.housekeepingEvent.count({ where: { requestId: work.id, action: 'ASIGNAR' } })).toBe(0);
  });

  it('una cancelación publicada concurrente invalida evidencia leída antes de su commit', async () => {
    const work = await task();
    const slot = await schedule();
    const saved = await policy();
    const cancelledButUncommitted = deferred();
    const releaseCancellation = deferred();
    const cronReachesLocks = deferred();
    const nativeTransaction = servicePrisma.$transaction.bind(servicePrisma);
    // Intercept only the native cancellation transaction. All queries, validation,
    // updates and locks still run against PostgreSQL; only its commit is gated.
    async function gatedTransaction<T>(body: (tx: Prisma.TransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
      return nativeTransaction(async tx => {
        const result = await body(tx);
        cancelledButUncommitted.resolve();
        await releaseCancellation.promise;
        return result;
      }, options);
    }
    vi.spyOn(servicePrisma, '$transaction').mockImplementationOnce(gatedTransaction);
    const cancelling = cancelScheduleSlot(admin, await mutation(slot.planId), slot.id);
    // Attach a rejection handler immediately; the original result is still asserted.
    void cancelling.catch(() => undefined);
    let running: ReturnType<typeof sweep> | undefined;
    let observedPublishedSlot = false;
    const nativePreview = availabilityServices.previewSubstitutionAvailability;
    const nativeLock = availabilityServices.lockSubstitutionContext;
    try {
      await barrier(cancelledButUncommitted.promise, 'cancelación nativa validada sin commit');
      vi.setSystemTime(slot.startAt!);
      vi.spyOn(availabilityServices, 'previewSubstitutionAvailability').mockImplementationOnce(async (...args) => {
        const result = await nativePreview(...args);
        observedPublishedSlot = result.eligibleNow && result.selection?.slotId === slot.id;
        return result;
      });
      vi.spyOn(availabilityServices, 'lockSubstitutionContext').mockImplementationOnce(async (...args) => {
        const locking = nativeLock(...args);
        cronReachesLocks.resolve();
        await locking;
      });
      running = sweep();
      void running.catch(() => undefined);
      await barrier(cronReachesLocks.promise, 'cron inició revalidación transaccional');
      expect(observedPublishedSlot).toBe(true);
      releaseCancellation.resolve();
      await cancelling;
      await running;
      expect((await prisma.scheduleSlot.findUniqueOrThrow({ where: { id: slot.id } })).cancelledAt).not.toBeNull();
      expect((await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).assigneeId).toBeNull();
      expect(await prisma.operationalAutomationRun.count({ where: { policyId: saved.id } })).toBe(0);
      expect(await prisma.notification.count({ where: { entity: 'Task', entityId: work.id, userId: first.id } })).toBe(0);
      // A serialization retry is safe only if it rereads the cancellation too.
      await sweep();
      await noSuccess(saved.id);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: work.id } })).assigneeId).toBeNull();
    } finally {
      releaseCancellation.resolve();
      await Promise.allSettled([cancelling, ...(running ? [running] : [])]);
    }
  });

  it('un deadlock real P2010/40P01 revierte el efecto y conserva política y cursor hasta el siguiente barrido',async()=>{
    await task({title:'Fila anterior ya asignada',assigneeId:admin.id,dueAt:hotelWallDateTime(ORIGINAL_DAY,9)});
    const work=await task({title:'Suplencia detrás de fila anterior',dueAt:hotelWallDateTime(SLOT_DAY,17)});
    const slot=await schedule();
    const saved=await policy();
    await prisma.operationalAutomation.update({where:{id:saved.id},data:{scanPage:2}});
    vi.setSystemTime(slot.startAt!);
    const before=await effectsSnapshot();
    const blockerLocked=deferred(),effectWritten=deferred();
    let observedError:unknown;
    let assignmentWrittenInsideTransaction=false;
    const nativeApply=substitutionServices.applyPreparedSubstitution;
    const applySpy=vi.spyOn(substitutionServices,'applyPreparedSubstitution').mockImplementationOnce(async(...args)=>{
      const result=await nativeApply(...args),tx=args[6];
      assignmentWrittenInsideTransaction=!!await tx.taskAssignment.count({where:{taskId:work.id,userId:first.id,removedAt:null}});
      // Make the executor the deterministic deadlock victim without relaxing a timeout.
      await tx.$executeRaw`SET LOCAL deadlock_timeout = '100ms'`;
      effectWritten.resolve();
      try{
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${second.id} FOR SHARE`;
      }catch(error){observedError=error;throw error;}
      return result;
    });
    const blocking=prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${second.id} FOR UPDATE`;
      blockerLocked.resolve();
      await barrier(effectWritten.promise,'el efecto nativo escribió dentro de la transacción');
      await tx.$queryRaw`SELECT "id" FROM "OperationalAutomation" WHERE "id"=${saved.id} FOR SHARE`;
    },{timeout:15_000,isolationLevel:'ReadCommitted'});
    void blocking.catch(()=>undefined);
    try{
      await barrier(blockerLocked.promise,'el competidor conserva su lock');
      expect(await sweep()).toMatchObject({attempted:0,failed:0,deferred:true});
      await blocking;
      expect(observedError).toMatchObject({code:'P2010',meta:{code:'40P01'}});
      expect(assignmentWrittenInsideTransaction).toBe(true);
      expect(applySpy).toHaveBeenCalledTimes(1);
      expect(await effectsSnapshot()).toEqual(before);
      expect(await prisma.operationalAutomation.findUniqueOrThrow({where:{id:saved.id}})).toMatchObject({enabled:true,version:saved.version,scanPage:2,lastEvaluatedAt:slot.startAt});
      expect(await sweep()).toMatchObject({attempted:1,failed:0});
      const applied=await effectsSnapshot();
      expect((await prisma.task.findUniqueOrThrow({where:{id:work.id}})).assigneeId).toBe(first.id);
      expect(await prisma.operationalAutomationRun.findMany({where:{policyId:saved.id}})).toEqual([expect.objectContaining({status:'SUCCEEDED',stateKey:`substitution:task:${work.id}`})]);
      await sweep();
      expect(await effectsSnapshot()).toEqual(applied);
    }finally{
      effectWritten.resolve();
      await Promise.allSettled([blocking]);
    }
  });

  it('dos cron simultáneos confirman una sola suplencia y un solo aviso', async () => {
    const work = await task();
    const slot = await schedule();
    const saved = await policy();
    vi.setSystemTime(slot.startAt!);
    const results = await Promise.all([sweep(), sweep()]);
    expect(results.reduce((sum, result) => sum + result.attempted, 0)).toBe(1);
    await sweep();
    expect(await prisma.operationalAutomationRun.findMany({ where: { policyId: saved.id } })).toEqual([expect.objectContaining({ status: 'SUCCEEDED', stateKey: `substitution:task:${work.id}` })]);
    expect(await prisma.taskAssignment.count({ where: { taskId: work.id, userId: first.id, removedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entity: 'Task', entityId: work.id, action: 'CAMBIO_RESPONSABLE' } })).toBe(1);
    expect(await prisma.notification.count({ where: { entity: 'Task', entityId: work.id, userId: first.id } })).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: work.id } }))).toMatchObject({ assigneeId: first.id, workAcknowledgedAt: null, workStartedAt: null });
    expect((await prisma.operationalAutomation.findUniqueOrThrow({ where: { id: saved.id } })).enabled).toBe(true);
  });
});
