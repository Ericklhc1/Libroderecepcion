import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma, SchedulePlan, ScheduleSlot } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import type { PermissionKey } from '@/lib/permissions';
import { NotFoundError, RuleError } from '@/server/errors';
import { coverageSlots, coverageGaps, dateDays, datePlus, dayWindow, mutationSchema, scheduleAllowed, scheduleDate, scheduleId, scheduleTeamAccess, slotSchema, templateWindow as domainTemplateWindow, weeklyTotals, type SlotInput } from '@/domain/schedule';
import { hotelCalendarDate, hotelDateKey } from '@/domain/time';
import { assertScheduleArea, assertSchedulePermission, scheduleAreaIds } from './schedule-access';
import { lockScheduleAreas } from './schedule-catalog';
import { scheduleWebPushForUsers } from './web-push-scheduler';

type Tx = Prisma.TransactionClient;
type Mutation = z.infer<typeof mutationSchema>;
type Change = { before?: unknown; after?: unknown; affected: string[] };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? {}));
function rule(message: string): never { throw new RuleError(message); }
function templateWindow(...args: Parameters<typeof domainTemplateWindow>) {
  try { return domainTemplateWindow(...args); } catch (e) { rule((e as Error).message); }
}
export async function getScheduleDepartments(user: CurrentUser) {
  assertSchedulePermission(user);
  if (!scheduleTeamAccess(user)) {
    return prisma.department.findMany({ where: { active: true, OR: [{ scheduleMemberships: { some: { active: true, collaborator: { userId: user.id, active: true } } } }, { schedulePlans: { some: { status: 'PUBLICADO', acknowledgments: { some: { userId: user.id } } } } }] }, orderBy: { order: 'asc' } });
  }
  const scope = await scheduleAreaIds(user, true);
  return prisma.department.findMany({ where: { active: true, ...(scope ? { id: { in: scope } } : {}) }, orderBy: { order: 'asc' } });
}
export async function getSchedulePlan(user: CurrentUser, id: string, client: Tx | typeof prisma = prisma) {
  assertSchedulePermission(user);
  const plan = await client.schedulePlan.findUnique({ where: { id }, include: { department: true } });
  if (!plan) throw new NotFoundError();
  if (scheduleTeamAccess(user)) {
    const scope = await scheduleAreaIds(user, true, client);
    if (scope && !scope.includes(plan.departmentId)) throw new NotFoundError();
    if (plan.status !== 'PUBLICADO') {
      if (!scheduleAllowed(user, 'schedule.manage') && !scheduleAllowed(user, 'schedule.publish')) throw new NotFoundError();
      await assertScheduleArea(user, plan.departmentId, scheduleAllowed(user, 'schedule.manage') ? 'schedule.manage' : 'schedule.publish', client);
    }
  } else {
    if (plan.status !== 'PUBLICADO' || (!await client.scheduleSlot.findFirst({ where: { planId: id, cancelledAt: null, collaborator: { userId: user.id } } }) && !await client.scheduleAcknowledgment.findFirst({ where: { planId: id, userId: user.id } }))) throw new NotFoundError();
  }
  return plan;
}
export async function createSchedulePlan(user: CurrentUser, raw: unknown) {
  assertSchedulePermission(user, 'schedule.manage');
  const input = z.object({ departmentId: scheduleId, startDate: scheduleDate, endDate: scheduleDate }).parse(raw);
  try { dateDays(input.startDate, input.endDate); } catch (e) { rule((e as Error).message); }
  await assertScheduleArea(user, input.departmentId, 'schedule.manage');
  return prisma.$transaction(async (tx) => {
    await lockScheduleAreas(tx, [input.departmentId]);
    if (!await tx.department.findFirst({ where: { id: input.departmentId, active: true } })) rule('El área no está activa.');
    if (input.startDate < hotelDateKey(new Date())) rule('Una malla nueva debe comenzar hoy o en una fecha futura.');
    const startDate = new Date(`${input.startDate}T00:00:00Z`); const endDate = new Date(`${input.endDate}T00:00:00Z`);
    const exact = await tx.schedulePlan.findFirst({ where: { departmentId: input.departmentId, startDate, endDate } });
    if (exact) return exact;
    if (await tx.schedulePlan.findFirst({ where: { departmentId: input.departmentId, startDate: { lte: endDate }, endDate: { gte: startDate } } })) rule('Ya hay una malla del área que se cruza con este periodo. Abre esa malla para modificarla.');
    const plan = await tx.schedulePlan.create({ data: { departmentId: input.departmentId, startDate, endDate } });
    await tx.auditLog.create({ data: { entity: 'SchedulePlan', entityId: plan.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Malla #${plan.humanId} creada`, after: input } }); return plan;
  });
}
export async function lockScheduleCollaborators(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id" = ${id} FOR UPDATE`;
}
function futureSlot(s: Pick<ScheduleSlot, 'startAt' | 'date'>) {
  if (s.startAt ? s.startAt <= new Date() : s.date < hotelCalendarDate()) rule('La asignación ya comenzó o pertenece al pasado. Se conserva su historial; no se puede mover ni cancelar desde el calendario.');
}
export async function validateScheduleCollaborators(tx: Tx, ids: string[]) {
  await lockScheduleCollaborators(tx, ids);
  const people = await tx.scheduleCollaborator.findMany({ where: { id: { in: ids } }, include: { memberships: true, slots: { where: { cancelledAt: null, OR: [{ endAt: { gte: new Date(Date.now() - 48 * 3600000) } }, { date: { gte: new Date(hotelCalendarDate().getTime() - 2 * 86400000) } }] }, include: { plan: { select: { departmentId: true } } }, orderBy: [{ date: 'asc' }, { startAt: 'asc' }] } } });
  for (const person of people) {
    const slots = person.slots;
    for (const s of slots) {
      if (s.date >= hotelCalendarDate() && (!person.active || !person.memberships.some((m) => m.active && m.departmentId === s.plan.departmentId))) rule(`${person.name} no está habilitado en el área de una asignación futura.`);
    }
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!; const b = slots[j]!;
      if (a.date.getTime() === b.date.getTime() && (a.kind !== 'TURNO' || b.kind !== 'TURNO')) rule(`${person.name} tiene un descanso o ausencia incompatible con otra asignación ese día.`);
      const absence = a.kind === 'VACACIONES' || a.kind === 'AUSENCIA' ? a : b.kind === 'VACACIONES' || b.kind === 'AUSENCIA' ? b : null;
      const work = absence === a ? b : a;
      if (absence && work.startAt && work.endAt) {
        const w = dayWindow(absence.date.toISOString().slice(0, 10));
        if (work.startAt < w.endAt && work.endAt > w.startAt) rule(`${person.name} tiene trabajo que se cruza con una ausencia o vacaciones.`);
      }
      if (!a.startAt || !a.endAt || !b.startAt || !b.endAt) continue;
      const earlier = a.startAt <= b.startAt ? a : b; const later = earlier === a ? b : a;
      const gap = (later.startAt!.getTime() - earlier.endAt!.getTime()) / 60000;
      if (gap < 0) rule(`${person.name} tiene turnos superpuestos, incluso al cruzar medianoche o cambiar de área.`);
      if (gap < person.minRestMinutes && later.startAt! > new Date()) rule(`${person.name} no cumple el descanso mínimo configurado de ${person.minRestMinutes / 60} horas.`);
    }
  }
}
export async function buildScheduleSlot(tx: Tx, plan: SchedulePlan, input: SlotInput): Promise<Prisma.ScheduleSlotUncheckedCreateInput> {
  const date = new Date(`${input.date}T00:00:00Z`);
  if (date < plan.startDate || date > plan.endDate) rule('La fecha está fuera de la malla.');
  const person = await tx.scheduleCollaborator.findFirst({ where: { id: input.collaboratorId, active: true, memberships: { some: { departmentId: plan.departmentId, active: true } } } });
  if (!person) rule('El colaborador debe estar activo y habilitado en esta área.');
  if (input.kind !== 'TURNO') {
    if (date < hotelCalendarDate()) rule('No se pueden crear descansos o ausencias retroactivos.');
    return { planId: plan.id, collaboratorId: person.id, date, kind: input.kind, code: input.kind, functionName: person.functionName, note: input.note || null };
  }
  const template = await tx.scheduleTemplate.findFirst({ where: { id: input.templateId, departmentId: plan.departmentId, active: true } });
  if (!template) rule('Selecciona una plantilla activa del área.');
  let window: ReturnType<typeof templateWindow>;
  try { window = templateWindow(input.date, template); } catch (e) { rule((e as Error).message); }
  futureSlot({ startAt: window.startAt, date });
  const endAt = new Date(window.endAt.getTime() + input.extraMinutes * 60000);
  return { planId: plan.id, collaboratorId: person.id, date, kind: 'TURNO', templateId: template.id, code: template.code, functionName: person.functionName, startTime: template.startTime, endTime: template.endTime, crossesMidnight: template.crossesMidnight, ...window, baseEndAt: window.endAt, endAt, breakMinutes: template.breakMinutes, breakPaid: template.breakPaid, extraKind: input.extraKind, extraMinutes: input.extraMinutes, extraStatus: input.extraKind === 'NINGUNO' ? 'NO_APLICA' : 'PENDIENTE', note: input.note || null };
}
async function schedulePublication(tx: Tx, plan: SchedulePlan, version: number, affected: string[], first: boolean, reason: string): Promise<string[]> {
  const people = await tx.scheduleCollaborator.findMany({ where: { id: { in: affected }, user: { is: { active: true, deletedAt: null, role: { permissions: { some: { permission: { key: { in: [...['schedule.self.view', 'schedule.view', 'schedule.view.all', 'schedule.manage', 'schedule.publish', 'schedule.catalog.manage', 'schedule.extra.approve', 'schedule.configure']] } } } } } } } }, select: { userId: true } });
  const users = [...new Set(people.flatMap((p) => p.userId ? [p.userId] : []))];
  if (users.length) {
    await tx.scheduleAcknowledgment.createMany({ data: users.map((userId) => ({ planId: plan.id, userId, version })), skipDuplicates: true });
    await tx.notification.createMany({ data: users.map((userId) => ({ userId, type: 'ACCION_REQUERIDA' as const, entity: 'SchedulePlan', entityId: plan.id, title: first ? 'Tu horario fue publicado' : 'Tu horario cambió', body: `Revisa y confirma la malla #${plan.humanId}.${reason ? ` Motivo: ${reason}` : ''} Confirmar recepción no acredita asistencia.`, link: `/equipo?area=${plan.departmentId}&malla=${plan.id}` })) });
  }
  return users;
}
export async function mutateSchedulePlan(user: CurrentUser, raw: Mutation, action: string, permission: PermissionKey, payload: unknown, fn: (tx: Tx, plan: SchedulePlan) => Promise<Change>, options: { publish?: boolean; noScheduleChange?: boolean; ownSlotId?: string } = {}) {
  const input = mutationSchema.parse(raw); assertSchedulePermission(user, permission);
  const seen = await prisma.schedulePlan.findUnique({ where: { id: input.planId }, select: { departmentId: true } }); if (!seen) throw new NotFoundError();
  if (!options.ownSlotId) await assertScheduleArea(user, seen.departmentId, permission);
  const hash = createHash('sha256').update(JSON.stringify({ action, input, payload })).digest('hex');
  const result = await prisma.$transaction(async (tx) => {
    await lockScheduleAreas(tx, [seen.departmentId]);
    await tx.$queryRaw`SELECT "id" FROM "SchedulePlan" WHERE "id" = ${input.planId} FOR UPDATE`;
    const plan = await tx.schedulePlan.findUniqueOrThrow({ where: { id: input.planId } });
    if (options.ownSlotId && plan.status !== 'PUBLICADO') throw new NotFoundError();
    if (options.ownSlotId && !await tx.scheduleSlot.findFirst({ where: { id: options.ownSlotId, planId: plan.id, cancelledAt: null, collaborator: { userId: user.id } } })) throw new NotFoundError();
    const prior = await tx.scheduleEvent.findUnique({ where: { requestKey: input.requestKey } });
    if (prior) {
      if (prior.actorId !== user.id || prior.planId !== plan.id || prior.requestHash !== hash) rule('La clave de esta operación ya fue utilizada con otros datos.');
      return { plan, notifyUsers: [] as string[] };
    }
    if (plan.version !== input.version) rule('La malla cambió en otra ventana. Actualiza antes de continuar.');
    const published = plan.status === 'PUBLICADO';
    if (published && !options.noScheduleChange && permission !== 'schedule.extra.approve') await assertScheduleArea(user, plan.departmentId, 'schedule.publish', tx);
    if ((published || options.publish) && !input.reason.trim()) rule('Registra un motivo antes de publicar o cambiar un horario publicado.');
    const change = await fn(tx, plan);
    await validateScheduleCollaborators(tx, [...new Set(change.affected)]);
    const version = plan.version + 1;
    const shouldPublish = options.publish || (published && !options.noScheduleChange);
    const updated = await tx.schedulePlan.update({ where: { id: plan.id }, data: { version, ...(shouldPublish ? { status: 'PUBLICADO', publishedAt: new Date(), publishedVersion: version } : {}) } });
    await tx.scheduleEvent.create({ data: { planId: plan.id, actorId: user.id, requestKey: input.requestKey, requestHash: hash, action, version, reason: input.reason || null, before: json(change.before), after: json(change.after) } });
    await tx.auditLog.create({ data: { entity: 'SchedulePlan', entityId: plan.id, action: 'EDITAR', userId: user.id, sessionId: user.sessionId, summary: `Malla #${plan.humanId}: ${action} · revisión ${version}`, reason: input.reason || null, before: json(change.before), after: json(change.after) } });
    const notifyUsers = shouldPublish ? await schedulePublication(tx, plan, version, change.affected, !published, input.reason) : [];
    return { plan: updated, notifyUsers };
  }, { maxWait: 10000, timeout: 30000 });
  if (result.notifyUsers.length) scheduleWebPushForUsers(result.notifyUsers);
  return result.plan;
}
export async function addScheduleSlot(user: CurrentUser, mutation: Mutation, raw: unknown, replaceSlotId?: string) {
  const input = slotSchema.parse(raw);
  return mutateSchedulePlan(user, mutation, replaceSlotId ? 'ACTUALIZAR_ASIGNACION' : 'ASIGNAR', 'schedule.manage', { input, replaceSlotId }, async (tx, plan) => {
    const previous = replaceSlotId ? await tx.scheduleSlot.findFirst({ where: { id: replaceSlotId, planId: plan.id, cancelledAt: null } }) : null;
    if (replaceSlotId && !previous) throw new NotFoundError();
    if (previous) { futureSlot(previous); if (!mutation.reason.trim()) rule('Registra el motivo del cambio de asignación.'); }
    await lockScheduleCollaborators(tx, [input.collaboratorId, ...(previous ? [previous.collaboratorId] : [])]);
    if (previous) await tx.scheduleSlot.update({ where: { id: previous.id }, data: { cancelledAt: new Date() } });
    const slot = await tx.scheduleSlot.create({ data: await buildScheduleSlot(tx, plan, input) }); return { before: previous, after: slot, affected: [slot.collaboratorId, ...(previous ? [previous.collaboratorId] : [])] };
  });
}
export const moveSchema = z.object({ slotId: scheduleId, targetCollaboratorId: scheduleId, targetDate: scheduleDate, mode: z.enum(['MOVER', 'REASIGNAR', 'INTERCAMBIAR', 'AGREGAR']), targetSlotId: z.string().max(100).optional() });
export async function moveScheduleSlot(user: CurrentUser, mutation: Mutation, raw: unknown) {
  const input = moveSchema.parse(raw);
  return mutateSchedulePlan(user, mutation, input.mode, 'schedule.manage', input, async (tx, plan) => {
    const source = await tx.scheduleSlot.findFirst({ where: { id: input.slotId, planId: plan.id, cancelledAt: null } }); if (!source) throw new NotFoundError(); futureSlot(source);
    if (source.extraKind !== 'NINGUNO') rule('Una asignación con extras requiere revisión específica. No se arrastra ni intercambia su aprobación.');
    if (source.collaboratorId === input.targetCollaboratorId && source.date.toISOString().slice(0, 10) === input.targetDate) rule('Elige una persona o fecha diferente.');
    if (input.mode === 'MOVER' && source.collaboratorId !== input.targetCollaboratorId) rule('Mover conserva el colaborador; usa Reasignar para cambiarlo.');
    if (input.mode === 'REASIGNAR' && source.collaboratorId === input.targetCollaboratorId) rule('Reasignar requiere otro colaborador.');
    let target: ScheduleSlot | null = null;
    if (input.mode === 'INTERCAMBIAR') {
      target = await tx.scheduleSlot.findFirst({ where: { id: input.targetSlotId || '', planId: plan.id, cancelledAt: null, collaboratorId: input.targetCollaboratorId, date: new Date(`${input.targetDate}T00:00:00Z`) } });
      if (!target || target.id === source.id) rule('Selecciona la asignación de destino para intercambiar.'); futureSlot(target);
      if (target.extraKind !== 'NINGUNO') rule('No se intercambia una asignación con extras.');
    }
    await lockScheduleCollaborators(tx, [source.collaboratorId, input.targetCollaboratorId]);
    const clone = async (s: ScheduleSlot, collaboratorId: string, dateKey: string) => {
      const person = await tx.scheduleCollaborator.findFirst({ where: { id: collaboratorId, active: true, memberships: { some: { departmentId: plan.departmentId, active: true } } } }); if (!person) rule('El destino no pertenece al área o está inactivo.');
      const { id: _id, createdAt: _created, updatedAt: _updated, ...values } = s;
      const clocks = s.kind === 'TURNO' ? templateWindow(dateKey, { startTime: s.startTime!, endTime: s.endTime!, crossesMidnight: s.crossesMidnight, breakStartTime: s.breakStartAt ? `${hotelPartsTime(s.breakStartAt)}` : null, breakMinutes: s.breakMinutes, breakPaid: s.breakPaid }) : { startAt: null, endAt: null, breakStartAt: null, breakEndAt: null };
      const data = { ...values, ...clocks, baseEndAt: clocks.endAt, collaboratorId, date: new Date(`${dateKey}T00:00:00Z`), functionName: person.functionName, cancelledAt: null };
      futureSlot(data); return tx.scheduleSlot.create({ data });
    };
    const before = target ? [source, target] : [source];
    if (input.mode !== 'AGREGAR') await tx.scheduleSlot.update({ where: { id: source.id }, data: { cancelledAt: new Date() } });
    if (target) await tx.scheduleSlot.update({ where: { id: target.id }, data: { cancelledAt: new Date() } });
    const after = [await clone(source, input.targetCollaboratorId, input.targetDate)];
    if (target) after.push(await clone(target, source.collaboratorId, source.date.toISOString().slice(0, 10)));
    return { before, after, affected: [source.collaboratorId, input.targetCollaboratorId] };
  });
}
function hotelPartsTime(date: Date) { const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); return formatter.format(date); }
export async function cancelScheduleSlot(user: CurrentUser, mutation: Mutation, slotId: string) {
  scheduleId.parse(slotId); if (!mutation.reason.trim()) rule('Indica por qué cancelas la asignación.');
  return mutateSchedulePlan(user, mutation, 'CANCELAR_ASIGNACION', 'schedule.manage', { slotId }, async (tx, plan) => {
    const slot = await tx.scheduleSlot.findFirst({ where: { id: slotId, planId: plan.id, cancelledAt: null } }); if (!slot) throw new NotFoundError(); futureSlot(slot);
    await lockScheduleCollaborators(tx, [slot.collaboratorId]); const after = await tx.scheduleSlot.update({ where: { id: slot.id }, data: { cancelledAt: new Date() } }); return { before: slot, after, affected: [slot.collaboratorId] };
  });
}
export async function publishSchedulePlan(user: CurrentUser, mutation: Mutation) {
  return mutateSchedulePlan(user, mutation, 'PUBLICAR', 'schedule.publish', {}, async (tx, plan) => {
    if (plan.status === 'PUBLICADO') rule('Esta malla ya está publicada. Los cambios posteriores se publican con su propio motivo e historial.');
    const slots = await tx.scheduleSlot.findMany({ where: { planId: plan.id, cancelledAt: null } });
    if (!slots.length) rule('Agrega asignaciones antes de publicar.');
    return { before: { status: plan.status }, after: { status: 'PUBLICADO', slots }, affected: slots.map((s) => s.collaboratorId) };
  }, { publish: true });
}
export async function changeScheduleExtra(user: CurrentUser, mutation: Mutation, raw: unknown) {
  const input = z.object({ slotId: scheduleId, action: z.enum(['APROBAR', 'RECHAZAR', 'REPORTAR', 'VALIDAR']), reportedMinutes: z.coerce.number().int().min(0).max(2160).default(0) }).parse(raw);
  const own = input.action === 'REPORTAR' && !scheduleAllowed(user, 'schedule.manage');
  const permission: PermissionKey = own ? 'schedule.self.view' : input.action === 'REPORTAR' ? 'schedule.manage' : 'schedule.extra.approve';
  if (!mutation.reason.trim()) rule('Registra el motivo o evidencia de la gestión del extra.');
  return mutateSchedulePlan(user, mutation, `EXTRA_${input.action}`, permission, input, async (tx, plan) => {
    const slot = await tx.scheduleSlot.findFirst({ where: { id: input.slotId, planId: plan.id, cancelledAt: null } }); if (!slot) throw new NotFoundError();
    if (slot.extraKind === 'NINGUNO') rule('La asignación no tiene un extra solicitado.');
    let extraStatus: string; let reportedExtraMinutes: number | undefined;
    if (['APROBAR', 'RECHAZAR'].includes(input.action)) {
      if (slot.extraStatus !== 'PENDIENTE') rule('El extra ya fue gestionado.'); extraStatus = input.action === 'APROBAR' ? 'APROBADO' : 'RECHAZADO';
    } else if (input.action === 'REPORTAR') {
      if (slot.extraStatus !== 'APROBADO' || !slot.endAt || slot.endAt > new Date()) rule('Informa la realización después del término de un extra aprobado.'); extraStatus = 'REPORTADO'; reportedExtraMinutes = input.reportedMinutes;
    } else {
      if (slot.extraStatus !== 'REPORTADO') rule('Primero debe informarse la realización del extra.'); extraStatus = 'VALIDADO';
    }
    await lockScheduleCollaborators(tx, [slot.collaboratorId]);
    if (input.action === 'RECHAZAR') {
      const extraStart = slot.extraKind === 'EXTENSION' ? slot.baseEndAt : slot.startAt;
      if (!extraStart || extraStart <= new Date()) rule('El extra ya comenzó. Conserva su registro y revisa la realización; no se rechaza retroactivamente.');
    }
    const after = await tx.scheduleSlot.update({ where: { id: slot.id }, data: { extraStatus, ...(input.action === 'RECHAZAR' ? slot.extraKind === 'TURNO_EXTRA' ? { cancelledAt: new Date() } : { endAt: slot.baseEndAt } : {}), ...(reportedExtraMinutes !== undefined ? { reportedExtraMinutes } : {}) } });
    return { before: slot, after, affected: [slot.collaboratorId] };
  }, { noScheduleChange: ['REPORTAR', 'VALIDAR'].includes(input.action), ...(own ? { ownSlotId: input.slotId } : {}) });
}
export async function acknowledgeSchedule(user: CurrentUser, planId: string, version: number) {
  assertSchedulePermission(user); scheduleId.parse(planId); z.number().int().positive().parse(version);
  return prisma.$transaction(async (tx) => {
    await getSchedulePlan(user, planId, tx);
    const latest = await tx.scheduleAcknowledgment.findFirst({ where: { planId, userId: user.id }, orderBy: { version: 'desc' } });
    if (!latest || latest.version !== version) rule('Hay una revisión más reciente o no tienes una confirmación pendiente en esta malla.');
    const changed = await tx.scheduleAcknowledgment.updateMany({ where: { id: latest.id, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } });
    if (changed.count) await tx.auditLog.create({ data: { entity: 'ScheduleAcknowledgment', entityId: latest.id, action: 'EDITAR', userId: user.id, sessionId: user.sessionId, summary: `Horario recibido · revisión ${version}`, after: { planId, version } } });
  });
}
export async function getScheduleBoard(user: CurrentUser, departmentId: string, focusId?: string) {
  assertSchedulePermission(user); const departments = await getScheduleDepartments(user);
  if (!departments.some((d) => d.id === departmentId)) throw new NotFoundError();
  const scope = await scheduleAreaIds(user); const writable = scope === null || scope.includes(departmentId);
  const canManage = writable && scheduleAllowed(user, 'schedule.manage'); const canPublish = writable && scheduleAllowed(user, 'schedule.publish'); const team = scheduleTeamAccess(user);
  const plans = await prisma.schedulePlan.findMany({ where: { departmentId, ...(!canManage && !canPublish ? { status: 'PUBLICADO' } : {}), ...(!team ? { OR: [{ slots: { some: { collaborator: { userId: user.id }, cancelledAt: null } } }, { acknowledgments: { some: { userId: user.id } } }] } : {}) }, orderBy: { startDate: 'desc' }, take: 24 });
  const focused = focusId ? await getSchedulePlan(user, focusId) : null;
  if (focused && focused.departmentId !== departmentId) throw new NotFoundError();
  const selected = focused ?? plans.find((p) => p.endDate >= hotelCalendarDate()) ?? plans[0];
  if (focused && !plans.some((p) => p.id === focused.id)) plans.push(focused);
  const collaborators = await prisma.scheduleCollaborator.findMany({ where: { ...(team ? {} : { userId: user.id }), memberships: { some: { departmentId, active: true } }, ...(canManage ? { active: true } : {}) }, orderBy: { name: 'asc' }, take: 500 });
  const templates = canManage ? await prisma.scheduleTemplate.findMany({ where: { departmentId, active: true }, orderBy: { code: 'asc' } }) : [];
  if (!selected) return { plans, selected: null, collaborators, templates, slots: [], contextSlots: [], rules: [], gaps: [], totals: {}, holidays: [], events: [], acknowledgments: [], imports: [], canManage, canPublish, canApprove: writable && scheduleAllowed(user, 'schedule.extra.approve'), team };
  const from = datePlus(selected.startDate.toISOString().slice(0, 10), -7); const to = datePlus(selected.endDate.toISOString().slice(0, 10), 7);
  const [slots, contextSlots, rules, holidays, events, acknowledgments, imports] = await Promise.all([
    prisma.scheduleSlot.findMany({ where: { planId: selected.id, cancelledAt: null, ...(team ? {} : { collaborator: { userId: user.id } }) }, include: { collaborator: { select: { id: true, name: true, employeeCode: true, weeklyMinutes: true, userId: true } } }, orderBy: [{ date: 'asc' }, { startAt: 'asc' }] }),
    prisma.scheduleSlot.findMany({ where: { cancelledAt: null, date: { gte: new Date(from), lte: new Date(to) }, ...(team ? { OR: [{ plan: { departmentId, status: 'PUBLICADO' } }, { planId: selected.id }] } : { collaborator: { userId: user.id }, plan: { departmentId, status: 'PUBLICADO' } }) } }),
    team ? prisma.scheduleCoverageRule.findMany({ where: { departmentId, active: true } }) : Promise.resolve([]),
    prisma.scheduleHoliday.findMany({ where: { active: true, date: { gte: new Date(from), lte: new Date(to) } }, orderBy: { date: 'asc' } }),
    canManage || canPublish ? prisma.scheduleEvent.findMany({ where: { planId: selected.id }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }) : Promise.resolve([]),
    prisma.scheduleAcknowledgment.findMany({ where: { planId: selected.id, ...(!canManage && !canPublish ? { userId: user.id } : {}) }, include: { user: { select: { name: true } } }, orderBy: { version: 'desc' }, distinct: ['userId'], take: 500 }),
    canManage ? prisma.scheduleImport.findMany({ where: { planId: selected.id, status: 'REVISION' }, orderBy: { createdAt: 'desc' }, take: 10 }) : Promise.resolve([]),
  ]);
  const days = dateDays(selected.startDate.toISOString().slice(0, 10), selected.endDate.toISOString().slice(0, 10));
  const effective = coverageSlots(contextSlots);
  // Aggregate published work across areas without returning other areas' records.
  const personIds = [...new Set([...collaborators.map((p) => p.id), ...slots.map((s) => s.collaboratorId)])];
  const weeklySlots = await prisma.scheduleSlot.findMany({ where: { collaboratorId: { in: personIds }, cancelledAt: null, date: { gte: new Date(from), lte: new Date(to) }, OR: [{ plan: { status: 'PUBLICADO' } }, { planId: selected.id }] } });
  return { plans, selected, collaborators, templates, slots, contextSlots, rules, gaps: coverageGaps(days, rules, effective), totals: weeklyTotals(weeklySlots), holidays, events, acknowledgments, imports, canManage, canPublish, canApprove: writable && scheduleAllowed(user, 'schedule.extra.approve'), team };
}
