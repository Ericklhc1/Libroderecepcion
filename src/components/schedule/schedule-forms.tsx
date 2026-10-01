'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { createSchedulePlanAction, addScheduleSlotAction, publishSchedulePlanAction, reviewScheduleImportAction, applyScheduleImportAction, acknowledgeScheduleAction, refreshScheduleImportAction } from '@/server/actions/schedule';
import { scheduleLabel, collaboratorReference } from '@/domain/schedule-display';
import { SLOT_LABELS, SLOT_KINDS, EXTRA_LABELS, EXTRA_KINDS } from '@/domain/schedule';

export type SchedulePerson = { id: string; name: string; employeeCode: string; functionName: string; weeklyMinutes: number | null; userId: string | null; username?: string | null };
export type ScheduleTemplateOption = { id: string; code: string; label: string; startTime: string; endTime: string; crossesMidnight: boolean };
export type CalendarPlan = { id: string; humanId: number; version: number; status: string; startDate: string; endDate: string };
export type CalendarSlot = { id: string; collaboratorId: string; date: string; kind: string; code: string; templateId: string | null; startTime: string | null; endTime: string | null; crossesMidnight: boolean; startAt: string | null; endAt: string | null; extraKind: string; extraMinutes: number; extraStatus: string; reportedExtraMinutes: number | null; note: string | null; breakMinutes: number; breakPaid: boolean; plannedMinutes: number };
export function ScheduleMutationFields({ plan, requestKey }: { plan: CalendarPlan; requestKey: string }) {
  return <><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="version" value={plan.version} /><input type="hidden" name="requestKey" value={requestKey} /></>;
}
export function ScheduleReason({ required = true }: { required?: boolean }) { return <Field label="Motivo / información para el equipo" name="reason"><Textarea name="reason" required={required} maxLength={1000} rows={2} /></Field>; }
export function NewSchedulePlanForm({ departmentId, today, requestKey }: { departmentId: string; today: string; requestKey: string }) {
  const router = useRouter();
  return <Dialog trigger="Nuevo horario" title="Crear horario del área" description="Elige un periodo de hasta 63 días. No se permite superponer horarios de una misma área." triggerVariant="gold">
    <ActionForm action={createSchedulePlanAction} closeOnSuccess refreshOnSuccess onSuccess={(s) => { if (s.id) router.push(`/equipo?area=${departmentId}&malla=${s.id}`); }}>
      <input type="hidden" name="departmentId" value={departmentId} /><input type="hidden" name="requestKey" value={requestKey} />
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Desde" name="startDate"><Input name="startDate" type="date" required min={today} defaultValue={today} /></Field><Field label="Hasta" name="endDate"><Input name="endDate" type="date" required min={today} defaultValue={today} /></Field></div><SubmitButton>Crear borrador</SubmitButton>
    </ActionForm>
  </Dialog>;
}
export function ScheduleSlotFields({ plan, people, templates, personId, date, slot, onSaved }: { plan: CalendarPlan; people: SchedulePerson[]; templates: ScheduleTemplateOption[]; personId?: string; date?: string; slot?: CalendarSlot; onSaved?: () => void }) {
  const [kind, setKind] = useState(slot?.kind ?? 'TURNO'); const [extra, setExtra] = useState(slot?.extraKind ?? 'NINGUNO'); const [requestKey] = useState(() => crypto.randomUUID());
  return <ActionForm action={addScheduleSlotAction} closeOnSuccess refreshOnSuccess onSuccess={onSaved}>
    <ScheduleMutationFields plan={plan} requestKey={requestKey} />{slot && <input type="hidden" name="replaceSlotId" value={slot.id} />}
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Colaborador" name="collaboratorId"><Select name="collaboratorId" required defaultValue={slot?.collaboratorId ?? personId} options={people.map((p) => ({ value: p.id, label: [p.name, collaboratorReference(p)].filter(Boolean).join(' · ') }))} /></Field><Field label="Fecha de inicio" name="date"><Input name="date" type="date" required min={plan.startDate} max={plan.endDate} defaultValue={slot?.date ?? date ?? plan.startDate} /></Field></div>
    <Field label="Programación" name="kind"><Select name="kind" value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value !== 'TURNO') setExtra('NINGUNO'); }} options={SLOT_KINDS.map((k) => ({ value: k, label: SLOT_LABELS[k] }))} /></Field>
    {kind === 'TURNO' ? <><Field label="Plantilla del área" name="templateId"><Select name="templateId" required defaultValue={slot?.templateId ?? ''} options={templates.map((t) => ({ value: t.id, label: `${scheduleLabel(t)} · ${t.label}` }))} /></Field><Field label="Extra solicitado" name="extraKind"><Select name="extraKind" value={extra} onChange={(e) => setExtra(e.target.value)} options={EXTRA_KINDS.map((k) => ({ value: k, label: EXTRA_LABELS[k]! }))} /></Field>{extra === 'EXTENSION' ? <Field label="Minutos adicionales al término" name="extraMinutes" hint="Se mantienen el código y las horas de la plantilla; la extensión queda registrada por separado."><Input name="extraMinutes" type="number" min={1} max={720} step={1} required defaultValue={slot?.extraMinutes || 60} /></Field> : <input type="hidden" name="extraMinutes" value="0" />}</> : <><input type="hidden" name="extraKind" value="NINGUNO" /><input type="hidden" name="extraMinutes" value="0" /></>}
    <Field label="Observación operativa (opcional)" name="note" hint="No incluyas diagnósticos ni información laboral privada."><Textarea name="note" maxLength={1000} rows={2} defaultValue={slot?.note ?? ''} /></Field>
    {(plan.status === 'PUBLICADO' || slot) && <ScheduleReason />}
    {slot && <p className="text-xs text-slate-600">La versión anterior se conserva. Los extras de la nueva asignación requieren una nueva aprobación.</p>}
    <SubmitButton>Guardar asignación</SubmitButton>
  </ActionForm>;
}
export function PublishScheduleForm({ plan, requestKey, gaps }: { plan: CalendarPlan; requestKey: string; gaps: number }) {
  return <Dialog trigger="Publicar horario" title="Publicar horario" description="El horario será visible para los perfiles habilitados. Las personas vinculadas a una cuenta recibirán un aviso y podrán confirmar recepción." triggerVariant="gold">
    <ActionForm action={publishSchedulePlanAction} closeOnSuccess refreshOnSuccess><ScheduleMutationFields plan={plan} requestKey={requestKey} />{gaps > 0 && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">Hay {gaps} franjas con falta de personal. Revisa los periodos sin cubrir y deja constancia de cómo se gestionarán antes de publicar.</p>}<ScheduleReason /><SubmitButton>Confirmar publicación</SubmitButton></ActionForm>
  </Dialog>;
}
export function ScheduleUploadForm({ planId }: { planId: string }) {
  return <ActionForm action={reviewScheduleImportAction} refreshOnSuccess><input type="hidden" name="planId" value={planId} /><Field label="Archivo de horario" name="file" hint="PDF, XLSX, CSV o TSV · hasta 3 MB. La carga no modifica el calendario hasta incorporarla."><input className="input-base w-full" name="file" type="file" accept=".pdf,.xlsx,.csv,.tsv" required /></Field><SubmitButton variant="secondary">Leer y revisar archivo</SubmitButton></ActionForm>;
}
export function ApplyScheduleImportForm({ plan, importId, requestKey }: { plan: CalendarPlan; importId: string; requestKey: string }) {
  return <ActionForm action={applyScheduleImportAction} refreshOnSuccess><ScheduleMutationFields plan={plan} requestKey={requestKey} /><input type="hidden" name="importId" value={importId} />{plan.status === 'PUBLICADO' && <ScheduleReason />}<SubmitButton>Incorporar coincidencias revisadas</SubmitButton></ActionForm>;
}
export function AcknowledgeScheduleForm({ planId, version }: { planId: string; version: number }) {
  return <ActionForm action={acknowledgeScheduleAction} hideSuccess refreshOnSuccess><input type="hidden" name="planId" value={planId} /><input type="hidden" name="version" value={version} /><SubmitButton variant="secondary">He revisado mi horario</SubmitButton></ActionForm>;
}

export function RefreshScheduleImportForm({ importId }: { importId: string }) {
  return <ActionForm action={refreshScheduleImportAction} refreshOnSuccess><input type="hidden" name="importId" value={importId} /><SubmitButton variant="secondary">Volver a revisar coincidencias</SubmitButton></ActionForm>;
}
