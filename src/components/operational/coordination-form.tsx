'use client';
import { ActionForm, Field, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { coordinateWorkFormAction } from './navigation-action';
type Props={returnTo:string;id:string;kind:'entry'|'task';updatedAt:string;requestKey:string;action:'RECIBIR'|'ASIGNAR'|'SIGUIENTE'|'ACLARACION'|'RESPONDER_ACLARACION';ownerId:string|null;nextAction:string;team:{id:string;name:string;scheduled:boolean;scheduleVisible:boolean}[]};
export function CoordinationForm(p:Props){return <ActionForm action={coordinateWorkFormAction} className="space-y-2">
  <input type="hidden" name="returnTo" value={p.returnTo}/>
  {(['id','kind','updatedAt','requestKey','action'] as const).map(name=><input key={name} name={name} type="hidden" value={p[name]}/>)}
  {p.action==='ASIGNAR'&&<Field label="Responsable del área" name="ownerId"><Select name="ownerId" required defaultValue={p.ownerId??''} options={[{value:'',label:'Seleccionar usuario'},...p.team.map(u=>({value:u.id,label:`${u.name}${u.scheduled?' · Horario vigente':u.scheduleVisible?' · Sin horario vigente':''}`}))]}/></Field>}
  <Field label={p.action==='ACLARACION'?'Qué necesitas aclarar':p.action==='RESPONDER_ACLARACION'?'Respuesta / información solicitada':'Siguiente acción / instrucciones del relevo'} name="nextAction"><Textarea name="nextAction" required maxLength={1000} defaultValue={['Asignar responsable','Confirmar recepción'].includes(p.nextAction)?'':p.nextAction}/></Field>
  <SubmitButton size="sm" pendingLabel="Guardando…">{p.action==='RECIBIR'?'Confirmar recepción':p.action==='ASIGNAR'?'Asignar y solicitar recepción':p.action==='ACLARACION'?'Solicitar aclaración':p.action==='RESPONDER_ACLARACION'?'Responder aclaración':'Guardar siguiente acción'}</SubmitButton>
</ActionForm>;}
