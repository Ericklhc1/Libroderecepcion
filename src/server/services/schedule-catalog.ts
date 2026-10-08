import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError, NotFoundError } from '@/server/errors';
import { scheduleDate, scheduleId, scheduleTime, templateSchema, templateWindow, scheduleAllowed } from '@/domain/schedule';
import { ongoingOrFutureScheduleSlots } from './schedule-admin-safety';
import { eligibleScheduleAccountWhere, eligibleScheduleCollaboratorWhere } from './schedule-eligibility';
import { assertScheduleArea, assertSchedulePermission, scheduleAreaIds, type ScheduleClient } from './schedule-access';

export async function lockScheduleAreas(tx: ScheduleClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${id} FOR UPDATE`;
}
export async function scheduleCatalogAudit(tx: ScheduleClient, user: CurrentUser, departmentId: string, summary: string, after: object) {
  await tx.auditLog.create({ data: { entity: 'ScheduleCatalog', entityId: departmentId, action: 'EDITAR', summary, userId: user.id, sessionId: user.sessionId, after: JSON.parse(JSON.stringify(after)) } });
}
export const collaboratorSchema = z.object({
  id: z.string().max(100).optional(), version: z.coerce.number().int().min(0).optional(),
  employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,32}$/).optional(),
  name: z.string().optional(), functionName: z.string().trim().min(2).max(100).optional(),
  userId: scheduleId, departmentIds: z.array(scheduleId).min(1).max(20),
  active: z.boolean().optional(), weeklyHours: z.coerce.number().min(0).max(168).optional(),
});
export async function saveScheduleCollaborator(user: CurrentUser, raw: z.input<typeof collaboratorSchema>) {
  assertSchedulePermission(user, 'schedule.catalog.manage'); const input = collaboratorSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    // Share the substitution reader's User → Department → collaborator order.
    // NO KEY UPDATE permits notification/audit FK KEY SHARE in schedule writers.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR NO KEY UPDATE`;
    const observed = input.id ? await tx.scheduleCollaborator.findUnique({ where: { id: input.id }, include: { memberships: true } }) : await tx.scheduleCollaborator.findUnique({ where: { userId: input.userId }, include: { memberships: true } });
    const guardedAreas = input.id ? [...new Set([...input.departmentIds, ...(observed?.memberships.map(m => m.departmentId) ?? [])])] : input.departmentIds;
    for (const area of guardedAreas) await assertScheduleArea(user, area, 'schedule.catalog.manage', tx);
    await lockScheduleAreas(tx, guardedAreas);
    const account = await tx.user.findUnique({ where: { id: input.userId }, include: { role: { select: { name: true } } } });
    if (!account) throw new RuleError('Selecciona un usuario existente.');
    const existing = input.id ? await tx.scheduleCollaborator.findUnique({ where: { id: input.id }, include: { memberships: true } }) : await tx.scheduleCollaborator.findUnique({ where: { userId: account.id }, include: { memberships: true } });
    if (!(input.id && input.active === false) && !await tx.user.findFirst({ where: { id: account.id, ...eligibleScheduleAccountWhere }, select: { id: true } })) throw new RuleError('Selecciona un usuario activo, visible y operativo. Puedes deshabilitar su perfil después de resolver sus asignaciones vigentes o futuras.');
    if (input.id && !existing) throw new NotFoundError();
    if (input.id && !existing?.userId && await tx.scheduleCollaborator.findUnique({ where: { userId: account.id } })) throw new RuleError('Este usuario ya tiene un perfil de colaborador. Abre su referencia existente.');
    if (existing?.userId && existing.userId !== account.id) throw new RuleError('No se puede sustituir la identidad de un colaborador.');
    if (input.id && input.version !== existing?.version) throw new RuleError('El colaborador cambió. Actualiza antes de guardar.');
    // A newly added membership after our first read requires a fresh review of
    // global edits; never lock a newly discovered area out of order.
    if (input.id && existing?.memberships.some(m => !guardedAreas.includes(m.departmentId))) throw new RuleError('Las áreas del colaborador cambiaron. Actualiza antes de guardar.');
    if (existing) {
      await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id" = ${existing.id} FOR UPDATE`;
      const current = await tx.scheduleCollaborator.findUniqueOrThrow({ where: { id: existing.id } });
      if (current.version !== existing.version) throw new RuleError('El colaborador cambió. Actualiza antes de guardar.');
    }
    if (await tx.department.count({ where: { id: { in: input.departmentIds }, active: true } }) !== new Set(input.departmentIds).size) throw new RuleError('Selecciona áreas activas.');
    const editing = !!input.id;
    const data = {
      employeeCode: existing?.employeeCode ?? input.employeeCode ?? `USR_${account.id}`.toUpperCase(),
      name: account.name, functionName: editing ? input.functionName ?? existing!.functionName : existing?.functionName ?? input.functionName ?? account.role.name,
      userId: account.id, active: editing ? input.active ?? existing!.active : existing?.active ?? true,
      weeklyMinutes: editing || !existing ? (input.weeklyHours === undefined ? existing?.weeklyMinutes ?? null : Math.round(input.weeklyHours * 60) || null) : existing.weeklyMinutes,
      minRestMinutes: 0,
    };
    if (existing && editing && (!data.active || data.functionName !== existing.functionName) && await tx.scheduleSlot.count({ where: { collaboratorId: existing.id, ...ongoingOrFutureScheduleSlots() } })) throw new RuleError('Revisa las asignaciones vigentes o futuras antes de deshabilitar el perfil global o cambiar su función. Reasigna o cancela las futuras y espera a que finalicen las jornadas iniciadas.');
    const saved = existing ? await tx.scheduleCollaborator.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await tx.scheduleCollaborator.create({ data });
    if (!editing) for (const departmentId of input.departmentIds) await tx.scheduleMembership.upsert({ where: { collaboratorId_departmentId: { collaboratorId: saved.id, departmentId } }, create: { collaboratorId: saved.id, departmentId }, update: { active: true } });
    for (const area of input.departmentIds) await scheduleCatalogAudit(tx, user, area, `Usuario ${account.name}: ${existing ? 'actualizado' : 'incorporado'}`, { id: saved.id, ...data, departmentIds: input.departmentIds });
    return saved;
  });
}
/** Remove only this area's membership. Account and global profile stay intact. */
export async function removeScheduleMembership(user: CurrentUser, raw: unknown) {
  const input = z.object({ collaboratorId: scheduleId, departmentId: scheduleId, version: z.coerce.number().int().min(0), reason: z.string().trim().min(3).max(1000) }).parse(raw);
  await assertScheduleArea(user, input.departmentId, 'schedule.catalog.manage');
  return prisma.$transaction(async tx => {
    const observed = await tx.scheduleCollaborator.findUnique({ where: { id: input.collaboratorId }, select: { userId: true } });
    if (!observed) throw new NotFoundError();
    if (observed.userId) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${observed.userId} FOR NO KEY UPDATE`;
    await lockScheduleAreas(tx, [input.departmentId]);
    await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id" = ${input.collaboratorId} FOR UPDATE`;
    await assertScheduleArea(user, input.departmentId, 'schedule.catalog.manage', tx);
    const person = await tx.scheduleCollaborator.findUniqueOrThrow({ where: { id: input.collaboratorId }, include: { memberships: true } });
    if (person.version !== input.version) throw new RuleError('El colaborador cambió. Actualiza antes de retirar su pertenencia.');
    const membership = person.memberships.find(m => m.departmentId === input.departmentId && m.active);
    if (!membership) throw new RuleError('Esta pertenencia ya está retirada. Actualiza el listado.');
    if (await tx.scheduleSlot.count({ where: { collaboratorId: person.id, plan: { departmentId: input.departmentId }, ...ongoingOrFutureScheduleSlots() } })) throw new RuleError('Reasigna o cancela las asignaciones futuras de esta área y espera a que finalicen las jornadas iniciadas antes de retirar la pertenencia.');
    await tx.scheduleMembership.update({ where: { collaboratorId_departmentId: { collaboratorId: person.id, departmentId: input.departmentId } }, data: { active: false } });
    await tx.scheduleCollaborator.update({ where: { id: person.id }, data: { version: { increment: 1 } } });
    await tx.auditLog.create({ data: { entity: 'ScheduleCatalog', entityId: input.departmentId, action: 'EDITAR', summary: `Pertenencia al área retirada: ${person.name}`, reason: input.reason, userId: user.id, sessionId: user.sessionId, before: { collaboratorId: person.id, departmentId: input.departmentId, active: true }, after: { collaboratorId: person.id, departmentId: input.departmentId, active: false, accountUnchanged: true } } });
  });
}
export async function saveScheduleTemplate(user: CurrentUser, raw: z.input<typeof templateSchema>) {
  const input = templateSchema.parse({ ...raw, breakMinutes: 0, breakStartTime: '', breakPaid: false }); await assertScheduleArea(user, input.departmentId, 'schedule.catalog.manage');
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
    // Shares the handoff reader's User boundary, including a grant not yet present.
    // NO KEY UPDATE still permits actor/recipient FK KEY SHARE in reciprocal changes.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR NO KEY UPDATE`;
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
    configurationOnly ? Promise.resolve([]) : prisma.scheduleCollaborator.findMany({ where: { memberships: { some: { departmentId } } }, include: { memberships: { include: { department: { select: { name: true } } } }, user: { select: { name: true, username: true, active: true, hiddenFromSelectors: true, deletedAt: true, departmentId: true, department: { select: { name: true } }, role: { select: { operational: true } } } } }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.scheduleTemplate.findMany({ where: { departmentId }, orderBy: [{ code: 'asc' }, { revision: 'desc' }], take: 500 }),
    prisma.scheduleCoverageRule.findMany({ where: { departmentId }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { ...eligibleScheduleAccountWhere, ...(areas ? { departmentId: { in: areas } } : {}) }, select: { id: true, name: true, username: true, departmentId: true }, orderBy: { name: 'asc' }, take: 500 }),
    scheduleAllowed(user, 'schedule.configure') ? prisma.scheduleAreaGrant.findMany({ include: { user: { select: { name: true } }, department: { select: { name: true } } } }) : Promise.resolve([]),
    scheduleAllowed(user, 'schedule.configure') ? prisma.scheduleHoliday.findMany({ orderBy: { date: 'asc' }, take: 100 }) : Promise.resolve([]),
  ]);
  const eligible = new Set((await prisma.scheduleCollaborator.findMany({ where: eligibleScheduleCollaboratorWhere(departmentId), select: { id: true } })).map(p => p.id));
  return { collaborators: collaborators.map(p => ({ ...p, name: p.user?.name ?? p.name, username: p.user?.username ?? null, eligible: eligible.has(p.id) })), templates, coverage, accounts, grants, holidays };
}
