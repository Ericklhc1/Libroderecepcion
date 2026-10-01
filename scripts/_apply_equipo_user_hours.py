from pathlib import Path
import json
import re

ROOT = Path('.')

def replace(path, before, after, count=1):
    p = ROOT / path
    text = p.read_text()
    actual = text.count(before)
    if actual != count:
        raise RuntimeError(f'{path}: expected {count} matches, found {actual}: {before[:100]}')
    p.write_text(text.replace(before, after))

def section(path, start, end, content):
    p = ROOT / path
    text = p.read_text()
    if text.count(start) != 1 or text.count(end) != 1:
        raise RuntimeError(f'{path}: section boundary mismatch')
    a, b = text.index(start), text.index(end)
    if b <= a:
        raise RuntimeError(f'{path}: reversed section')
    p.write_text(text[:a] + content.rstrip() + '\n' + text[b:])

# A scheduling profile is a one-to-one extension of User, never a second identity.
Path('src/server/services/schedule-users.ts').write_text('''import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { scheduleAllowed } from '@/domain/schedule';
import { assertScheduleArea } from './schedule-access';

export const scheduleEligibleUser = { active: true, deletedAt: null, hiddenFromSelectors: false } satisfies Prisma.UserWhereInput;
export const scheduleIdentitySelect = { name: true, active: true, deletedAt: true, hiddenFromSelectors: true, role: { select: { name: true } } } as const;
type Identity = { name: string; active: boolean; deletedAt: Date | null; hiddenFromSelectors: boolean; role: { name: string } };
export function schedulePerson<T extends { name: string; functionName: string; active: boolean; user: Identity | null }>(row: T) {
  const { user, ...profile } = row;
  return { ...profile, name: user?.name ?? row.name, functionName: user?.role.name ?? row.functionName, active: !!user && user.active && !user.deletedAt && !user.hiddenFromSelectors };
}
export function scheduleEmployeeCode(userId: string) {
  return `USR_${createHash('sha256').update(userId).digest('hex').slice(0, 24).toUpperCase()}`;
}

/** Provision only missing scheduling metadata for users in their primary area.
 * Called only by an authorized manager. Reads by staff never provision accounts,
 * change permissions, create assignments, or touch Reception/Cash.
 * Unlinked legacy names are not guessed: an administrator links them explicitly.
 */
export async function ensureScheduleUsers(actor: CurrentUser, departmentId: string) {
  const permission = scheduleAllowed(actor, 'schedule.catalog.manage') ? 'schedule.catalog.manage' : 'schedule.manage';
  await assertScheduleArea(actor, departmentId, permission);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${departmentId} FOR UPDATE`;
    const users = await tx.user.findMany({ where: { ...scheduleEligibleUser, departmentId, department: { active: true } }, select: { id: true, name: true, role: { select: { name: true } } }, orderBy: { id: 'asc' }, take: 500 });
    const profiles = await tx.scheduleCollaborator.findMany({ where: { OR: [{ userId: { in: users.map((u) => u.id) } }, { userId: null, memberships: { some: { departmentId } } }] }, include: { memberships: true } });
    const byUser = new Map(profiles.filter((p) => p.userId).map((p) => [p.userId!, p]));
    const key = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('es');
    const legacyNames = new Set(profiles.filter((p) => !p.userId).map((p) => key(p.name)));
    for (const user of users) {
      const current = byUser.get(user.id);
      if (!current && legacyNames.has(key(user.name))) continue;
      const hasArea = current?.memberships.some((m) => m.departmentId === departmentId && m.active);
      if (current && hasArea) continue;
      const profile = current ?? await tx.scheduleCollaborator.upsert({ where: { userId: user.id }, create: { userId: user.id, employeeCode: scheduleEmployeeCode(user.id), name: user.name, functionName: user.role.name, active: true }, update: {} });
      await tx.scheduleMembership.upsert({ where: { collaboratorId_departmentId: { collaboratorId: profile.id, departmentId } }, create: { collaboratorId: profile.id, departmentId }, update: { active: true } });
      await tx.auditLog.create({ data: { entity: 'ScheduleCatalog', entityId: departmentId, action: 'EDITAR', userId: actor.id, sessionId: actor.sessionId, summary: 'Usuario existente disponible en su malla de área', after: { userId: user.id, profileId: profile.id, departmentId } } });
    }
  }, { maxWait: 10000, timeout: 30000 });
}
''')

