'use client';
import { useState } from 'react';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { createHousekeepingAction, changeHousekeepingAction } from '@/server/actions/housekeeping';
import { HOUSEKEEPING_ACTION_LABELS, housekeepingNeedsNote, type HousekeepingAction } from '@/domain/housekeeping';

export type Destinations = { departments: { id: string; name: string; key: string }[]; users: { id: string; name: string; departmentIds: string[] }[] };

function DestinationFields({ destinations, defaultDepartment }: { destinations: Destinations; defaultDepartment?: string }) {
  const [departmentId, setDepartmentId] = useState(defaultDepartment ?? destinations.departments.find(d => d.key === 'HOUSEKEEPING')?.id ?? '');
  return <div className="grid gap-3 sm:grid-cols-2"><Field label="Área que recibe" name="departmentId"><Select name="departmentId" required value={departmentId} onChange={e => setDepartmentId(e.target.value)} options={destinations.departments.map(d => ({ value: d.id, label: d.name }))} /></Field><Field label="Responsable" name="assignedToId" hint="Sólo usuarios del área con permiso de gestión. Sin responsable, el aviso queda por tomar."><Select key={departmentId} name="assignedToId" defaultValue="" options={[{ value: '', label: 'Por tomar en el área' }, ...destinations.users.filter(u => u.departmentIds.includes(departmentId)).map(u => ({ value: u.id, label: u.name }))]} /></Field></div>;
}

export function NewHousekeepingForm({ requestKey, destinations }: { requestKey: string; destinations: Destinations }) {
  return (
    <Dialog title="Nuevo aviso de Housekeeping" description="Coordina una necesidad de Housekeeping. La recepción y el resultado quedarán registrados con su autoría." trigger="Nuevo aviso" triggerVariant="gold" width="md">
      <ActionForm action={createHousekeepingAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="requestKey" value={requestKey} />
        <DestinationFields destinations={destinations} />
        <Field label="Qué necesita Housekeeping" name="title"><Input name="title" required maxLength={160} placeholder="Preparar una atención especial…" /></Field>
        <Field label="Contexto e instrucción" name="description"><Textarea name="description" required maxLength={3000} rows={3} /></Field>
        <Field label="Habitación o zona (opcional)" name="location"><Input name="location" maxLength={160} placeholder="512, pasillo del piso 5, vestíbulo…" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prioridad" name="priority"><Select name="priority" defaultValue="MEDIA" options={[{ value: 'BAJA', label: 'Baja' }, { value: 'MEDIA', label: 'Media' }, { value: 'ALTA', label: 'Alta' }, { value: 'CRITICA', label: 'Crítica' }]} /></Field>
          <Field label="Atender antes de (opcional)" name="dueAt" hint="Hora de Chile."><Input type="datetime-local" name="dueAt" /></Field>
        </div>
        <SubmitButton pendingLabel="Guardando…">Guardar aviso</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

export function LinkHousekeepingForm({ requestKey, sourceEntryId }: { requestKey: string; sourceEntryId: string }) {
  return <ActionForm action={createHousekeepingAction} hideSuccess refreshOnSuccess className="space-y-0">
    <input type="hidden" name="requestKey" value={requestKey} /><input type="hidden" name="sourceEntryId" value={sourceEntryId} />
    <SubmitButton variant="secondary" size="sm" pendingLabel="Vinculando…">Vincular a Housekeeping</SubmitButton>
  </ActionForm>;
}

export function HousekeepingChangeForm({ id, version, action, destinations, departmentId }: { id: string; version: number; action: HousekeepingAction; destinations: Destinations; departmentId?: string }) {
  const needsNote = housekeepingNeedsNote(action);
  const label = HOUSEKEEPING_ACTION_LABELS[action];
  const fields = <><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} /><input type="hidden" name="action" value={action} /></>;
  if (!needsNote) return <ActionForm action={changeHousekeepingAction} hideSuccess refreshOnSuccess className="space-y-0">{fields}<SubmitButton variant="secondary" size="sm" pendingLabel="Guardando…">{label}</SubmitButton></ActionForm>;
  return <Dialog title={label} description="La acción y tu nombre quedarán registrados en el historial." trigger={label} triggerVariant="secondary" triggerSize="sm" width="sm">
    <ActionForm action={changeHousekeepingAction} closeOnSuccess refreshOnSuccess>{fields}
      {action === 'DERIVAR' && <DestinationFields destinations={destinations} defaultDepartment={departmentId} />}
      <Field label={action === 'RESOLVER' ? 'Qué se hizo y cuál fue el resultado' : 'Motivo / información necesaria'} name="note"><Textarea name="note" required maxLength={3000} rows={3} /></Field>
      <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
    </ActionForm>
  </Dialog>;
}
