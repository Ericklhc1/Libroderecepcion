'use client';
import {useState} from 'react';
import {Dialog} from '@/components/ui/dialog';
import {ActionForm,Field,Input,Select} from '@/components/ui/form';
import {SubmitButton} from '@/components/ui/button';
import {requestSubjectAttentionAction} from './navigation-action';
export function SubjectAttentionDialog({entryId,revision,requestKey,areas,room}:{entryId:string;revision:string;requestKey:string;areas:Array<{value:string;label:string;needsLocation:boolean}>;room:string|null}){
  const [area,setArea]=useState('');
  return <Dialog title="Solicitar atención" trigger="Solicitar atención" triggerVariant="gold" width="sm" description="Conserva el folio, la descripción, el origen y el plazo. El resultado se verá en este asunto.">
    <ActionForm action={requestSubjectAttentionAction}>
      <input type="hidden" name="entryId" value={entryId}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="requestKey" value={requestKey}/>
      <Field label="Quién debe atender" name="departmentId"><Select name="departmentId" required value={area} onChange={e=>setArea(e.target.value)} placeholder="Seleccionar área" options={areas}/></Field>
      {room?<p className="text-sm">Habitación {room} · contexto incluido.</p>:areas.find(a=>a.value===area)?.needsLocation?<Field label="Ubicación" name="location" hint="Necesaria para Housekeeping cuando el asunto no tiene habitación."><Input name="location" required maxLength={160}/></Field>:null}
      <p className="text-sm text-slate-600">El área asigna y confirma la recepción. No se cierra el asunto automáticamente.</p>
      <SubmitButton pendingLabel="Solicitando…">Enviar solicitud</SubmitButton>
    </ActionForm>
  </Dialog>;
}