catalog = 'src/server/services/schedule-catalog.ts'
replace(catalog, "import { hotelCalendarDate } from '@/domain/time';", "import { hotelCalendarDate } from '@/domain/time';\nimport { weeklyHoursSchema, weeklyHoursToMinutes } from '@/domain/schedule';\nimport { ensureScheduleUsers, scheduleEligibleUser, scheduleIdentitySelect, schedulePerson, scheduleEmployeeCode } from './schedule-users';")
section(catalog, 'export const collaboratorSchema =', 'export async function saveScheduleTemplate', '''export const collaboratorSchema = z.object({
  id: z.string().max(100).optional(), version: z.coerce.number().int().min(0).default(0),
  userId: scheduleId, departmentIds: z.array(scheduleId).min(1).max(20),
  employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,32}$/).optional(),
  weeklyHours: weeklyHoursSchema.optional(),
});
export async function saveScheduleCollaborator(user: CurrentUser, raw: unknown) {
  assertSchedulePermission(user, 'schedule.catalog.manage'); const input = collaboratorSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const existing = input.id
      ? await tx.scheduleCollaborator.findUnique({ where: { id: input.id }, include: { memberships: true } })
      : await tx.scheduleCollaborator.findUnique({ where: { userId: input.userId }, include: { memberships: true } });
    if (input.id && !existing) throw new NotFoundError();
    if (existing?.userId && existing.userId !== input.userId) throw new RuleError('El colaborador es el usuario. No se puede sustituir su identidad por otra persona.');
    const areas = [...new Set([...input.departmentIds, ...(existing?.memberships.map((m) => m.departmentId) ?? [])])];
    for (const area of areas) await assertScheduleArea(user, area, 'schedule.catalog.manage', tx);
    await lockScheduleAreas(tx, areas);
    if (existing) {
      await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id" = ${existing.id} FOR UPDATE`;
      const current = await tx.scheduleCollaborator.findUniqueOrThrow({ where: { id: existing.id } });
      if (input.id && current.version !== input.version) throw new RuleError('El usuario cambió. Actualiza antes de guardar.');
    }
    const linked = await tx.user.findFirst({ where: { id: input.userId, ...scheduleEligibleUser }, include: { role: { select: { name: true } } } });
    if (!linked || (!scheduleAllowed(user, 'schedule.configure') && (!linked.departmentId || !input.departmentIds.includes(linked.departmentId)))) throw new RuleError('Selecciona un usuario activo y visible del alcance autorizado.');
    const duplicate = await tx.scheduleCollaborator.findUnique({ where: { userId: linked.id } });
    if (duplicate && duplicate.id !== existing?.id) throw new RuleError('Este usuario ya tiene su perfil de horarios. No se puede duplicar.');
    const activeDepartments = await tx.department.count({ where: { id: { in: input.departmentIds }, active: true } });
    if (activeDepartments !== new Set(input.departmentIds).size) throw new RuleError('Selecciona áreas activas.');
    if (existing) {
      const conflicting = await tx.scheduleSlot.findFirst({ where: { collaboratorId: existing.id, cancelledAt: null, plan: { departmentId: { notIn: input.departmentIds } }, OR: [{ endAt: { gt: new Date() } }, { date: { gte: hotelCalendarDate() }, kind: { not: 'TURNO' } }] } });
      if (conflicting) throw new RuleError('Hay asignaciones futuras en un área que intentas retirar.');
    }
    const weeklyMinutes = input.weeklyHours === undefined ? existing?.weeklyMinutes ?? null : weeklyHoursToMinutes(input.weeklyHours) || null;
    const data = { employeeCode: existing?.employeeCode ?? input.employeeCode ?? scheduleEmployeeCode(linked.id), name: linked.name, functionName: linked.role.name, userId: linked.id, active: true, weeklyMinutes, minRestMinutes: 0 };
    const saved = existing ? await tx.scheduleCollaborator.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await tx.scheduleCollaborator.create({ data });
    await tx.scheduleMembership.updateMany({ where: { collaboratorId: saved.id, departmentId: { notIn: input.departmentIds } }, data: { active: false } });
    for (const departmentId of [...new Set(input.departmentIds)]) await tx.scheduleMembership.upsert({ where: { collaboratorId_departmentId: { collaboratorId: saved.id, departmentId } }, create: { collaboratorId: saved.id, departmentId }, update: { active: true } });
    for (const area of areas) await scheduleCatalogAudit(tx, user, area, 'Datos de planificación del usuario actualizados', { id: saved.id, userId: linked.id, weeklyHours: weeklyMinutes === null ? null : weeklyMinutes / 60, departmentIds: input.departmentIds });
    return saved;
  });
}
''')
replace(catalog, "  const areas = await scheduleAreaIds(user);", "  const areas = await scheduleAreaIds(user);\n  if (!configurationOnly) await ensureScheduleUsers(user, departmentId);")
replace(catalog, "include: { memberships: true }, orderBy: { name: 'asc' }, take: 500 }),", "include: { memberships: true, user: { select: scheduleIdentitySelect } }, orderBy: { name: 'asc' }, take: 500 }).then((rows) => rows.map(schedulePerson)),")
replace(catalog, "active: true, deletedAt: null, hiddenFromSelectors: false, role: { operational: true }, ...(areas", "...scheduleEligibleUser, ...(areas")

