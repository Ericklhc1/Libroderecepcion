'use client';
import { ActionForm, Checkbox, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { updateEntryVisibilityAction } from '@/server/actions/entries';
import type { Option } from '@/server/services/options';

export function EntryVisibilityFields({ departments, hiddenAreas = [], hiddenDepartmentIds = [], includeInHandover = true }: { departments: Option[]; hiddenAreas?:Option[]; hiddenDepartmentIds?: string[]; includeInHandover?: boolean }) {
  const areas=[...departments,...hiddenAreas.filter(d=>!departments.some(active=>active.value===d.value))];
  return <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
    <legend className="text-sm font-semibold">Visibilidad de la novedad</legend>
    <label className="block text-sm">Mostrar en entrega e impresión de Recepción
      <Select name="includeInReceptionHandover" defaultValue={includeInHandover ? 'true' : 'false'} options={[{value:'true',label:'Sí'},{value:'false',label:'No'}]} />
    </label>
    <p className="text-xs text-slate-600">Ocultar a estas áreas (sin marcar: visible):</p>
    {areas.map(d => <Checkbox key={d.value} id={`hidden-area-${d.value}`} name="hiddenDepartmentIds" value={d.value} label={d.label} defaultChecked={hiddenDepartmentIds.includes(d.value)} />)}
  </fieldset>;
}
export function EntryVisibilityDialog({ entryId, revision, departments, hiddenAreas, hiddenDepartmentIds, includeInHandover }: { entryId: string; revision: string; departments: Option[]; hiddenAreas:Option[]; hiddenDepartmentIds: string[]; includeInHandover: boolean }) {
  return <Dialog title="Visibilidad de la novedad" trigger="Visibilidad" triggerVariant="secondary" triggerSize="sm">
    <ActionForm action={updateEntryVisibilityAction} closeOnSuccess refreshOnSuccess>
      <input type="hidden" name="id" value={entryId} /><input type="hidden" name="revision" value={revision} />
      <EntryVisibilityFields departments={departments} hiddenAreas={hiddenAreas} hiddenDepartmentIds={hiddenDepartmentIds} includeInHandover={includeInHandover} />
      <SubmitButton pendingLabel="Guardando…">Guardar visibilidad</SubmitButton>
    </ActionForm>
  </Dialog>;
}
