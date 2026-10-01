import { scheduleAssignmentStarted, slotSchema, templateWindow, type SlotInput } from './schedule';

type ImportTemplate = { id: string; startTime: string; endTime: string; crossesMidnight: boolean };

/** Historical rows remain in the file review, but never create assignments. */
export function scheduleImportRowStarted(input: SlotInput, templates: ImportTemplate[], now = new Date()) {
  const date = new Date(`${input.date}T00:00:00Z`);
  if (scheduleAssignmentStarted({ date, startAt: null }, now)) return true;
  if (input.kind !== 'TURNO') return false;
  const template = templates.find(t => t.id === input.templateId);
  // Missing/invalid templates are validation errors, not historical omissions.
  if (!template) return false;
  try { return scheduleAssignmentStarted({ date, startAt: templateWindow(input.date, { ...template, breakMinutes: 0, breakPaid: false }).startAt }, now); }
  catch { return false; }
}

export function scheduleImportOmittedRows(rows: unknown, templates: ImportTemplate[], now = new Date()): number[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    const parsed = slotSchema.safeParse(row?.input);
    return parsed.success && scheduleImportRowStarted(parsed.data, templates, now) ? [index] : [];
  });
}