# Hours are the public unit. Minutes remain an internal, backwards-compatible storage unit.
domain = 'src/domain/schedule.ts'
replace(domain, "export const scheduleId = z.string().min(1).max(100);", '''export const scheduleId = z.string().min(1).max(100);
export const weeklyHoursSchema = z.preprocess((value) => typeof value === 'string' ? value.trim().replace(',', '.') : value,
  z.coerce.number().finite().min(0).max(168).refine((hours) => Math.abs(hours * 60 - Math.round(hours * 60)) < 0.000001, 'Usa horas enteras o fracciones como 42,5.'));
export function weeklyHoursToMinutes(hours: number): number { return Math.round(weeklyHoursSchema.parse(hours) * 60); }
export function formatScheduleHours(minutes: number): string { return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(minutes / 60)} h`; }
''')
replace(domain, "breakStartTime: z.string().optional().default(''), breakMinutes: z.coerce.number().int().min(0).max(180).default(0), breakPaid: z.boolean().default(false)", "breakStartTime: z.literal('').optional().default(''), breakMinutes: z.literal(0).optional().default(0), breakPaid: z.literal(false).optional().default(false)")
replace(domain, "  if (s.breakMinutes > 0 && !scheduleTime.safeParse(s.breakStartTime).success) ctx.addIssue({ code: 'custom', message: 'Indica el inicio de colación para medir cobertura.', path: ['breakStartTime'] });\n", '')
section(domain, '  let breakStartAt: Date | null = null;', 'export type IntervalSlot', '''  // Retain compatibility with historical snapshots, without applying breaks.
  return { startAt, endAt, breakStartAt: null as Date | null, breakEndAt: null as Date | null };
}
''')
replace(domain, " && !(s.breakStartAt && s.breakEndAt && s.breakStartAt <= now && s.breakEndAt > now)", '')
replace(domain, "  const pause = !s.breakPaid && s.breakStartAt && s.breakEndAt ? overlap(a, b, s.breakStartAt.getTime(), s.breakEndAt.getTime()) : 0;\n  return Math.round((elapsed - pause) / 60000);", "  return Math.round(elapsed / 60000);")
replace(domain, "[s.startAt!, s.endAt!, s.breakStartAt, s.breakEndAt]", "[s.startAt!, s.endAt!]")
replace(domain, " && !(s.breakStartAt && s.breakEndAt && s.breakStartAt.getTime() < b && s.breakEndAt.getTime() > a)", '')

