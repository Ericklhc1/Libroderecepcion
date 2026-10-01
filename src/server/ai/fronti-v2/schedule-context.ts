import 'server-only';
import type { CurrentUser } from '@/server/auth/current-user';
import { getScheduleBoard, getScheduleDepartments, getSchedulePlan } from '@/server/services/schedules';
import { getScheduleCatalog } from '@/server/services/schedule-catalog';
import { functionKey, scheduleDate } from '@/domain/schedule';
import { scheduleLabel } from '@/domain/schedule-display';
import { hotelDateKey } from '@/domain/time';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { NotFoundError } from '@/server/errors';

/** The assistant uses exactly the board's permission and area filters. */
export async function readScheduleContext(user: CurrentUser, args: { area?: string | null; planId?: string | null; date?: string | null; section?: string | null } = {}) {
  const departments = await getScheduleDepartments(user);
  const focus = args.planId ? await getSchedulePlan(user, args.planId) : null;
  const requested = args.area ?? focus?.departmentId;
  const area = requested
    ? departments.find((d) => d.id === requested || functionKey(d.name) === functionKey(requested))
    : departments.find((d) => d.key === 'RECEPCION') ?? departments[0];
  if (!area) {
    if (requested) throw new NotFoundError();
    return { message: 'No tienes un área o un horario disponible para consultar.' };
  }
  const date = args.date ? scheduleDate.parse(args.date) : null;
  const board = await getScheduleBoard(user, area.id, focus?.id);
  const catalog = args.section && args.section !== 'calendario'
    ? await getScheduleCatalog(user, area.id, args.section === 'configuracion') : null;
  const sectionContent = !catalog ? null : args.section === 'plantillas'
    ? { templates: catalog.templates.map(t => ({ label: scheduleLabel(t), description: t.label, revision: t.revision, active: t.active })) }
    : args.section === 'cobertura'
      ? { rules: catalog.coverage.map(r => ({ name: r.name, hours: scheduleLabel({ ...r, code: r.name }), minimum: r.minimum, weekdays: r.weekdays, active: r.active })) }
      : args.section === 'colaboradores'
        ? { people: catalog.collaborators.map(p => ({ name: p.name, active: p.active, linkedToAccount: Boolean(p.userId), weeklyHours: p.weeklyMinutes === null ? null : p.weeklyMinutes / 60 })) }
        : { holidays: catalog.holidays.map(h => ({ date: formatCalendarDate(h.date), name: h.name, active: h.active })), grants: catalog.grants.map(g => ({ person: g.user.name, area: g.department.name })) };
  const today = hotelDateKey(new Date());
  const assignments = date ? board.slots.filter((s) => s.date.toISOString().slice(0, 10) === date) : [
    ...board.slots.filter((s) => s.date.toISOString().slice(0, 10) >= today),
    ...board.slots.filter((s) => s.date.toISOString().slice(0, 10) < today),
  ];
  return {
    area: { id: area.id, name: area.name }, sectionContent,
    plan: board.selected ? { humanId: board.selected.humanId, reference: `Horario #${board.selected.humanId}`, startDate: formatCalendarDate(board.selected.startDate), endDate: formatCalendarDate(board.selected.endDate), status: board.selected.status === 'PUBLICADO' ? 'Publicado' : 'Borrador', version: board.selected.version } : null,
    counts: { assignments: board.slots.length, coverageRules: board.rules.length, gaps: board.gaps.length, pendingExtras: board.slots.filter((s) => s.extraStatus === 'PENDIENTE').length },
    people: board.collaborators.slice(0, 40).map((p) => ({ name: p.name, function: p.functionName, weeklyHours: p.weeklyMinutes === null ? null : p.weeklyMinutes / 60 })),
    templates: board.templates.map((t) => ({ label: scheduleLabel(t), description: t.label })),
    assignments: assignments.slice(0, 40).map((s) => ({ collaborator: s.collaborator.name, date: formatCalendarDate(s.date), label: scheduleLabel(s), startAt: s.startAt ? formatDateTime(s.startAt) : null, endAt: s.endAt ? formatDateTime(s.endAt) : null, extraKind: s.extraKind, extraStatus: s.extraStatus })),
    shownAssignments: Math.min(assignments.length, 40), matchingAssignments: assignments.length, dateFilter: date,
    gaps: board.gaps.filter((g) => !date || g.date === date).slice(0, 12).map(g => ({ ...g, startAt: formatDateTime(g.startAt), endAt: formatDateTime(g.endAt) })),
    imports: board.imports.slice(0, 3).map((draft) => ({ file: draft.fileName, baseVersion: draft.baseVersion, needsReview: draft.baseVersion !== board.selected?.version, rows: Array.isArray(draft.rows) ? draft.rows.length : 0, issueCount: Array.isArray(draft.issues) ? draft.issues.length : 0, issues: Array.isArray(draft.issues) ? draft.issues.slice(0, 8) : [], nextStep: 'Usa «Volver a revisar coincidencias» después de corregir personas o turnos. Revisa el resultado antes de incorporarlo.' })),
    guidance: 'El horario indica quién está programado; no confirma asistencia ni abre Recepción o Caja. Sin personas mínimas definidas no puedes afirmar que el área está cubierta. Si la lista está recortada, consulta una fecha concreta. Los cambios se revisan y confirman en Equipo; esta consulta no modifica horarios.',
  };
}

