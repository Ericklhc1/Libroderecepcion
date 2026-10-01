import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { readReportFile } from '@/server/pms/read-report-file';
import { extractScheduleRoster, type RosterRow } from '@/domain/schedule-import';
import { functionKey, mutationSchema, scheduleId, slotSchema, type SlotInput } from '@/domain/schedule';
import { assertScheduleArea } from './schedule-access';
import { ensureScheduleUsers, scheduleEligibleUser, scheduleIdentitySelect, schedulePerson } from './schedule-users';
import { buildScheduleSlot, getSchedulePlan, mutateSchedulePlan, lockScheduleCollaborators } from './schedules';

export async function reviewScheduleImport(user: CurrentUser, planId: string, fileName: string, bytes: Uint8Array) {
  scheduleId.parse(planId); const plan = await getSchedulePlan(user, planId); await assertScheduleArea(user, plan.departmentId, 'schedule.manage');
  if (!/\.(pdf|xlsx|csv|tsv)$/i.test(fileName) || bytes.length === 0 || bytes.length > 3 * 1024 * 1024) throw new RuleError('Usa PDF, XLSX, CSV o TSV de hasta 3 MB.');
  await ensureScheduleUsers(user, plan.departmentId);
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  const existing = await prisma.scheduleImport.findFirst({ where: { planId, fileHash, status: 'APLICADO' } }); if (existing) return existing;
  const files = await readReportFile(fileName, bytes, { preserveClockCells: true });
  const extracted = files.map((f) => extractScheduleRoster(f.fragments, plan.startDate.toISOString().slice(0, 10), plan.endDate.toISOString().slice(0, 10)));
  const people = await prisma.scheduleCollaborator.findMany({ where: { user: { is: scheduleEligibleUser }, memberships: { some: { departmentId: plan.departmentId, active: true } } } }, include: { user: { select: scheduleIdentitySelect } } }).then((rows) => rows.map(schedulePerson));
  const templates = await prisma.scheduleTemplate.findMany({ where: { departmentId: plan.departmentId, active: true } });
  const issues = extracted.flatMap((e) => e.issues); const rows = extracted.flatMap((e) => e.rows);
  if (rows.length > 2000) throw new RuleError('La carga admite como máximo 2.000 asignaciones.');
  const resolved: Array<{ source: RosterRow; input: SlotInput | null; issue: string | null }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const identified = row.employeeCode ? people.filter((p) => p.employeeCode === row.employeeCode!.trim().toUpperCase()) : [];
    const matches = row.employeeCode ? identified : people.filter((p) => row.name && functionKey(p.name) === functionKey(row.name));
    let issue: string | null = null; let input: SlotInput | null = null;
    const person = matches.length === 1 ? matches[0] : undefined;
    if (!person) issue = 'Usuario no reconocido o nombre ambiguo. Revisa la cuenta existente y su área; no crees otra persona.';
    if (person && row.employeeCode && row.name && row.name !== row.employeeCode && functionKey(person.name) !== functionKey(row.name)) issue = 'El código y el nombre indican colaboradores diferentes.';
    const template = templates.find((t) => t.code === row.code);
    const kind = ['LIBRE', 'VACACIONES', 'AUSENCIA'].includes(row.code) ? row.code as 'LIBRE' | 'VACACIONES' | 'AUSENCIA' : 'TURNO';
    if (kind === 'TURNO' && !template) issue = `El código ${row.code} no está habilitado en esta área.`;
    if (template && ((row.startTime && row.startTime !== template.startTime) || (row.endTime && row.endTime !== template.endTime))) issue = 'Las horas no coinciden con la plantilla del código. Revisa la glosa.';
    if (person && !issue) {
      input = slotSchema.parse({ collaboratorId: person.id, date: row.date, kind, templateId: template?.id, extraKind: 'NINGUNO', extraMinutes: 0, note: '' });
      const unique = `${person.id}:${row.date}:${row.code}`;
      if (seen.has(unique)) issue = 'Asignación duplicada dentro del archivo.'; seen.add(unique);
      if (row.date < plan.startDate.toISOString().slice(0, 10) || row.date > plan.endDate.toISOString().slice(0, 10)) issue = 'Fecha fuera del periodo de la malla.';
    }
    if (issue) issues.push(`${row.name ?? row.employeeCode} · ${row.date}: ${issue}`);
    resolved.push({ source: row, input, issue });
  }
  return prisma.scheduleImport.upsert({ where: { planId_fileHash_baseVersion: { planId, fileHash, baseVersion: plan.version } }, create: { planId, fileName: fileName.slice(0, 200), fileHash, baseVersion: plan.version, rows: JSON.parse(JSON.stringify(resolved)), issues }, update: { rows: JSON.parse(JSON.stringify(resolved)), issues } });
}
export async function applyScheduleImport(user: CurrentUser, raw: unknown, importId: string) {
  const mutation = mutationSchema.parse(raw); scheduleId.parse(importId);
  return mutateSchedulePlan(user, mutation, 'INCORPORAR_CARGA', 'schedule.manage', { importId }, async (tx, plan) => {
    const draft = await tx.scheduleImport.findFirst({ where: { id: importId, planId: plan.id } }); if (!draft) throw new NotFoundError();
    if (draft.status !== 'REVISION') throw new RuleError('Esta carga ya fue incorporada.');
    if (draft.baseVersion !== plan.version) throw new RuleError('La malla cambió desde la revisión. Vuelve a cargar el archivo para revisar la nueva versión.');
    if (!Array.isArray(draft.issues) || draft.issues.length) throw new RuleError('Resuelve todas las observaciones antes de incorporar la carga.');
    const rows = draft.rows as unknown as Array<{ input: SlotInput | null }>;
    await lockScheduleCollaborators(tx, rows.map((row) => slotSchema.parse(row.input).collaboratorId));
    const current = await tx.scheduleSlot.findMany({ where: { planId: plan.id, cancelledAt: null } });
    const after = []; const affected: string[] = [];
    for (const row of rows) {
      const input = slotSchema.parse(row.input); const data = await buildScheduleSlot(tx, plan, input);
      const identical = current.find((s) => s.collaboratorId === input.collaboratorId && s.date.toISOString().slice(0, 10) === input.date && s.kind === input.kind && s.code === data.code && s.startAt?.getTime() === (data.startAt as Date | undefined)?.getTime() && s.endAt?.getTime() === (data.endAt as Date | undefined)?.getTime() && s.extraKind === 'NINGUNO');
      if (identical) continue;
      if (current.some((s) => s.collaboratorId === input.collaboratorId && s.date.toISOString().slice(0, 10) === input.date)) throw new RuleError('La carga contradice una casilla existente. Corrígela desde el calendario; no se sobrescribe.');
      const slot = await tx.scheduleSlot.create({ data }); after.push(slot); affected.push(slot.collaboratorId);
    }
    await tx.scheduleImport.update({ where: { id: draft.id }, data: { status: 'APLICADO', appliedAt: new Date() } });
    return { after: { importId, fileName: draft.fileName, fileHash: draft.fileHash, assignments: after }, affected };
  });
}