service = 'src/server/services/schedules.ts'
replace(service, "import { lockScheduleAreas } from './schedule-catalog';", "import { lockScheduleAreas } from './schedule-catalog';\nimport { ensureScheduleUsers, scheduleEligibleUser, scheduleIdentitySelect, schedulePerson } from './schedule-users';")
replace(service, "      if (gap < person.minRestMinutes && later.startAt! > new Date()) rule(`${person.name} no cumple el descanso mínimo configurado de ${person.minRestMinutes / 60} horas.`);\n", '')
replace(service, "id: input.collaboratorId, active: true, memberships:", "id: input.collaboratorId, user: { is: scheduleEligibleUser }, memberships:")
replace(service, "id: collaboratorId, active: true, memberships:", "id: collaboratorId, user: { is: scheduleEligibleUser }, memberships:")
replace(service, "breakMinutes: template.breakMinutes, breakPaid: template.breakPaid", "breakMinutes: 0, breakPaid: false")
replace(service, "...values, ...clocks, baseEndAt: clocks.endAt", "...values, ...clocks, breakMinutes: 0, breakPaid: false, baseEndAt: clocks.endAt")
replace(service, "    if (!slots.length) rule('Agrega asignaciones antes de publicar.');", "    if (!slots.length) rule('Agrega asignaciones antes de publicar.');\n    const available = await tx.scheduleCollaborator.count({ where: { id: { in: [...new Set(slots.map((s) => s.collaboratorId))] }, user: { is: scheduleEligibleUser } } });\n    if (available !== new Set(slots.map((s) => s.collaboratorId)).size) rule('Revisa las asignaciones de usuarios inactivos o sin vínculo antes de publicar.');")
replace(service, "  const collaborators = await prisma.scheduleCollaborator.findMany({ where: { ...(team ? {} : { userId: user.id }), memberships: { some: { departmentId, active: true } }, ...(canManage ? { active: true } : {}) }, orderBy: { name: 'asc' }, take: 500 });", "  if (canManage) await ensureScheduleUsers(user, departmentId);\n  const collaborators = await prisma.scheduleCollaborator.findMany({ where: { ...(team ? {} : { userId: user.id }), memberships: { some: { departmentId, active: true } }, ...(canManage ? { user: { is: scheduleEligibleUser } } : {}) }, include: { user: { select: scheduleIdentitySelect } }, orderBy: { name: 'asc' }, take: 500 }).then((rows) => rows.map(schedulePerson));")
replace(service, "id: true, name: true, employeeCode: true, weeklyMinutes: true, userId: true", "id: true, name: true, employeeCode: true, weeklyMinutes: true, userId: true, user: { select: { name: true } }")
replace(service, "return { plans, selected, collaborators, templates, slots, contextSlots, rules, gaps:", "return { plans, selected, collaborators, templates, slots: slots.map((s) => ({ ...s, collaborator: { ...s.collaborator, name: s.collaborator.user?.name ?? s.collaborator.name } })), contextSlots, rules, gaps:")

forms = 'src/components/schedule/catalog-forms.tsx'
section(forms, 'export function ScheduleCollaboratorForm', 'export function ScheduleCoverageForm', '''export function ScheduleCollaboratorForm({ areas, accounts, departmentId, person, editable = true }: { areas: Area[]; accounts: Account[]; departmentId: string; person?: CatalogPerson; editable?: boolean }) {
  if (!editable) return <p className="text-xs text-slate-500">Perfil compartido con otra área: solicita al administrador su modificación.</p>;
  if (person?.userId && !person.active) return <p className="text-xs text-slate-500">Usuario inactivo u oculto. Su historial se conserva; no admite nuevas asignaciones.</p>;
  return <Dialog trigger={person ? person.userId ? 'Editar planificación' : 'Vincular usuario' : 'Añadir usuario al área'} triggerVariant={person ? 'secondary' : 'gold'} triggerSize={person ? 'sm' : 'md'} title="Planificación del usuario" description="La persona se crea una sola vez en Usuarios. Aquí sólo se definen sus áreas y horas semanales; no se crea otra cuenta ni otro colaborador.">
    <ActionForm action={saveScheduleCollaboratorAction} closeOnSuccess refreshOnSuccess>
      {person && <input type="hidden" name="id" value={person.id} />}<input type="hidden" name="version" value={person?.version ?? 0} />
      {person?.userId ? <><input type="hidden" name="userId" value={person.userId} /><p className="rounded bg-slate-50 p-3 text-sm"><strong>{person.name}</strong><br />{person.functionName}</p></> : <Field label="Usuario existente" name="userId" hint="Selecciona una cuenta ya creada. El nombre, rol y estado se toman de Usuarios."><Select name="userId" required defaultValue="" options={[{ value: '', label: 'Seleccionar usuario…' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} /></Field>}
      <fieldset><legend className="mb-2 text-sm font-medium text-slate-700">Áreas donde puede trabajar</legend><div className="grid gap-2 sm:grid-cols-2">{areas.map((area) => <label key={area.id} className="flex gap-2 text-sm"><input type="checkbox" name="departmentIds" value={area.id} defaultChecked={person ? person.memberships.some((m) => m.active && m.departmentId === area.id) : area.id === departmentId} />{area.name}</label>)}</div></fieldset>
      <Field label="Horas semanales de referencia" name="weeklyHours" hint="Ejemplo: 42 o 42,5 horas. 0 = sin referencia. No incluye descuentos ni controles de descanso."><Input name="weeklyHours" type="number" min={0} max={168} step="any" required defaultValue={(person?.weeklyMinutes ?? 0) / 60} /></Field>
      <SubmitButton>Guardar planificación</SubmitButton>
    </ActionForm>
  </Dialog>;
}
export function ScheduleTemplateForm({ departmentId, template }: { departmentId: string; template?: { code: string; label: string; startTime: string; endTime: string; crossesMidnight: boolean; breakStartTime: string | null; breakMinutes: number; breakPaid: boolean } }) {
  return <Dialog trigger={template ? 'Crear revisión' : 'Crear plantilla'} triggerVariant={template ? 'secondary' : 'gold'} triggerSize={template ? 'sm' : 'md'} title={template ? `Nueva revisión de ${template.code}` : 'Crear plantilla del área'} description="Una revisión nueva se utiliza para asignaciones futuras. Los horarios ya guardados conservan su código y horas originales.">
    <ActionForm action={saveScheduleTemplateAction} closeOnSuccess refreshOnSuccess><input type="hidden" name="departmentId" value={departmentId} /><div className="grid gap-3 sm:grid-cols-2"><Field label="Código" name="code"><Input name="code" required maxLength={16} defaultValue={template?.code} readOnly={!!template} placeholder="RD01" /></Field><Field label="Descripción" name="label"><Input name="label" required maxLength={100} defaultValue={template?.label} /></Field><Field label="Inicio" name="startTime"><Input type="time" name="startTime" required defaultValue={template?.startTime} /></Field><Field label="Término" name="endTime"><Input type="time" name="endTime" required defaultValue={template?.endTime} /></Field></div><label className="flex gap-2 text-sm"><input type="checkbox" name="crossesMidnight" defaultChecked={template?.crossesMidnight} />Termina al día siguiente</label><p className="text-xs text-slate-600">Las horas programadas corresponden al intervalo completo entre inicio y término. Este módulo no gestiona descansos ni colaciones.</p><SubmitButton>Guardar plantilla</SubmitButton></ActionForm>
  </Dialog>;
}
''')

