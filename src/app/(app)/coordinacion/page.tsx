import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import {prisma} from '@/lib/prisma';
import {ListFilterBar} from '@/components/ui/list-controls';
import { requirePageUser } from '@/server/auth/guard';
import { getCoordinationBoard, getCoordinationTeam, coordinationMetrics, type CoordinationView, type CoordinationState } from '@/server/services/coordination';
import { CoordinationForm } from '@/components/operational/coordination-form';
import { formatDateTime } from '@/lib/format';
import { RECEIPT_MINUTES, receiptDueAt } from '@/domain/coordination';
import { ENTRY_STATUS_LABEL, TASK_STATUS_LABEL, FOLLOWUP_STATUS_LABEL } from '@/domain/labels';
import { HK_WORK_LABELS } from '@/domain/housekeeping-work';
import { DisclosureCard } from '@/components/ui/card';
import { ContextWorklist } from '@/components/operational/context-worklist';
import { detailHrefWithListContext, listRowAnchor, operationalListHref } from '@/lib/list-navigation';
export const dynamic='force-dynamic';
export const metadata={title:'Coordinación · Pendientes y continuidad'};
export default async function CoordinationPage({searchParams}:{searchParams:Promise<{area?:string;mios?:string;pagina?:string;historial?:string;vista?:string;q?:string;estado?:string;responsable?:string;fecha?:string}>}){
  const user=await requirePageUser({allowAreaOperation:true});const p=await searchParams;
  const area=user.departmentId?await prisma.department.findUnique({where:{id:user.departmentId},select:{key:true}}):null;
  const maintenance=area?.key==='MANTENIMIENTO' && !user.isSystemAdmin;
  const departmentId=p.area?.trim()||(maintenance?user.departmentId??undefined:undefined);
  const allowedViews:CoordinationView[]=['all','reception','unassigned','unreceived','blocked','clarification','carryover'];
  const view=allowedViews.includes(p.vista as CoordinationView)?p.vista as CoordinationView:'all';
  const state=['abierto','atencion','bloqueado','revision','resuelto'].includes(p.estado??'')?p.estado as CoordinationState:undefined;
  const history=state?state==='resuelto':p.historial==='1';
  const board=await getCoordinationBoard(user,{departmentId,mine:p.mios==='1',page:Number(p.pagina)||1,history,view,q:p.q,ownerId:p.responsable,state,date:p.fecha});
  const areaIds=departmentId?[departmentId]:board.departments.map(area=>area.id);
  const teams=await Promise.all(areaIds.map(async id=>[id,await getCoordinationTeam(user,id)] as const));
  const teamByArea=new Map(teams);const team=departmentId?teamByArea.get(departmentId)??[]:[];const people=[...new Map(teams.flatMap(([,team])=>team).map(person=>[person.id,person])).values()];
  const metrics=coordinationMetrics(board.rows);
  const query=(changes:Record<string,string>)=>operationalListHref('/coordinacion',{...p,area:departmentId??'',vista:view,...changes}).split('?')[1]??'';
  const listHref=operationalListHref('/coordinacion',p);
  const href=(page:number)=>`/coordinacion?${query({pagina:String(page)})}`;
  const shortcuts=maintenance?[['Por revisar',{vista:'all',mios:'',historial:'',estado:''}],['Mi trabajo',{vista:'all',mios:'1',historial:'',estado:''}],['Impedimentos',{vista:'blocked',mios:'',historial:'',estado:''}],['Aclaraciones',{vista:'clarification',mios:'',historial:'',estado:''}],['Resultados por devolver',{vista:'all',mios:'1',historial:'1',estado:''}]] as const:[['Coordinar pendientes',{vista:'all',mios:'',historial:'',estado:''}],['Mis responsabilidades',{vista:'all',mios:'1',historial:'',estado:''}],['Resultados recibidos',{vista:'all',mios:'',historial:'1',estado:''}],['Sin responsable',{vista:'unassigned',mios:'',historial:'',estado:''}],['Continuidad',{vista:'carryover',mios:'',historial:'',estado:''}]] as const;
  const labels:Record<string,string>={...ENTRY_STATUS_LABEL,...TASK_STATUS_LABEL,...HK_WORK_LABELS,...FOLLOWUP_STATUS_LABEL};
  return <div className="mx-auto max-w-6xl space-y-4 surface-enter">
    <header><h1 className="text-xl font-semibold text-petrol-900">{maintenance?'Mi trabajo · Mantenimiento':'Coordinación y continuidad'}</h1><p className="mt-1 text-sm text-slate-600">Qué sigue, quién lo recibe y dónde registrar el resultado. Los pendientes permanecen aquí entre turnos.</p></header>

    <nav aria-label="Vistas de coordinación" className="flex flex-wrap gap-2 text-sm">{shortcuts.slice(0,3).map(([label,changes])=><Link key={label} href={'/coordinacion?'+query({...changes,pagina:'1',responsable:''})} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-petrol-800">{label}</Link>)}<details className="rounded-lg border border-slate-200 px-3 py-2"><summary className="cursor-pointer">Más vistas</summary><div className="mt-3 flex flex-wrap gap-3">{([['reception','Solicitudes de Recepción'],['unassigned','Sin responsable'],['unreceived','Sin confirmar'],['blocked','Impedimentos'],['clarification','Aclaraciones'],['carryover','Turnos anteriores']] as Array<[CoordinationView,string]>).map(([key,label])=><Link key={key} className="underline" href={'/coordinacion?'+query({vista:key,pagina:'1',historial:'',estado:''})}>{label}</Link>)}</div></details></nav>
    <ListFilterBar clearHref="/coordinacion?area=&vista=all" searchValue={p.q} searchPlaceholder="Buscar folio, asunto o habitación…">
      <input type="hidden" name="vista" value={view}/>
      <label className="min-w-0 text-sm">Área<select className="input-base mt-1" name="area" defaultValue={departmentId??''}><option value="">Todas las áreas accesibles</option>{board.departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label className="min-w-0 text-sm">Estado<select className="input-base mt-1" name="estado" defaultValue={state??''}><option value="">{history?'Resultados':'Pendientes'}</option><option value="abierto">Abierto / por recibir</option><option value="atencion">En atención</option><option value="bloqueado">Con impedimento</option><option value="revision">Por revisar</option><option value="resuelto">Resuelto</option></select></label>
      <details className="w-full border-t border-slate-100 pt-2"><summary className="cursor-pointer text-sm font-medium">Más filtros</summary><div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">Responsable<select className="input-base mt-1" name="responsable" defaultValue={p.responsable??(p.mios==='1'?user.id:'')}><option value="">Todos dentro de mi acceso</option><option value={user.id}>Mis responsabilidades</option>{people.filter(u=>u.id!==user.id).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="text-sm">Fecha de plazo<input className="input-base mt-1" name="fecha" type="date" defaultValue={p.fecha}/></label>
        <label className="text-sm">Vista<select className="input-base mt-1" name="historial" defaultValue={history?'1':''}><option value="">Pendientes</option><option value="1">Resultados</option></select></label>
      </div></details>
    </ListFilterBar>


    <details className="rounded-md border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-petrol-800">Otros módulos y herramientas</summary><div className="mt-3 space-y-3">
    <Link className="inline-block rounded-lg bg-petrol-800 px-3 py-2 text-sm font-semibold text-white" href={`/coordinacion/areas${departmentId?`?area=${departmentId}`:''}`}>Bandeja de áreas · Por revisar</Link>
    <Link className="underline text-sm" href="/coordinacion/indicadores">Resumen e indicadores por período</Link>
    <div className="flex flex-wrap gap-3 text-sm">{user.permissions.includes('entry.create')&&<Link className="underline" href="/libro">Registrar novedad o incidencia</Link>}{user.permissions.some(v=>v.startsWith('housekeeping.'))&&<Link className="underline" href="/housekeeping">Trabajo de Housekeeping</Link>}{user.permissions.some(v=>v==='shift.start'||v==='shift.manage')&&<Link className="underline" href="/turno">Entrega y recepción de turno</Link>}{user.permissions.includes('cash.view')&&<Link className="underline" href="/caja">Caja y arqueos</Link>}{user.permissions.includes('key.assign')&&<Link className="underline" href="/llaves">Llaves</Link>}{user.permissions.some(v=>v==='custody.view'||v==='custody.manage')&&<Link className="underline" href="/custodia">Objetos olvidados y custodia</Link>}</div>
    <nav className="flex flex-wrap gap-4 text-sm"><Link className="underline" href="/fronti/procedimientos">Mis procedimientos de Fronti</Link>{user.permissions.includes('system.configure')&&<Link className="underline" href="/coordinacion/automatizaciones">Reglas y procedimientos</Link>}</nav>
      <Link className="block text-sm underline" href="/turno/cambios">Qué cambió desde mi último turno</Link>
    </div></details>
    <DisclosureCard title={`${board.total}${board.totalExact?'':'+'} asuntos ${history?'en resultados':'pendientes'} dentro de tu acceso`} description="Resumen del filtro actual y tiempos observados." contentClassName="space-y-2 p-4"><p className="text-sm">En esta página: {metrics.unassigned} sin responsable · {metrics.unreceived} sin recepción registrada · {metrics.overdue} con plazo vencido · {metrics.blocked} con impedimento.</p><p className="text-xs text-slate-600">Confirmación: {metrics.confirmation.minutes??'—'} min ({metrics.confirmation.samples} muestras) · Inicio tras recepción: {metrics.attention.minutes??'—'} min ({metrics.attention.samples} muestras) · Resolución desde inicio: {metrics.resolution.minutes??'—'} min ({metrics.resolution.samples} muestras). Promedios de los registros visibles; sin tiempos inventados para el historial.</p><p className="text-xs text-slate-600">Las nuevas asignaciones requieren recepción en {RECEIPT_MINUTES} minutos desde su inicio disponible. La recepción no confirma asistencia ni resuelve el trabajo.</p></DisclosureCard>
    {board.byArea.length>0&&<DisclosureCard title="Carga por área dentro de tu acceso" description="Distribución de pendientes e impedimentos por área."><ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">{board.byArea.map(a=><li key={a.departmentId}><Link className="underline" href={'/coordinacion?'+query({area:a.departmentId,pagina:'1'})}>{a.name}</Link> · {a.total} asuntos · {a.blocked} con impedimento</li>)}</ul><p className="mt-2 text-xs text-slate-600">{board.totalExact?'Incluye todas las páginas del filtro. Las tareas vinculadas se agrupan bajo su asunto.':'Resumen acotado a los primeros 5.000 registros por fuente del filtro. Usa búsqueda, área, fecha o estado para profundizar sin cargar todo el historial.'}</p></DisclosureCard>}
    {team.length>0&&<details className="card p-3"><summary className="cursor-pointer text-sm font-semibold">Equipo del área y horario actual</summary><p className="my-2 text-xs text-slate-600">El horario publicado orienta la asignación. La disponibilidad real se confirma con la persona.</p><ul className="grid gap-1 text-sm sm:grid-cols-2">{team.map(u=><li key={u.id}>{u.name} · {u.scheduled?'Horario vigente':u.scheduleVisible?'Sin horario vigente':'Horario fuera de tu acceso'}</li>)}</ul></details>}
    <ContextWorklist href={listHref} scope={user.id} label={`${history?'Resultados':'Trabajo pendiente'} · página ${board.page}`} rows={board.rows.map(r=>{
      const id=listRowAnchor(r.kind,r.id);
      const title=r.source?`Asunto #${r.source.humanId} · ${r.title}`:`#${r.humanId} · ${r.title}`;
      const returnTo=`${listHref}#${id}`;
      const linkedHref=(href:string)=>detailHrefWithListContext(href,listHref,id);
      const receiptDeadline=receiptDueAt(r.assignedAt,r.availableAt);
      return {id,title,href:r.href,summary:<div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words font-semibold text-petrol-900">{title}</h3><span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{labels[r.status]??r.status}</span></div>
        <p className="text-sm text-slate-700">{r.department} · Responsable: <strong>{r.owner}</strong></p>
        <p className="line-clamp-2 break-words text-sm text-slate-700"><span className="font-medium">Siguiente acción:</span> {r.nextAction}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{r.kind==='followup'?'Continuidad de Supervisión':r.receivedAt?`Recibido: ${formatDateTime(r.receivedAt)}`:'Recepción pendiente o sin registro histórico'}</span>{r.dueAt&&<span>Plazo: {formatDateTime(r.dueAt)}</span>}{r.children.length>0&&<span>{r.children.length} {r.children.length===1?'vínculo al asunto':'vínculos al asunto'}</span>}</div>
      </div>,children:<>
        <section className="space-y-3" aria-label="Contexto del trabajo">
          <div className="flex flex-wrap gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium">{labels[r.status]??r.status}</span><span className="text-sm text-slate-600">{r.department}</span></div>
          <p className="text-sm">Responsable: <strong>{r.owner}</strong></p>
          <div className="rounded-lg border border-petrol-200 bg-petrol-50 p-3"><h3 className="text-sm font-semibold text-petrol-900">Siguiente acción</h3><p className="mt-1 whitespace-pre-wrap text-sm">{r.nextAction}</p></div>
          <p className="text-xs text-slate-600">{r.kind==='followup'?'Continuidad de Supervisión; recepción en el trabajo vinculado':r.receivedAt?`Recibido: ${formatDateTime(r.receivedAt)}`:'Recepción pendiente o sin registro histórico'}{r.dueAt?` · Plazo: ${formatDateTime(r.dueAt)}`:''}{!r.receivedAt&&receiptDeadline?` · Confirmar antes de ${formatDateTime(receiptDeadline)}`:''}</p>
          {r.source&&<p className="text-sm">Origen: <Link className="font-medium underline" href={linkedHref(r.source.href)}>Asunto #{r.source.humanId}</Link></p>}
        </section>
        {r.children.length>0&&<section aria-label="Trabajo vinculado al mismo asunto"><h3 className="text-sm font-semibold text-petrol-900">Trabajo vinculado al mismo asunto</h3><ul className="mt-2 space-y-2 text-sm">{r.children.map(c=><li key={c.href}><Link className="underline" href={linkedHref(c.href)}>{c.label}</Link></li>)}</ul></section>}
        <Link className="inline-block text-sm font-medium underline" href={linkedHref(r.href)}>Abrir trabajo, atender y registrar resultado →</Link>
      {!history&&(r.kind==='entry'||r.kind==='task')&&r.nextAction.startsWith('Aclaración requerida:')&&(r.createdById===user.id||r.canAssign)&&<details open={view==='clarification'}><summary className="cursor-pointer text-sm font-medium">Responder aclaración</summary><div className="mt-3 max-w-xl"><p className="mb-2 text-sm text-amber-900">{r.nextAction}</p><CoordinationForm returnTo={returnTo} id={r.id} kind={r.kind} updatedAt={r.updatedAt.toISOString()} requestKey={randomUUID()} action="RESPONDER_ACLARACION" ownerId={r.ownerId} nextAction="" team={[]}/></div></details>}
      {!history&&(r.kind==='entry'||r.kind==='task')&&(r.ownerId===user.id||r.canAssign)&&<details><summary className="cursor-pointer text-sm font-medium">Recepción, siguiente acción y relevo</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">{r.ownerId===user.id&&<div className="space-y-3"><CoordinationForm returnTo={returnTo} id={r.id} kind={r.kind} updatedAt={r.updatedAt.toISOString()} requestKey={randomUUID()} action={r.receivedAt?'SIGUIENTE':'RECIBIR'} ownerId={r.ownerId} nextAction={r.nextAction} team={[]}/>{r.receivedAt&&<details><summary className="cursor-pointer text-sm">Necesito una aclaración</summary><div className="mt-2"><CoordinationForm returnTo={returnTo} id={r.id} kind={r.kind} updatedAt={r.updatedAt.toISOString()} requestKey={randomUUID()} action="ACLARACION" ownerId={r.ownerId} nextAction="" team={[]}/></div></details>}</div>}{r.canAssign&&(r.departmentId&&(teamByArea.get(r.departmentId)?.length??0)>0?<CoordinationForm returnTo={returnTo} id={r.id} kind={r.kind} updatedAt={r.updatedAt.toISOString()} requestKey={randomUUID()} action="ASIGNAR" ownerId={r.ownerId} nextAction={r.nextAction} team={teamByArea.get(r.departmentId!)??[]}/>:<p className="text-sm">No hay equipo asignable en el área de este asunto. Revisa el área o las cuentas habilitadas.</p>)}</div></details>}
      </>};
    })}/>
    <nav className="flex justify-between text-sm" aria-label="Páginas de coordinación">{board.page>1?<Link href={href(board.page-1)}>← Anterior</Link>:<span/>}{board.hasMore&&<Link href={href(board.page+1)}>Siguiente →</Link>}</nav>
  </div>;
}