export function isScheduleReview(message: string, module: string | undefined): boolean {
  const text = functionKey(message);
  return module === 'equipo' && /horario|malla|archivo|equipo|programa|cobertura|coincidencias|aqui|aca|esto/.test(text) && !/caja|garant|llave|habitacion|reserva/.test(text) && /revisa|errores|problemas|resumen|que falta|coincidencias/.test(text)
    && !/\b(?:crea(?:r)?|publica(?:r|lo)?|asigna(?:r)?|mueve|borra(?:r)?|cancela(?:r)?|modifica(?:r)?|guarda(?:r)?|cambia(?:r)?)\b/.test(text);
}

export function scheduleReviewReply(data: Awaited<ReturnType<typeof readScheduleContext>>): string {
  if (!data.area) return data.message;
  if (!data.plan) return `${data.area.name}: aún no hay un horario disponible. Crea un horario desde Calendario para comenzar.`;
  const lines = [`${data.plan.reference} · ${data.area.name} · ${data.plan.status}.`, `${data.counts.assignments} asignaciones guardadas.`,
    data.counts.coverageRules ? `${data.counts.gaps} periodos con falta de personal según las ${data.counts.coverageRules} reglas del área.` : 'Aún no has definido cuántas personas necesita el área. Define la cobertura mínima para revisarlo.',
  ];
  if (data.assignments.length) {
    lines.push('Programación guardada:', ...data.assignments.slice(0, 6).map(s => `• ${s.collaborator} · ${s.date} · ${s.label}`));
    if (data.matchingAssignments > 6) lines.push('El calendario contiene más asignaciones; aquí se muestran las primeras seis.');
  }
  for (const draft of data.imports) {
    lines.push(`Archivo «${draft.file}»: ${draft.rows} asignaciones leídas y ${draft.issueCount} observaciones${draft.needsReview ? '; revisión anterior al último cambio' : ''}.`);
    if (draft.issues.length) lines.push(...[...new Set(draft.issues.map(issue => String(issue).replace(/ · \d{4}-\d{2}-\d{2}:/, ':')))].slice(0, 4).map(issue => `• ${issue}`));
    lines.push(draft.nextStep);
  }
  if (data.counts.pendingExtras) lines.push(`${data.counts.pendingExtras} extras pendientes de aprobación.`);
  lines.push('Revisa los periodos sin cubrir en «Cobertura y coordinación» y completa las asignaciones desde el calendario. Publica cuando el horario esté revisado. Publicar no inicia turnos ni confirma asistencia.');
  return lines.join('\n\n');
}