page = 'src/app/(app)/equipo/page.tsx'
replace(page, "plannedMinutes, scheduleAllowed }", "plannedMinutes, scheduleAllowed, formatScheduleHours }")
replace(page, "{ id, name, employeeCode, functionName, weeklyMinutes, userId }) => ({ id, name, employeeCode, functionName, weeklyMinutes, userId })", "{ id, name, employeeCode, functionName, weeklyMinutes, userId, active }) => ({ id, name, employeeCode, functionName, weeklyMinutes, userId, active })")
replace(page, 'La cobertura descuenta las colaciones y utiliza extras aprobados. No acredita presencia física.', 'La cobertura utiliza el intervalo programado completo y los extras aprobados. No descuenta descansos ni acredita presencia física.')
replace(page, 'Recepción incluye RD01, RD02 y RN01 según la glosa aportada. Configura sus colaciones antes de utilizarlas para evaluar horas y cobertura. No hay colaboradores ni jornadas cargados automáticamente.', 'Recepción incluye RD01, RD02 y RN01 según la glosa aportada. Los usuarios existentes están disponibles por área; las jornadas se programan explícitamente. Las horas no descuentan descansos.')
replace(page, " · colación {t.breakMinutes} min{t.breakStartTime ? ` desde ${t.breakStartTime}` : ''}", '')
replace(page, "{person.userId ? 'Cuenta vinculada' : 'Sin cuenta de acceso'}", "{person.userId ? 'Usuario del sistema' : 'Histórico pendiente de vincular'} · {person.weeklyMinutes ? `${formatScheduleHours(person.weeklyMinutes)} semanales` : 'Sin referencia semanal'}")
replace(page, 'Colaboradores del área</h2>', 'Usuarios del área</h2>')
replace(page, "'Aún no hay un colaborador vinculado a tu cuenta o un área habilitada para consultar.'", "'Aún no tienes un área habilitada o un horario publicado para consultar.'")

