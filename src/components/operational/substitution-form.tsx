'use client';

import { useId, useState } from 'react';
import { ActionForm } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { saveAutomationAction } from '@/components/operational/navigation-action';
import {
  addOrderedCandidate, candidateIsSelectable, candidateLabel,
  moveOrderedCandidate, removeOrderedCandidate,
  type SubstitutionCandidate, type SubstitutionWorkKind,
} from '@/domain/substitution-candidates';

type Configuration = {
  kind: SubstitutionWorkKind;
  trigger: 'UNASSIGNED' | 'UNRECEIVED' | 'OVERDUE' | 'BLOCKED';
  priority: string | null;
  mode: 'PROPOSE' | 'APPLY';
  candidateIds: string[];
  requirePublishedSchedule: boolean;
  waitForPublishedSchedule?: boolean;
  receiptMinutes: number;
  nextAction: string;
};
type Existing = { id: string; version: number; name: string; departmentId: string; expiresAt: string; configuration: Configuration };

/** A human editor for the native policy. Save still creates a paused version. */
export function SubstitutionForm({ areas, people, existing }: {
  areas: Array<{ id: string; name: string }>;
  people: SubstitutionCandidate[];
  existing?: Existing;
}) {
  const prefix = useId();
  const config = existing?.configuration;
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? areas[0]?.id ?? '');
  const [kind, setKind] = useState<SubstitutionWorkKind>(config?.kind ?? 'task');
  const [ids, setIds] = useState(config?.candidateIds ?? []);
  const [choice, setChoice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const unavailable = ids.filter(id => {
    const person = people.find(candidate => candidate.id === id);
    return !person || !candidateIsSelectable(person, departmentId, kind);
  });
  const available = people.filter(person => candidateIsSelectable(person, departmentId, kind) && !ids.includes(person.id));
  const areaAvailable = areas.some(area => area.id === departmentId);
  const validChoice = available.some(person => person.id === choice);
  const field = (name: string, label: string, value: string | number = '', type = 'text') =>
    <label>{label}<input className="input-base" name={name} type={type} defaultValue={value} required /></label>;

  return <ActionForm action={saveAutomationAction} className="mt-4 grid gap-3 sm:grid-cols-2" refreshOnSuccess>
    <input type="hidden" name="kind" value="SUBSTITUTION" />
    {existing && <><input type="hidden" name="id" value={existing.id} /><input type="hidden" name="version" value={existing.version} /></>}
    {field('name', 'Nombre', existing?.name)}
    <label>Área<select name="departmentId" aria-label="Área de suplencias" className="input-base" required value={departmentId}
      onChange={event => { setDepartmentId(event.target.value); setChoice(''); }}>
      {!areaAvailable && <option value={departmentId}>Área no disponible; selecciona una activa</option>}
      {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
    </select></label>
    <label>Trabajo<select name="workKind" aria-label="Trabajo" className="input-base" value={kind}
      onChange={event => { setKind(event.target.value as SubstitutionWorkKind); setChoice(''); }}>
      <option value="task">Tarea</option><option value="entry">Novedad</option><option value="housekeeping">Housekeeping</option>
    </select></label>
    <label>Condición<select name="trigger" aria-label="Condición" className="input-base" defaultValue={config?.trigger ?? 'UNASSIGNED'}>
      <option value="UNASSIGNED">Sin responsable</option><option value="UNRECEIVED">Asignado sin recibir</option><option value="OVERDUE">Vencido</option><option value="BLOCKED">Bloqueado</option>
    </select></label>
    <label>Prioridad<select name="priority" aria-label="Prioridad" className="input-base" defaultValue={config?.priority ?? ''}>
      <option value="">Cualquiera</option>{['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].map(value => <option key={value}>{value}</option>)}
    </select></label>
    <label>Modo<select name="mode" aria-label="Modo" className="input-base" defaultValue={config?.mode ?? 'PROPOSE'}>
      <option value="PROPOSE">Proponer al coordinador</option><option value="APPLY">Aplicar reasignación autorizada</option>
    </select></label>

    <fieldset className="min-w-0 space-y-3 rounded-lg border border-slate-300 p-3 sm:col-span-2" aria-describedby={`${prefix}-help`}>
      <legend className="px-1 font-semibold">Suplentes, en orden de preferencia</legend>
      <p id={`${prefix}-help`} className="text-sm text-slate-600">El sistema evalúa la primera persona que cumpla las condiciones vigentes. El horario publicado no acredita presencia ni recepción del trabajo.</p>
      <input type="hidden" name="candidateIds" value={ids.join(',')} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">Agregar persona<select className="input-base" aria-label="Agregar suplente" value={validChoice ? choice : ''} onChange={event => setChoice(event.target.value)}>
          <option value="">{available.length ? 'Elige nombre, cargo y área' : 'Sin más candidatos disponibles en esta área'}</option>
          {available.map(person => <option key={person.id} value={person.id}>{candidateLabel(person)}</option>)}
        </select></label>
        <Button type="button" variant="secondary" disabled={!validChoice || ids.length >= 20} onClick={() => {
          const person = people.find(candidate => candidate.id === choice);
          setIds(current => addOrderedCandidate(current, choice)); setChoice('');
          setAnnouncement(`${person?.name ?? 'Persona'} añadida al final de la lista.`);
        }}>Agregar suplente</Button>
      </div>
      {unavailable.length > 0 && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-900">Hay selecciones anteriores que no corresponden al área o tipo de trabajo actual, o ya no están disponibles. Revisa y quítalas antes de guardar. No se han cambiado ni activado políticas existentes.</p>}
      {ids.length === 0 ? <p className="text-sm text-slate-600">Agrega al menos una persona. Si no hay candidatos, revisa sus cuentas, área y permisos antes de preparar la suplencia.</p> : <ol className="space-y-2" aria-label="Orden de suplentes">
        {ids.map((id, index) => {
          const person = people.find(candidate => candidate.id === id);
          const label = person?.name ?? 'Persona no disponible';
          return <li key={id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2">
            <div className="min-w-0 flex-1"><span className="font-semibold">{index + 1}. {label}</span>
              {person && <p className="break-words text-xs text-slate-600">@{person.username} · {person.role} · {person.areas.map(area => area.name).join(', ') || 'Sin área'}</p>}
              {unavailable.includes(id) && <p className="text-sm text-amber-900">Requiere revisión</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="secondary" disabled={index === 0} aria-label={`Subir a ${label}`} onClick={() => { setIds(current => moveOrderedCandidate(current, id, -1)); setAnnouncement(`${label} ahora ocupa la posición ${index}.`); }}>Subir</Button>
              <Button type="button" size="sm" variant="secondary" disabled={index === ids.length - 1} aria-label={`Bajar a ${label}`} onClick={() => { setIds(current => moveOrderedCandidate(current, id, 1)); setAnnouncement(`${label} ahora ocupa la posición ${index + 2}.`); }}>Bajar</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Quitar a ${label}`} onClick={() => { setIds(current => removeOrderedCandidate(current, id)); setAnnouncement(`${label} quitada de la lista.`); }}>Quitar</Button>
            </div>
          </li>;
        })}
      </ol>}
      <p role="status" aria-live="polite" className="text-sm text-slate-600">{announcement}</p>
      <p className="text-xs text-slate-500">{ids.length} de 20 candidatos. La selección orienta la configuración; el servidor vuelve a comprobar elegibilidad, horario y acceso al ejecutar.</p>
    </fieldset>

    <label>Horario<select name="requirePublishedSchedule" aria-label="Horario" className="input-base" defaultValue={String(config?.requirePublishedSchedule ?? true)}><option value="true">Exigir planificación publicada vigente</option><option value="false">No exigir horario publicado</option></select></label>
    <p className="text-sm sm:col-span-2">La próxima franja publicada se muestra sólo como vista previa al simular. La espera automática futura está en preparación y no puede guardarse ni activarse en esta entrega. Sin suplente actual, se conserva la pausa para intervención. No se reserva una persona ni se confirma recepción.</p>
    {config?.waitForPublishedSchedule&&<p role="alert" className="text-sm sm:col-span-2">Este borrador de preparación no puede activarse. Guardarlo en esta entrega desactiva la espera futura y deja la nueva versión en pausa.</p>}
    {field('receiptMinutes', 'Plazo de recepción, minutos', config?.receiptMinutes ?? 30, 'number')}
    {field('nextAction', 'Motivo y siguiente acción', config?.nextAction)}
    {field('expiresAt', 'Autorización válida hasta', existing?.expiresAt, 'date')}
    <p className="text-sm">Guardar deja la nueva versión en pausa. Simula y revisa antes de habilitarla. Los trabajos iniciados conservan su responsable e historial.</p>
    <SubmitButton disabled={!areaAvailable || !ids.length || unavailable.length > 0}>Guardar versión en pausa</SubmitButton>
  </ActionForm>;
}
