import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError, NotFoundError } from '@/server/errors';
import { scheduleDate, scheduleId, scheduleTime, templateSchema, templateWindow, scheduleAllowed } from '@/domain/schedule';
import { hotelCalendarDate } from '@/domain/time';
import { assertScheduleArea, assertSchedulePermission, scheduleAreaIds, type ScheduleClient } from './schedule-access';

export async function lockScheduleAreas(tx: ScheduleClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${id} FOR UPDATE`;
}
export async function scheduleCatalogAudit(tx: ScheduleClient, user: CurrentUser, departmentId: string, summary: string, after: object) {
  await tx.auditLog.create({ data: { entity: 'ScheduleCatalog', entityId: departmentId, action: 'EDITAR', summary, userId: user.id, sessionId: user.sessionId, after: JSON.parse(JSON.stringify(after)) } });
}
export const collaboratorSchema = z.object({ id: z.string().max(100).optional(), version: z.coerce.number().int().min(0).default(0), employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,32}$/), name: z.string().trim().min(2).max(160), functionName: z.string().trim().min(2).max(100), userId: z.string().max(100).optional().default(''), departmentIds: z.array(scheduleId).min(1).max(20), active: z.boolean().default(true), weeklyMinutes: z.coerce.number().int().min(0).max(10080).default(0), minRestMinutes: z.coerce.number().int().min(0).max(2880).default(0) });
export async function saveScheduleCollaborator(user: CurrentUser, raw: z.input<typeof collaboratorSchema>) {
  assertSchedulePermission(user, 'schedule.catalog.manage'); const input = collaboratorSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const existing = input.id ? await tx.scheduleCollaborator.findUnique({ where: { id: input.id }, include: { memberships: true } }) : null;
    if (input.id && !existing) throw new NotFoundError();
    const areas = [...new Set([...input.departmentIds, ...(existing?.memberships.map((m) => m.departmentId) ?? [])])];
    for (const area of areas) await assertScheduleArea(user, area, 'schedule.catalog.manage', tx);
    await lockScheduleAreas(tx, areas);
    if (existing) {
      await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id" = ${existing.id} FOR UPDATE`;
      const current = await tx.scheduleCollaborator.findUniqueOrThrow({ where: { id: existing.id } });
      if (current.version !== input.version) throw new RuleError('El colaborador cambió. Actualiza antes de guardar.');
    }
    const activeDepartments = await tx.department.count({ where: { id: { in: input.departmentIds }, active: true } });
    if (activeDepartments !== new Set(input.departmentIds).size) throw new RuleError('Selecciona áreas activas.');
    if (input.userId) {
      const linked = await tx.user.findFirst({ where: { id: input.userId, active: true, deletedAt: null, hiddenFromSelectors: false, role: { operational: true } } });
      if (!linked || (!scheduleAllowed(user, 'schedule.configure') && (!linked.departmentId || !input.departmentIds.includes(linked.departmentId)))) throw new RuleError('La cuenta debe estar activa y pertenecer al alcance autorizado.');
    }
    if (existing) {
      if (existing.userId && existing.userId !== (input.userId || null) && await tx.scheduleSlot.count({ where: { collaboratorId: existing.id } })) throw new RuleError('La cuenta vinculada tiene historial de horarios. No se reemplaza por la cuenta de otra persona.');
      const future = await tx.scheduleSlot.findFirst({ where: { collaboratorId: existing.id, cancelledAt: null, OR: [{ endAt: { gt: new Date() } }, { date: { gte: hotelCalendarDate() }, kind: { not: 'TURNO' } }] }, include: { plan: true } });
      if (future && (!input.active || !input.departmentIds.includes(future.plan.departmentId) || existing.functionName !== input.functionName || existing.userId !== (input.userId || null) || existing.minRestMinutes !== input.minRestMinutes)) throw new RuleError('Revisa las asignaciones futuras antes de desactivar, retirar áreas o cambiar función, cuenta o descanso mínimo.');
      const conflicting = await tx.scheduleSlot.findFirst({ where: { collaboratorId: existing.id, cancelledAt: null, plan: { departmentId: { notIn: input.departmentIds } }, date: { gte: hotelCalendarDate() } } });
      if (conflicting) throw new RuleError('Hay asignaciones futuras en un área que intentas retirar.');
    }
    const data = { employeeCode: input.employeeCode, name: input.name, functionName: input.functionName, userId: input.userId || null, active: input.active, weeklyMinutes: input.weeklyMinutes || null, minRestMinutes: input.minRestMinutes };
    const saved = existing ? await tx.scheduleCollaborator.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await tx.scheduleCollaborator.create({ data });
    await tx.scheduleMembership.updateMany({ where: { collaboratorId: saved.id, departmentId: { notIn: input.departmentIds } }, data: { active: false } });
    for (const departmentId of input.departmentIds) await tx.scheduleMembership.upsert({ where: { collaboratorId_departmentId: { collaboratorId: saved.id, departmentId } }, create: { collaboratorId: saved.id, departmentId }, update: { active: true } });
    for (const area of areas) await scheduleCatalogAudit(tx, user, area, `Colaborador ${saved.employeeCode}: ${existing ? 'actualizado' : 'creado'}`, { id: saved.id, ...data, departmentIds: input.departmentIds });
    return saved;
  });
}
export async function saveScheduleTemplate(user: CurrentUser, raw: z.input<typeof templateSchema>) {
  const input = templateSchema.parse(raw); await assertScheduleArea(user, input.departmentId, 'schedule.catalog.manage');
  try { templateWindow('2026-10-01', input); } catch (e) { throw new RuleError((e as Error).message); }
  return prisma.$transaction(async (tx) => {
    await lockScheduleAreas(tx, [input.departmentId]);
    const latest = await tx.scheduleTemplate.findFirst({ where: { departmentId: input.departmentId, code: input.code }, orderBy: { revision: 'desc' } });
    await tx.scheduleTemplate.updateMany({ where: { departmentId: input.departmentId, code: input.code, active: true }, data: { active: false } });
    const template = await tx.scheduleTemplate.create({ data: { ...input, breakStartTime: input.breakMinutes ? input.breakStartTime : null, revision: (latest?.revision ?? 0) + 1 } });
    await scheduleCatalogAudit(tx, user, input.departmentId, `Plantilla ${input.code} · revisión ${template.revision}`, { template }); return template;
  });
}
export const coverageSchema = z.object({ id: z.string().max(100).optional(), departmentId: scheduleId, name: z.string().trim().min(2).max(100), functionName: z.string().trim().max(100).optional().default(''), weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7), startTime: scheduleTime, endTime: scheduleTime, crossesMidnight: z.boolean(), minimum: z.coerce.number().int().min(1).max(100), active: z.boolean().default(true) });
export async function saveScheduleCoverage(user: CurrentUser, raw: z.input<typeof coverageSchema>) {
  const input = coverageSchema.parse(raw); await assertScheduleArea(user, input.departmentId, 'schedule.catalog.manage');
  templateSchema.parse({ ...input, code: 'VALIDAR', label: input.name, breakMinutes: 0, breakPaid: false });
  return prisma.$transaction(async (tx) => {
    await lockScheduleAreas(tx, [input.departmentId]);
    if (input.id && !await tx.scheduleCoverageRule.findFirst({ where: { id: input.id, departmentId: input.departmentId } })) throw new NotFoundError();
    const { id, ...values } = input; const data = { ...values, functionName: input.functionName || null, weekdays: [...new Set(input.weekdays)] };
    const result = id ? await tx.scheduleCoverageRule.update({ where: { id }, data }) : await tx.scheduleCoverageRule.create({ data });
    await scheduleCatalogAudit(tx, user, input.departmentId, `Cobertura mínima: ${input.name}`, { result }); return result;
  });
}
export async function saveScheduleGrant(user: CurrentUser, userId: string, departmentId: string, enabled: boolean) {
  assertSchedulePermission(user, 'schedule.configure'); scheduleId.parse(userId); scheduleId.parse(departmentId);
  return prisma.$transaction(async (tx) => {
    if (enabled) await tx.scheduleAreaGrant.upsert({ where: { userId_departmentId: { userId, departmentId } }, create: { userId, departmentId }, update: {} });
    else await tx.scheduleAreaGrant.deleteMany({ where: { userId, departmentId } });
    await scheduleCatalogAudit(tx, user, departmentId, 'Alcance de horarios actualizado', { userId, departmentId, enabled });
  });
}
export async function saveScheduleHoliday(user: CurrentUser, raw: unknown) {
  assertSchedulePermission(user, 'schedule.configure');
  const input = z.object({ date: scheduleDate, name: z.string().trim().min(2).max(160), source: z.string().trim().min(3).max(1000), active: z.boolean() }).parse(raw);
  return prisma.$transaction(async (tx) => {
    const saved = await tx.scheduleHoliday.upsert({ where: { date: new Date(`${input.date}T00:00:00Z`) }, create: { ...input, date: new Date(`${input.date}T00:00:00Z`) }, update: { name: input.name, source: input.source, active: input.active } });
    await tx.auditLog.create({ data: { entity: 'ScheduleHoliday', entityId: saved.id, action: 'EDITAR', userId: user.id, sessionId: user.sessionId, summary: `Feriado ${input.date}: ${input.name}`, after: input } }); return saved;
  });
}
export async function getScheduleCatalog(user: CurrentUser, departmentId: string, configurationOnly = false) {
  await assertScheduleArea(user, departmentId, configurationOnly ? 'schedule.configure' : 'schedule.catalog.manage');
  const areas = await scheduleAreaIds(user);
  const [collaborators, templates, coverage, accounts, grants, holidays] = await Promise.all([
    configurationOnly ? Promise.resolve([]) : prisma.scheduleCollaborator.findMany({ where: { memberships: { some: { departmentId } } }, include: { memberships: true }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.scheduleTemplate.findMany({ where: { departmentId }, orderBy: [{ code: 'asc' }, { revision: 'desc' }], take: 500 }),
    prisma.scheduleCoverageRule.findMany({ where: { departmentId }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { active: true, deletedAt: null, hiddenFromSelectors: false, role: { operational: true }, ...(areas ? { departmentId: { in: areas } } : {}) }, select: { id: true, name: true, departmentId: true }, orderBy: { name: 'asc' }, take: 500 }),
    scheduleAllowed(user, 'schedule.configure') ? prisma.scheduleAreaGrant.findMany({ include: { user: { select: { name: true } }, department: { select: { name: true } } } }) : Promise.resolve([]),
    scheduleAllowed(user, 'schedule.configure') ? prisma.scheduleHoliday.findMany({ orderBy: { date: 'asc' }, take: 100 }) : Promise.resolve([]),
  ]);
  return { collaborators, templates, coverage, accounts, grants, holidays };
}