calendar = 'src/components/schedule/calendar.tsx'
replace(calendar, "datePlus, SLOT_LABELS, EXTRA_LABELS }", "datePlus, SLOT_LABELS, EXTRA_LABELS, formatScheduleHours }")
replace(calendar, "const hours = (minutes: number) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;", "const hours = formatScheduleHours;")
replace(calendar, "{selected.kind === 'TURNO' && <p>Colación: {selected.breakMinutes ? `${selected.breakMinutes} min · ${selected.breakPaid ? 'incluida' : 'descontada'} en horas programadas.` : 'Sin colación configurada.'}</p>}", '')
replace(calendar, 'pertenencia al área, solapamientos y descanso mínimo antes de guardar.', 'usuario activo, pertenencia al área y solapamientos antes de guardar.')
replace(calendar, 'Crea colaboradores del área para comenzar a programar.', 'Asigna el área a usuarios existentes o añádelos desde Usuarios del área para comenzar a programar.')
replace(calendar, "if (canManage && inPeriod) e.preventDefault();", "if (canManage && person.active !== false && inPeriod) e.preventDefault();")
replace(calendar, "if (slot && inPeriod && canChange(slot))", "if (slot && person.active !== false && inPeriod && canChange(slot))")
replace(calendar, "{canManage && inPeriod && <button", "{canManage && person.active !== false && inPeriod && <button")
replace(calendar, "options={people.map((p) =>", "options={people.filter((p) => p.active !== false).map((p) =>")
replace(calendar, "{person.name}</span><span", "{person.name}{person.active === false && ' · histórico'}</span><span")

slot_forms = 'src/components/schedule/schedule-forms.tsx'
replace(slot_forms, "weeklyMinutes: number | null; userId: string | null };", "weeklyMinutes: number | null; userId: string | null; active?: boolean };")
replace(slot_forms, "options={people.map((p) =>", "options={people.filter((p) => p.active !== false).map((p) =>")

