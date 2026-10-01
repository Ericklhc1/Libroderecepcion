'use client';
import { useState } from 'react';
import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { lendStaffKeysAction } from '@/server/actions/key-staff';
type Destination = { id: string; name: string; kind: 'ROOM' | 'AREA' };
export function StaffLoanForm({ initialRequestKey, departments, collaborators, authorizers, keys, sharedKeys, privateKeys, destinations }: {
  initialRequestKey: string;
  departments: { id: string; name: string }[];
  collaborators: { id: string; name: string; departmentIds: string[] }[];
  authorizers: { id: string; name: string }[];
  keys: { id: string; code: string; destination: Destination }[];
  sharedKeys: { id: string; code: string; destination: string }[];
  privateKeys: { id: string; code: string; destination: string }[];
  destinations: Destination[];
}) {
  const [department, setDepartment] = useState('');
  const [requestKey, setRequestKey] = useState(initialRequestKey);
  const [selected, setSelected] = useState<string[]>([]);
  const [privateDestination, setPrivateDestination] = useState<Record<string,string>>({});
  const extraKeys = [...sharedKeys.map(k=>({...k,source:'public' as const})),...privateKeys.map(k=>({...k,source:'private' as const}))];
  const toggle = (id: string) => setSelected(old => old.includes(id) ? old.filter(k => k !== id) : [...old, id]);
  return <ActionForm action={lendStaffKeysAction} resetOnSuccess={false} onSuccess={() => { setSelected([]); setRequestKey(crypto.randomUUID()); }}>
    <input type="hidden" name="requestKey" value={requestKey} />
    <div className="grid gap-3 sm:grid-cols-2"><Field label="1. Área receptora (obligatorio)" name="departmentId"><select className="input-base w-full" id="departmentId" name="departmentId" required value={department} onChange={e => setDepartment(e.target.value)}><option value="">Seleccionar área…</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
    </div>

    <fieldset className="mt-4"><legend className="font-semibold">2. Habitaciones o áreas y llaves · selección múltiple</legend><p className="mb-2 text-sm text-slate-600">Selecciona cada llave física que se entregará. El registro identifica quién informó la autorización.</p>
      <div className="grid max-h-80 gap-2 overflow-auto sm:grid-cols-2">{keys.map(k => <label key={k.id} className="flex min-h-11 items-center gap-2 rounded border p-2"><input type="checkbox" name="keySelection" value={k.id} checked={selected.includes(k.id)} onChange={() => toggle(k.id)} /><span>{k.destination.name} · {k.code}</span><input type="hidden" name={`key:${k.id}`} value={k.id} /><input type="hidden" name={`source:${k.id}`} value="public" /><input type="hidden" name={`destination:${k.id}`} value={k.destination.id} /><input type="hidden" name={`kind:${k.id}`} value={k.destination.kind} /></label>)}</div>
      {extraKeys.length > 0 && <div className="mt-3 space-y-2"><p className="font-medium">Copias libres y mi stock</p>{extraKeys.map(k => { const destination = destinations.find(d => d.id === privateDestination[k.id]); return <div key={k.id} className="rounded border p-2"><label className="flex min-h-10 items-center gap-2"><input type="checkbox" name="keySelection" value={k.id} checked={selected.includes(k.id)} onChange={() => toggle(k.id)} />{k.code} · {k.source === 'private' ? 'Mi stock' : 'Recepción'} · {k.destination}</label><select className="input-base w-full" aria-label={`Destino de ${k.code}`} required={selected.includes(k.id)} value={privateDestination[k.id] ?? ''} onChange={e => setPrivateDestination(old => ({...old,[k.id]:e.target.value}))}><option value="">Seleccionar habitación o área…</option>{destinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><input type="hidden" name={`key:${k.id}`} value={k.id} /><input type="hidden" name={`source:${k.id}`} value={k.source} /><input type="hidden" name={`destination:${k.id}`} value={destination?.id ?? ''} /><input type="hidden" name={`kind:${k.id}`} value={destination?.kind ?? ''} /></div>; })}</div>}
    </fieldset><div className="mt-4 grid gap-3 sm:grid-cols-2">    <Field label="3. Colaborador (opcional)" name="collaboratorId"><select className="input-base w-full" key={department} id="collaboratorId" name="collaboratorId" disabled={!department}><option value="">Personal del área · sin colaborador específico</option>{collaborators.filter(c => c.departmentIds.includes(department)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label="4. Autorizado por (Supervisor o superior)" name="authorizedById"><select className="input-base w-full" id="authorizedById" name="authorizedById" required><option value="">Seleccionar persona…</option>{authorizers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Observación" name="notes"><Input name="notes" maxLength={300} /></Field></div><SubmitButton disabled={!selected.length || !department} pendingLabel="Registrando entrega…">Entregar {selected.length} llave(s) a personal</SubmitButton>
  </ActionForm>;
}
