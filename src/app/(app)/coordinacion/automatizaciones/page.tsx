import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { DisclosureCard } from '@/components/ui/card';
import { saveAutomationAction, simulateAutomationAction, setAutomationStateAction } from '@/components/operational/navigation-action';
import { procedureSchema, escalationSchema, substitutionSchema } from '@/domain/operational-automation';
import { hotelDateKey } from '@/domain/time';
import { formatDateTime } from '@/lib/format';
import { SubstitutionForm } from '@/components/operational/substitution-form';
import { hkHas, isHkFocused } from '@/domain/housekeeping-work';
import type { PermissionKey } from '@/lib/permissions';
import type { SubstitutionCandidate } from '@/domain/substitution-candidates';

export const dynamic='force-dynamic';
const css='input-base w-full';
function field(name:string,label:string,value:string|number='',type='text') {
  return <label>{label}<input name={name} type={type} defaultValue={value} required className={css}/></label>;
}
function textArea(name:string,label:string,value='') {
  return <label>{label}<textarea name={name} defaultValue={value} required className={css}/></label>;
}
export default async function AutomationsPage({searchParams}:{searchParams:Promise<{editar?:string}>}) {
  const user=await requirePagePermission('system.configure');
  const params=await searchParams;
  const [areas,people,policies,editing]=await Promise.all([
    prisma.department.findMany({where:{active:true},select:{id:true,name:true}}),
    prisma.user.findMany({where:{active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true}},select:{id:true,name:true,username:true,department:{select:{id:true,name:true}},role:{select:{name:true,key:true,permissions:{select:{permission:{select:{key:true}}}}}},scheduleCollaborator:{select:{active:true,memberships:{where:{active:true,department:{active:true}},select:{department:{select:{id:true,name:true}}}}}}},orderBy:{name:'asc'}}),
    prisma.operationalAutomation.findMany({where:{ownerId:user.id},orderBy:{createdAt:'desc'},take:50,include:{runs:{orderBy:{startedAt:'desc'},take:5}}}),
    params.editar ? prisma.operationalAutomation.findFirst({where:{id:params.editar,ownerId:user.id,revokedAt:null}}) : null,
  ]);
  if(params.editar&&!editing)notFound();
  const procedure=editing?.kind==='PROCEDURE'?procedureSchema.parse(editing.configuration):null;
  const rule=editing?.kind==='ESCALATION'?escalationSchema.parse(editing.configuration):null;
  const substitution=editing?.kind==='SUBSTITUTION'?substitutionSchema.parse(editing.configuration):null;
  const candidates: SubstitutionCandidate[] = people.map(person => {
    const access = { roleKey: person.role.key, permissions: person.role.permissions.map(row => row.permission.key as PermissionKey) };
    const membershipAreas = person.scheduleCollaborator?.active ? person.scheduleCollaborator.memberships.map(row => row.department) : [];
    const departments = [...(person.department ? [person.department] : []), ...membershipAreas];
    return { id: person.id, name: person.name, username: person.username, role: person.role.name,
      areas: [...new Map(departments.filter(area => areas.some(active => active.id === area.id)).map(area => [area.id, area])).values()],
      workKinds: [...(!isHkFocused(access) ? ['task' as const, 'entry' as const] : []), ...(hkHas(access, 'housekeeping.work') ? ['housekeeping' as const] : [])],
    };
  });
  const area=(selected?:string)=><label>Área<select aria-label="Área" name="departmentId" required defaultValue={selected} className={css}>{selected&&!areas.some(a=>a.id===selected)&&<option value={selected}>Área actual no disponible — selecciona un reemplazo para cambiarla</option>}{areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>;
  const person=(name:string,label:string,selected?:string)=><label>{label}<select aria-label={label} name={name} required defaultValue={selected} className={css}>{selected&&!people.some(p=>p.id===selected)&&<option value={selected}>Responsable actual no disponible — selecciona un reemplazo para cambiarlo</option>}{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
  const identity=(kind:string)=><><input type="hidden" name="kind" value={kind}/>{editing?.kind===kind&&<><input type="hidden" name="id" value={editing.id}/><input type="hidden" name="version" value={editing.version}/></>}</>;
  const explain=(policy: (typeof policies)[number])=>{
    const department=areas.find(a=>a.id===policy.departmentId)?.name??'Área no disponible';
    if(policy.kind==='PROCEDURE') {
      const config=procedureSchema.parse(policy.configuration), responsible=people.find(p=>p.id===config.ownerId)?.name??'Responsable no elegible';
      return `${department}: crear una tarea para ${responsible} a las ${config.localTime} de Santiago, días ${config.weekdays.map(d=>['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d]).join(', ')} desde ${config.startDate}. Prioridad ${config.priority}, plazo ${config.deadlineMinutes} minutos. Evidencia: ${config.evidenceRequired}. Siguiente acción: ${config.nextAction}. Validación independiente: ${config.requiresIndependentValidation?'sí':'no'}.`;
    }
    if(policy.kind==='SUBSTITUTION'){const c=substitutionSchema.parse(policy.configuration);return `${department}: ${c.mode==='APPLY'?'aplicar':'proponer'} suplencia para ${c.kind}, condición ${c.trigger}, candidatos ordenados ${c.candidateIds.map(id=>people.find(p=>p.id===id)?.name??'No elegible').join(', ')}. ${c.requirePublishedSchedule?'Exige horario publicado vigente.':'No exige horario publicado.'} No acredita presencia. Una suplencia por registro y política; pausa o revoca desde sus controles.`;}
    const config=escalationSchema.parse(policy.configuration), recipient=people.find(p=>p.id===config.recipientId)?.name??'Destinatario no elegible';
    const trigger={UNASSIGNED:'sin responsable',UNRECEIVED:`sin recibir después de ${config.receiptMinutes} minutos desde que está disponible`,OVERDUE:'con su plazo vencido',BLOCKED:'bloqueado'}[config.trigger];
    return `${department}: cuando un trabajo ${config.kind??'de cualquier tipo'}, prioridad ${config.priority??'cualquiera'}, esté ${trigger}, avisar a ${recipient} si conserva autoridad y acceso. Máximo ${config.maxItems} candidatos por evaluación. No crea otra incidencia ni confirma asistencia.`;
  };
  const outcome=(result:unknown)=>{
    if(!result||typeof result!=='object')return null;
    const data=result as Record<string,unknown>;
    const message=typeof data.error==='string'?data.error:typeof data.reason==='string'?data.reason:typeof data.taskId==='string'?'Tarea creada.':typeof data.sourceId==='string'?'Aviso interno conservado para el registro original.':null;
    return message?<p className="text-xs text-slate-600">{message}{typeof data.retry==='string'?` ${data.retry}`:''}{typeof data.taskId==='string'&&<Link className="ml-2 underline" href={`/tareas/${data.taskId}`}>Abrir tarea</Link>}</p>:null;
  };
  const expiry=(kind:string)=>field('expiresAt','Autorización válida hasta',editing?.kind===kind?hotelDateKey(editing.expiresAt):'','date');
  return <div className="mx-auto max-w-5xl space-y-5">
    <header><h1 className="text-xl font-semibold">Reglas y procedimientos</h1><p>Prepara, simula y revisa. Guardar una versión la deja en pausa; no modifica trabajos iniciados.</p><p className="text-sm text-amber-800">{process.env.AROH_AUTOMATION_EXECUTION_ENABLED==='true'?'Ejecución habilitada para políticas activas.':'La ejecución automática está deshabilitada. Puedes simular sin generar trabajo ni avisos.'}</p></header>
    <nav className="flex gap-4"><Link className="underline" href="/coordinacion">Volver a Coordinación</Link>{editing&&<Link className="underline" href="/coordinacion/automatizaciones">Salir de edición</Link>}</nav>
    <details className="card p-4" open={!!procedure} key={'procedure-'+(procedure?editing?.version:'new')}>
      <summary className="cursor-pointer font-semibold">{procedure?'Nueva versión del procedimiento':'Nuevo procedimiento o mantenimiento preventivo'}</summary>
      <ActionForm action={saveAutomationAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        {identity('PROCEDURE')}{field('name','Nombre',procedure?editing!.name:'')}{area(procedure?editing!.departmentId:undefined)}{person('ownerId','Responsable',procedure?.ownerId)}
        <label>Prioridad<select name="priority" defaultValue={procedure?.priority??'MEDIA'} className={css}>{['BAJA','MEDIA','ALTA','CRITICA'].map(v=><option key={v}>{v}</option>)}</select></label>
        {textArea('description','Instrucción',procedure?.description)}{field('nextAction','Siguiente acción',procedure?.nextAction)}{field('evidenceRequired','Evidencia requerida',procedure?.evidenceRequired)}{textArea('checklist','Lista: un punto por línea',procedure?.checklist.join('\n'))}
        {field('startDate','Desde',procedure?.startDate??hotelDateKey(new Date()),'date')}{field('localTime','Hora de Santiago',procedure?.localTime??'08:00','time')}
        <fieldset><legend>Días</legend>{['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((day,i)=><label key={day} className="mr-2 inline-flex gap-1"><input type="checkbox" name="weekdays" value={i} defaultChecked={procedure?.weekdays.includes(i)??false}/>{day}</label>)}</fieldset>
        {field('deadlineHours','Plazo en horas',procedure?procedure.deadlineMinutes/60:24,'number')}{field('catchUpDays','Recuperar días anteriores (0 a 7)',procedure?.catchUpDays??0,'number')}{expiry('PROCEDURE')}
        <p className="text-sm">Como máximo una ocurrencia reciente por ejecución. Requiere evidencia y validación por otra persona autorizada. No acredita asistencia ni inspección automática.</p><SubmitButton>Guardar versión en pausa</SubmitButton>
      </ActionForm>
    </details>
    <details className="card p-4" open={!!rule} key={'rule-'+(rule?editing?.version:'new')}>
      <summary className="cursor-pointer font-semibold">{rule?'Nueva versión de la regla':'Nueva regla de atención'}</summary>
      <ActionForm action={saveAutomationAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        {identity('ESCALATION')}{field('name','Nombre',rule?editing!.name:'')}{area(rule?editing!.departmentId:undefined)}
        <label>Condición<select className={css} name="trigger" defaultValue={rule?.trigger}><option value="UNASSIGNED">Sin responsable</option><option value="UNRECEIVED">Asignado sin recibir</option><option value="OVERDUE">Vencido</option><option value="BLOCKED">Bloqueado</option></select></label>
        {person('recipientId','Avisar a',rule?.recipientId)}
        <label>Tipo de trabajo<select className={css} name="workKind" defaultValue={rule?.kind??''}><option value="">Todos</option><option value="entry">Novedad/incidencia</option><option value="task">Tarea</option><option value="housekeeping">Housekeeping</option><option value="followup">Seguimiento</option></select></label>
        <label>Prioridad<select className={css} name="priority" defaultValue={rule?.priority??''}><option value="">Todas</option>{['BAJA','MEDIA','ALTA','CRITICA'].map(v=><option key={v}>{v}</option>)}</select></label>
        {field('receiptMinutes','Plazo de recepción, minutos',rule?.receiptMinutes??30,'number')}{expiry('ESCALATION')}<SubmitButton>Guardar versión en pausa</SubmitButton>
      </ActionForm>
    </details>
    <details className="card p-4" open={!!substitution} key={'substitution-'+(substitution?editing?.version:'new')}>
      <summary className="cursor-pointer font-semibold">{substitution?'Nueva versión de suplencia':'Nueva política de suplencias'}</summary>
      <SubstitutionForm areas={areas} people={candidates} existing={substitution && editing ? {
        id: editing.id, version: editing.version, name: editing.name, departmentId: editing.departmentId,
        expiresAt: hotelDateKey(editing.expiresAt), configuration: substitution,
      } : undefined} />
    </details>
    <DisclosureCard title="Tus últimas 50 políticas" description="Historial reciente de reglas, simulaciones y estado actual." count={policies.length} contentClassName="space-y-3 p-4">{policies.map(p=><article className="rounded-lg border border-slate-200 space-y-2 p-4" key={p.id}>
      <h3 className="font-semibold">{p.name} · versión {p.version}</h3><p>{p.revokedAt?'Revocada':p.expiresAt<=new Date()?'Caducada':p.enabled?'Activa':'En pausa'} · hasta {formatDateTime(p.expiresAt)}</p>
      <p className="text-sm">{explain(p)}</p><p className="text-xs text-slate-600">Pausar o revocar detiene efectos nuevos y conserva el trabajo generado. Un error de autorización, destino o ejecución pausa la política para revisión.</p><div className="flex flex-wrap gap-2"><ActionForm action={simulateAutomationAction}><input type="hidden" name="id" value={p.id}/><SubmitButton size="sm">Simular</SubmitButton></ActionForm>{!p.revokedAt&&<><a className="underline" href={`/coordinacion/automatizaciones?editar=${p.id}`}>Preparar nueva versión</a><ActionForm action={setAutomationStateAction}><input type="hidden" name="id" value={p.id}/><input type="hidden" name="version" value={p.version}/><select name="state" className="input-base"><option value="pause">Pausar</option><option value="enable">Habilitar política</option><option value="revoke">Revocar</option></select><SubmitButton size="sm">Guardar estado</SubmitButton></ActionForm></>}</div>
      <p className="text-xs text-slate-600">Últimas {p.runs.length} ejecuciones (máximo 5; no representa el historial completo).</p><ul className="text-sm">{p.runs.map(r=><li key={r.id}>{formatDateTime(r.startedAt)} · {r.status==='SUCCEEDED'?'Completada':r.status==='INTERVENTION'?'Requiere intervención':r.status} · versión {r.policyVersion}{outcome(r.result)}</li>)}</ul>
    </article>)}</DisclosureCard>
  </div>;
}