# Regression fixtures now create genuine user identities, not unrelated people.
tests = 'tests/schedules.test.ts'
replace(tests, "saveScheduleCoverage, saveScheduleGrant }", "saveScheduleCoverage, saveScheduleGrant, getScheduleCatalog }")
replace(tests, "    const person = await saveScheduleCollaborator", "    await prisma.user.update({ where: { id: own.id }, data: { name: 'Colaborador Uno' } });\n    const second = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });\n    await prisma.user.update({ where: { id: second.id }, data: { name: 'Colaborador Dos' } });\n    const person = await saveScheduleCollaborator")
replace(tests, "employeeCode: 'TEST_COL002', name: 'Colaborador Dos', functionName: 'Recepcionista', departmentIds", "employeeCode: 'TEST_COL002', name: 'Colaborador Dos', functionName: 'Recepcionista', userId: second.id, departmentIds")
replace(tests, "registra colaboradores sin cuenta, mantiene área explícita y no crea un turno operativo", "usa usuarios existentes, mantiene área explícita y no crea un turno operativo")
replace(tests, ")).userId).toBeNull();", ")).userId).not.toBeNull();")
replace(tests, "expect((await getScheduleBoard(admin, area, planId)).collaborators).toHaveLength(2);", "expect((await getScheduleBoard(admin, area, planId)).collaborators.map((p) => p.id)).toEqual(expect.arrayContaining([a, b]));")
section(tests, "  it('exige descanso configurado", "  it('conserva snapshots", '''  it('ignora descanso mínimo heredado y conserva conflictos de Libre y ausencia', async () => {
    await prisma.scheduleCollaborator.update({ where: { id: a }, data: { minRestMinutes: 720 } });
    await add(a, '2090-10-03', night); await add(a, '2090-10-04', day);
    expect((await slot(a, '2090-10-04')).code).toBe('TEST_DIA');
    await expect(addScheduleSlot(admin, await mutation(), { collaboratorId: a, date: '2090-10-04', kind: 'LIBRE' })).rejects.toThrow();
    await expect(addScheduleSlot(admin, await mutation(), { collaboratorId: a, date: '2090-10-04', kind: 'VACACIONES' })).rejects.toThrow();
  });
''')
new_tests = '''
  it('rechaza personas sin usuario y nunca sustituye la identidad vinculada', async () => {
    const count = await prisma.scheduleCollaborator.count();
    await expect(saveScheduleCollaborator(admin, { name: 'Sin cuenta', departmentIds: [area], weeklyHours: 42 })).rejects.toThrow();
    const person = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    const otherPerson = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: b } });
    await expect(saveScheduleCollaborator(admin, { id: a, version: person.version, userId: otherPerson.userId, departmentIds: [area], weeklyHours: 42 })).rejects.toThrow('identidad');
    expect(await prisma.scheduleCollaborator.count()).toBe(count);
  });
  it('los usuarios del área aparecen sin alta duplicada y la sincronización es idempotente', async () => {
    const newcomer = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await prisma.user.update({ where: { id: newcomer.id }, data: { departmentId: area, name: 'Usuario ya existente' } });
    const boards = await Promise.all([getScheduleBoard(admin, area, planId), getScheduleBoard(admin, area, planId)]);
    for (const board of boards) expect(board.collaborators.some((p) => p.userId === newcomer.id)).toBe(true);
    expect(await prisma.scheduleCollaborator.count({ where: { userId: newcomer.id } })).toBe(1);
    const profile = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { userId: newcomer.id } });
    await add(profile.id); expect(await prisma.shift.count()).toBe(0);
  });
  it('guarda y vuelve a mostrar referencias semanales en horas, incluidas fracciones', async () => {
    const person = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    const saved = await saveScheduleCollaborator(admin, { id: a, version: person.version, userId: own.id, departmentIds: [area, other], weeklyHours: '42,5' });
    expect(saved.weeklyMinutes).toBe(2550);
    const catalog = await getScheduleCatalog(admin, area);
    expect(catalog.collaborators.find((p) => p.id === a)!.weeklyMinutes! / 60).toBe(42.5);
    await expect(saveScheduleCollaborator(admin, { id: a, version: saved.version, userId: own.id, departmentIds: [area], weeklyHours: 2520 })).rejects.toThrow();
  });
  it('lee el nombre y rol vigentes de Usuarios y preserva los horarios al desactivarlo', async () => {
    await add(); const assigned = await slot();
    await prisma.user.update({ where: { id: own.id }, data: { name: 'Nombre actualizado' } });
    const renamed = await getScheduleBoard(admin, area, planId);
    expect(renamed.collaborators.find((p) => p.id === a)?.name).toBe('Nombre actualizado');
    expect(renamed.slots[0]?.collaborator.name).toBe('Nombre actualizado');
    await prisma.user.update({ where: { id: own.id }, data: { active: false } });
    expect((await getScheduleBoard(admin, area, planId)).collaborators.some((p) => p.id === a)).toBe(false);
    await expect(add(a, '2090-10-05')).rejects.toThrow('activo');
    await expect(moveScheduleSlot(admin, await mutation(), { slotId: assigned.id, targetCollaboratorId: a, targetDate: '2090-10-06', mode: 'MOVER' })).rejects.toThrow('inactivo');
    expect((await prisma.scheduleSlot.findUniqueOrThrow({ where: { id: assigned.id } })).cancelledAt).toBeNull();
    await cancelScheduleSlot(admin, await mutation(planId, 'Retiro de programación futura'), assigned.id);
    expect((await prisma.scheduleSlot.findUniqueOrThrow({ where: { id: assigned.id } })).cancelledAt).not.toBeNull();
  });
  it('oculta usuarios reservados y no concede permisos por aparecer en una malla', async () => {
    await prisma.user.update({ where: { id: own.id }, data: { hiddenFromSelectors: true } });
    expect((await getScheduleBoard(admin, area, planId)).collaborators.some((p) => p.id === a)).toBe(false);
    await expect(add()).rejects.toThrow();
    await expect(getScheduleBoard(reader, area)).rejects.toThrow('no está habilitado');
  });
'''
p = Path(tests); text = p.read_text(); at = text.rfind('\n});'); assert at >= 0; p.write_text(text[:at] + new_tests + text[at:])

unit = 'tests/schedule-domain.test.ts'
replace(unit, 'weeklyTotals, type IntervalSlot', 'weeklyTotals, weeklyHoursSchema, weeklyHoursToMinutes, formatScheduleHours, type IntervalSlot')
section(unit, "  it('exige colación dentro", "  it('reconoce los dos feriados", '''  it('no configura ni descuenta colación, tampoco en registros heredados', () => {
    const window = templateWindow('2026-10-01', { ...clock('08:00', '19:00'), breakStartTime: '13:00', breakMinutes: 60 });
    expect(window.breakStartAt).toBeNull(); expect(window.breakEndAt).toBeNull();
    const s = { collaboratorId: 'a', functionName: 'Recepcionista', kind: 'TURNO', ...window, breakPaid: false, breakStartAt: new Date('2026-10-01T16:00:00Z'), breakEndAt: new Date('2026-10-01T17:00:00Z') };
    expect(plannedMinutes(s)).toBe(660); expect(plannedMinutes({ ...s, breakPaid: true })).toBe(660);
    expect(templateSchema.safeParse({ departmentId: 'x', code: 'D', label: 'Día', ...clock('08:00', '19:00'), breakMinutes: 60 }).success).toBe(false);
  });
  it('interpreta referencias semanales como horas, no como minutos', () => {
    expect(weeklyHoursToMinutes(42)).toBe(2520); expect(weeklyHoursSchema.parse('42,5')).toBe(42.5);
    expect(weeklyHoursToMinutes(42.5)).toBe(2550); expect(formatScheduleHours(2550)).toBe('42,5 h');
    expect(weeklyHoursSchema.safeParse(2520).success).toBe(false); expect(weeklyHoursSchema.safeParse(-1).success).toBe(false);
  });
''')
replace(unit, 'cuenta personas únicas, funciones exactas y colaciones aunque sean pagadas', 'cuenta personas únicas y funciones exactas sin descontar colaciones')
replace(unit, "expect(gaps).toHaveLength(1); expect(gaps[0]?.scheduled).toBe(1); expect(gaps[0]?.endAt).toBe('2026-10-03T23:30:00.000Z');", "expect(gaps).toEqual([]);")
replace(unit, 'no cuenta extras pendientes y descuenta colación en la franja actual', 'no cuenta extras pendientes ni descuenta colación en la franja actual')
replace(unit, "}, base.startAt!)).toBe(false);", "}, base.startAt!)).toBe(true);")

# Version metadata only, without dependency churn.
p = Path('package.json'); package = json.loads(p.read_text()); old = package['version']; nums = list(map(int, old.split('.'))); nums[2] += 1; version = '.'.join(map(str, nums));
replace('package.json', f'"version": "{old}"', f'"version": "{version}"')
p = Path('package-lock.json'); text = p.read_text(); lock = json.loads(text)
assert lock['version'] == old and lock['packages']['']['version'] == old
text = text.replace(f'"version": "{old}"', f'"version": "{version}"', 2); check = json.loads(text)
assert check['version'] == version and check['packages']['']['version'] == version
p.write_text(text)

note = f'''## 01/10/2026 · AROH {version} · Usuarios y horas en Equipo

- La instrucción actual sustituye el alta independiente de colaboradores de 1.41.0: colaborador = Usuario. ScheduleCollaborator conserva sólo la extensión técnica de planificación y sus referencias históricas; userId único es la identidad canónica. No se aceptan altas sin usuario ni sustituciones de identidad.
- Usuarios activos y visibles del área principal aparecen automáticamente al preparar su malla, sin crear cuentas ni asignaciones. Las áreas adicionales y horas se configuran sobre la cuenta existente. Registros históricos sin vínculo no se borran ni se vinculan por conjetura; se vinculan explícitamente.
- Nombre, rol y estado se leen del usuario. Inactivos/ocultos no son destinos de asignación; sus horarios siguen conservados y pueden retirarse con auditoría. No se amplían permisos schedule.* de ningún rol.
- Referencia semanal: entrada y presentación en horas (42 / 42,5), validación de 0–168 h. Persistencia interna en minutos para no reinterpretar valores históricos ni migrar datos.
- Fuera de este módulo: colación, descuentos de pausa y descanso mínimo entre jornadas. Se conservan Libre, vacaciones y ausencias como estados de la malla, así como solapamientos, medianoche, versión, publicación y auditoría. Snapshots históricos no se borran.
- Sin cambios de esquema, dependencias, caja, turnos operativos, DNS ni infraestructura. Validación por Compuerta en PostgreSQL desechable; comprobar el resultado del PR y Production antes de dar por desplegado.

'''
for file in ['PROJECT_CONTEXT.md', 'docs/AGENT_HANDOFF.md']:
    p = Path(file); text = p.read_text(); pos = text.index('\n') + 1; p.write_text(text[:pos] + '\n' + note + text[pos:])
p = Path('docs/EQUIPO_HORARIOS.md'); text = p.read_text(); pos = text.index('\n') + 1; p.write_text(text[:pos] + '\n' + note + '## Historial de diseño 1.41.0 (sustituido donde contradiga la corrección anterior)\n' + text[pos:])
print(f'Prepared AROH {version}: user identity, weekly hours, no rest deductions; production untouched.')
