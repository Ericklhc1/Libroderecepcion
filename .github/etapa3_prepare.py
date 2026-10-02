from pathlib import Path
import json, os, subprocess, urllib.request

REPO='Ericklhc1/Libroderecepcion'
def read(p): return Path(p).read_text()
def write(p,s):
    Path(p).parent.mkdir(parents=True,exist_ok=True)
    Path(p).write_text(s)
def replace(p,a,b):
    s=read(p)
    if s.count(a)!=1: raise RuntimeError(f'Expected one exact anchor in {p}; found {s.count(a)}')
    write(p,s.replace(a,b,1))
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==os.environ['EXPECTED_HEAD']
assert json.loads(read('package.json'))['version']=='1.47.1'

write('src/domain/housekeeping-continuity.ts',r'''/** Context returned by the existing maintenance record, never a commercial room state. */
export type MaintenanceContext = { status:string; resolution?:string|null; deletedAt?:Date|null };
export function maintenanceAllowsContinuation(entry:MaintenanceContext|null):boolean {
  return !entry || (!entry.deletedAt && ['RESUELTO','CERRADO'].includes(entry.status) && !!entry.resolution?.trim());
}
export function hkNextAction(work:{status:string;assignedToId:string|null;acknowledgedAt:Date|null;maintenanceEntry:MaintenanceContext|null}):string {
  if (work.status==='CANCELADO') return 'Consultar el motivo de cancelación y decidir si corresponde reabrir.';
  if (work.status==='RESUELTO') return work.maintenanceEntry&&!maintenanceAllowsContinuation(work.maintenanceEntry)
    ? 'El trabajo conserva su resultado. Supervisión debe revisar la incidencia de Mantenimiento que volvió a requerir atención.'
    : 'Resultado disponible para Recepción y las personas autorizadas.';
  if (!work.assignedToId) return 'Asignar una persona habilitada del área.';
  if (work.maintenanceEntry&&!maintenanceAllowsContinuation(work.maintenanceEntry)) return work.maintenanceEntry.deletedAt
    ? 'La incidencia fue archivada. Coordinación debe revisarla antes de continuar.'
    : 'Mantenimiento debe informar el resultado antes de continuar este trabajo.';
  if (work.status==='BLOQUEADO') return work.maintenanceEntry
    ? 'Revisar el resultado de Mantenimiento y retomar con una observación.'
    : 'Resolver el impedimento y registrar cómo se continuará.';
  if (work.status==='POR_REVISAR') return 'Otra persona habilitada debe revisar el trabajo y aprobar o pedir una corrección.';
  if (!work.acknowledgedAt) return 'Confirmar recepción y comenzar el trabajo asignado.';
  return work.status==='EN_GESTION' ? 'Finalizar indicando lo realizado o informar un impedimento.' : 'Comenzar el trabajo asignado.';
}
export const HK_MAINTENANCE_EVENT_LABELS:Record<string,string> = {
  MANTENIMIENTO_RESULTADO:'Resultado de Mantenimiento',
  MANTENIMIENTO_REABIERTO:'Mantenimiento vuelve a requerir atención',
  MANTENIMIENTO_AVANCE:'Avance de Mantenimiento',
};
''')
write('src/server/services/housekeeping-maintenance.ts',r'''import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError } from '@/server/errors';

type EntryResult = {id:string;humanId:number;status:string;resolution:string|null};
/** Runs inside the native entry mutation. A failed feedback write rolls back the whole transition. */
export async function publishHkMaintenanceUpdate(tx:Prisma.TransactionClient,user:CurrentUser,before:EntryResult,after:EntryResult) {
  if (before.status===after.status && before.resolution===after.resolution) return;
  await tx.$queryRaw`SELECT "id" FROM "HousekeepingRequest" WHERE "maintenanceEntryId"=${after.id} FOR UPDATE`;
  const request=await tx.housekeepingRequest.findUnique({where:{maintenanceEntryId:after.id}});
  if (!request || request.workflowVersion!==1 || request.isDemo) return;
  const done=['RESUELTO','CERRADO'].includes(after.status);
  if (done&&!after.resolution?.trim()) throw new RuleError('Indica el resultado de Mantenimiento antes de devolver el trabajo al área solicitante.');
  const reopened=!done&&['RESUELTO','CERRADO'].includes(before.status);
  const action=done?'MANTENIMIENTO_RESULTADO':reopened?'MANTENIMIENTO_REABIERTO':'MANTENIMIENTO_AVANCE';
  const note=`Mantenimiento #${after.humanId}: ${done?'resultado disponible':reopened?'reabierto; requiere atención':'atención en curso'}.${after.resolution?`\n${done?'Resultado':'Resultado anterior o avance, no cierre'}: ${after.resolution}`:''}\nEl trabajo de Housekeeping conserva su estado, responsable e inspección.`;
  // No state, assignment, custody, cash or PMS write: only invalidate stale forms and append evidence.
  if (!(await tx.housekeepingRequest.updateMany({where:{id:request.id,version:request.version},data:{version:{increment:1}}})).count) throw new RuleError('El trabajo cambió mientras se devolvía el resultado. Actualiza antes de continuar.');
  await tx.housekeepingEvent.create({data:{requestId:request.id,actorId:user.id,action,fromStatus:request.status,toStatus:request.status,note}});
  await tx.auditLog.create({data:{entity:'HousekeepingWork',entityId:request.id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',summary:`Housekeeping #${request.humanId}: actualización de Mantenimiento #${after.humanId}`,reason:note}});
  const {notifyHkWork}=await import('./housekeeping-work');
  await notifyHkWork(tx,request,user.id,done?'Mantenimiento: resultado disponible':reopened?'Mantenimiento reabierto: revisar continuidad':'Mantenimiento informó un avance');
}
''')
replace('src/server/services/entries.ts',"import 'server-only';","import 'server-only';\nimport { publishHkMaintenanceUpdate } from './housekeeping-maintenance';")
replace('src/server/services/entries.ts',"    if (updated.type === EntryType.INCIDENCIA) {\n      await ensureIncidentWorkflow(updated.id, tx);","    await publishHkMaintenanceUpdate(tx, user, current, updated);\n    if (updated.type === EntryType.INCIDENCIA) {\n      await ensureIncidentWorkflow(updated.id, tx);")
replace('src/server/services/entries.ts',"    return updated;\n  });\n\n  const completedAt = new Date();","    await publishHkMaintenanceUpdate(tx, user, current, updated);\n    return updated;\n  });\n\n  const completedAt = new Date();")
replace('src/server/services/housekeeping-work.ts',"import 'server-only';","import 'server-only';\nimport { maintenanceAllowsContinuation } from '@/domain/housekeeping-continuity';")
replace('src/server/services/housekeeping-work.ts',"maintenanceEntry: { select: { id: true, humanId: true, status: true, title: true } },","maintenanceEntry: { select: { id: true, humanId: true, status: true, title: true, resolution: true, updatedAt: true, deletedAt: true } },")
replace('src/server/services/housekeeping-work.ts',"    let maintenanceEntryId = current.maintenanceEntryId;",r'''    if (current.maintenanceEntryId && ['COMENZAR','RETOMAR','TERMINAR','APROBAR'].includes(input.action)) {
      // Lock the dependency before the optimistic request update, as the native result publisher does.
      await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${current.maintenanceEntryId} FOR SHARE`;
      const maintenance=await tx.operationalEntry.findUnique({where:{id:current.maintenanceEntryId},select:{status:true,resolution:true,deletedAt:true}});
      if (!maintenance || !maintenanceAllowsContinuation(maintenance)) throw new RuleError('Mantenimiento debe informar un resultado vigente antes de continuar. El impedimento y la inspección se conservan.');
    }
    let maintenanceEntryId = current.maintenanceEntryId;''')
# A notice must not disclose even the existence of work after an area/access grant was revoked.
replace('src/server/services/housekeeping-work.ts',"  const active = await tx.user.findMany({ where: { id: { in: ids }, active: true, deletedAt: null }, select: { id: true } });\n  await notify(active.map(u =>",r'''  const candidates = await tx.user.findMany({ where: { id: { in: ids }, active: true, deletedAt: null }, select: { id: true, role: {select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}} } });
  const active:Array<{id:string}>=[];
  for (const candidate of candidates) {
    const reader={id:candidate.id,roleKey:candidate.role.key,permissions:candidate.role.permissions.map(p=>p.permission.key as PermissionKey)} as CurrentUser;
    if (canAccessHousekeeping(reader) && await tx.housekeepingRequest.count({where:{id:request.id,AND:[await hkWorkVisibility(reader,tx)]}})) active.push({id:candidate.id});
  }
  await notify(active.map(u =>''')
replace('src/app/(app)/admin/housekeeping/page.tsx',"import Link from 'next/link';","import Link from 'next/link';\nimport { hkNextAction, HK_MAINTENANCE_EVENT_LABELS, maintenanceAllowsContinuation } from '@/domain/housekeeping-continuity';")
replace('src/app/(app)/admin/housekeeping/page.tsx',"{r.maintenanceEntry&&<p className=\"text-sm\">Mantenimiento: #{r.maintenanceEntry.humanId} · {r.maintenanceEntry.status.toLowerCase()}{user.permissions.includes('entry.create')&&<Link className=\"ml-2 underline\" href={`/libro/${r.maintenanceEntry.id}`}>Ver incidencia</Link>}</p>}",r'''{r.maintenanceEntry&&<section aria-label="Resultado de Mantenimiento" className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm"><p className="font-medium">Mantenimiento #{r.maintenanceEntry.humanId} · {r.maintenanceEntry.deletedAt?'Archivado':maintenanceAllowsContinuation(r.maintenanceEntry)?'Resultado disponible':'Atención pendiente'}</p>{r.maintenanceEntry.resolution&&<p className="whitespace-pre-wrap break-words"><strong>{maintenanceAllowsContinuation(r.maintenanceEntry)?'Resultado:':'Resultado anterior o avance:'}</strong> {r.maintenanceEntry.resolution}</p>}<p className="text-xs text-slate-600">Última actualización: {formatDateTime(r.maintenanceEntry.updatedAt)}. No finaliza Housekeeping ni modifica la disponibilidad comercial.</p>{user.permissions.includes('entry.create')&&<Link className="inline-block underline" href={`/libro/${r.maintenanceEntry.id}`}>Ver incidencia</Link>}</section>}
          {modern&&<p className="break-words text-sm text-petrol-900"><strong>Siguiente acción:</strong> {hkNextAction(r)}</p>}''')
replace('src/app/(app)/admin/housekeeping/page.tsx',"HK_ACTION_LABELS[e.action as HkWorkAction]??e.action","HK_ACTION_LABELS[e.action as HkWorkAction]??HK_MAINTENANCE_EVENT_LABELS[e.action]??e.action")
replace('src/server/ai/fronti-v2/page-context-tool.ts',"blockReason:r.blockReason,result:r.resolution,inspectedBy:r.inspectedBy?.name??null", "blockReason:r.blockReason,result:r.resolution,inspectedBy:r.inspectedBy?.name??null,maintenance:r.maintenanceEntry?{humanId:r.maintenanceEntry.humanId,status:r.maintenanceEntry.status,result:r.maintenanceEntry.resolution,archived:!!r.maintenanceEntry.deletedAt}:null")
write('src/server/ai/execution/natural-housekeeping.ts',r'''import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {prisma} from '@/lib/prisma';
import {RuleError,NotFoundError} from '@/server/errors';
import {canonicalJson,executionSummary,type FrontiStep} from '@/domain/fronti-execution';
import {hkNextAction,maintenanceAllowsContinuation} from '@/domain/housekeeping-continuity';
import {hkWorkVisibility,getHkWorkday} from '@/server/services/housekeeping-work';
import {coordinationEntries} from '@/server/services/coordination-access';
import {executionActor,prepareExecution,executePlan} from './service';

const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('es');
type Parsed={kind:'query'|'work'|'assign'|'maintenance';humanId:number;action?:string;note:string;name?:string;severity?:string};
/** Only explicit imperatives in the current private message. Other language keeps the existing tool loop. */
export function parseNaturalHousekeeping(message:string):Parsed|null {
  if (/[\n\r¿?]/.test(message)||message.length>3300) return null;
  const text=message.trim();
  const query=/^(?:consulta|muestra|ver) (?:el )?resultado de Housekeeping #([1-9]\d*)\.?$/i.exec(text);
  if(query)return {kind:'query',humanId:Number(query[1]),note:''};
  const assignment=/^asigna (?:el trabajo de )?Housekeeping #([1-9]\d*) a ([^:]+)(?::\s*(.*))?$/i.exec(text);
  if(assignment)return {kind:'assign',humanId:Number(assignment[1]),name:assignment[2]!.trim(),note:assignment[3]?.trim()??''};
  const maintenance=/^finaliza Mantenimiento #([1-9]\d*)(?::\s*(.*))?$/i.exec(text);
  if(maintenance)return {kind:'maintenance',humanId:Number(maintenance[1]),note:maintenance[2]?.trim()??''};
  const request=/^solicita Mantenimiento para Housekeeping #([1-9]\d*)(?: con gravedad (BAJA|MEDIA|ALTA|CRITICA|CRÍTICA))?(?::\s*(.*))?$/i.exec(text);
  if(request)return {kind:'work',humanId:Number(request[1]),action:'MANTENIMIENTO',severity:request[2]?normalize(request[2]).toUpperCase():undefined,note:request[3]?.trim()??''};
  const work=/^(toma|retoma|finaliza|informa impedimento en|aprueba la revision de|aprueba la revisión de) (?:el trabajo de )?Housekeeping #([1-9]\d*)(?::\s*(.*))?$/i.exec(text);
  if(!work)return null;
  const actions:Record<string,string>={toma:'COMENZAR',retoma:'RETOMAR',finaliza:'TERMINAR','informa impedimento en':'IMPEDIMENTO','aprueba la revision de':'APROBAR'};
  return {kind:'work',humanId:Number(work[2]),action:actions[normalize(work[1]!)],note:work[3]?.trim()??''};
}
export async function executeNaturalHousekeeping(message:string,requestKey?:string) {
  const parsed=parseNaturalHousekeeping(message);
  if(!parsed)return null;
  if(!Number.isSafeInteger(parsed.humanId))throw new RuleError('Indica un identificador válido.');
  const user=await executionActor();
  const reply=(text:string)=>({reply:text,confirmations:[]});
  // Transport retries keep the originally authorized fields/version, not a freshly inferred operation.
  if(parsed.kind!=='query'&&requestKey){
    const previous=await prisma.frontiExecutionRequest.findUnique({where:{userId_requestKey:{userId:user.id,requestKey}},include:{execution:true}});
    if(previous){
      const instruction=createHash('sha256').update(canonicalJson(message)).digest('hex');
      if(previous.execution.instruction!==instruction)throw new RuleError('El reintento contiene una instrucción distinta.');
      const result=await executePlan(previous.executionId,true);
      return reply(executionSummary(result.steps)+'\n'+result.href);
    }
  }
  let step:FrontiStep;
  if(parsed.kind==='maintenance'){
    const entry=await prisma.operationalEntry.findFirst({where:{humanId:parsed.humanId,type:'INCIDENCIA',department:{key:'MANTENIMIENTO'},AND:[coordinationEntries(user)]},select:{id:true}});
    if(!entry)throw new NotFoundError();
    if(!parsed.note)return reply('¿Qué hizo Mantenimiento y cuál fue el resultado? Indícalo después de dos puntos; no se ha cambiado el registro.');
    step={action:'changeEntryStatusAction',fields:{id:entry.id,status:'RESUELTO',resolution:parsed.note}};
  }else{
    const work=await prisma.housekeepingRequest.findFirst({where:{humanId:parsed.humanId,workflowVersion:1,isDemo:false,AND:[await hkWorkVisibility(user)]},include:{assignedTo:{select:{name:true}},maintenanceEntry:{select:{humanId:true,status:true,resolution:true,deletedAt:true}}}});
    if(!work)throw new NotFoundError();
    if(parsed.kind==='query')return reply(`Housekeeping #${work.humanId} · Responsable: ${work.assignedTo?.name??'Por asignar'}.\n${work.resolution?'Resultado de Housekeeping: '+work.resolution:'Housekeeping todavía no tiene un resultado final.'}${work.maintenanceEntry?'\nMantenimiento #'+work.maintenanceEntry.humanId+': '+(maintenanceAllowsContinuation(work.maintenanceEntry)?'resultado disponible':'requiere atención')+(work.maintenanceEntry.resolution?' · '+work.maintenanceEntry.resolution:''):''}\nSiguiente acción: ${hkNextAction(work)}\n/admin/housekeeping?aviso=${work.humanId}`);
    if(parsed.action==='MANTENIMIENTO'&&!parsed.severity)return reply('¿Qué gravedad corresponde: baja, media, alta o crítica? Falta ese dato; no se ha creado una incidencia.');
    if(parsed.action!=='COMENZAR'&&!parsed.note)return reply('Indica el motivo, la instrucción o el resultado después de dos puntos. No se ha modificado el trabajo.');
    let assignedToId:string|undefined;
    if(parsed.kind==='assign'){
      const board=await getHkWorkday(user,{departmentId:work.departmentId??undefined,focusId:work.humanId});
      const handle=parsed.name?.startsWith('@')?await prisma.user.findUnique({where:{username:parsed.name.slice(1)},select:{id:true}}):null;
      const candidates=board.workload.filter(p=>handle?p.id===handle.id:normalize(p.name)===normalize(parsed.name??''));
      if(candidates.length!==1)return reply('Indica el @usuario exacto de una persona habilitada del área. No se asignará a alguien por una coincidencia ambigua.');
      assignedToId=candidates[0]!.id;
    }
    step={action:'changeHkWorkAction',fields:{id:work.id,version:String(work.version),action:parsed.kind==='assign'?'ASIGNAR':parsed.action!,...(parsed.note?{note:parsed.note}:{}),...(assignedToId?{assignedToId}:{}),...(parsed.severity?{severity:parsed.severity}:{})}};
  }
  const plan=await prepareExecution({requestKey:requestKey??randomUUID(),instruction:message,steps:[step]});
  const result=await executePlan(plan.id,true);
  return reply(executionSummary(result.steps)+'\n'+result.href);
}
''')
replace('src/server/ai/execution/commands.ts',"export async function executeFrontiCommand(message: string, requestKey?: string) {","export async function executeFrontiCommand(message: string, requestKey?: string) {\n  const {executeNaturalHousekeeping}=await import('./natural-housekeeping');\n  const natural=await executeNaturalHousekeeping(message,requestKey);\n  if(natural)return natural;")

write('tests/etapa3-housekeeping-maintenance.test.ts',r'''import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser} from './helpers';
import {ROLE_KEYS} from '@/lib/permissions';
import type {CurrentUser} from '@/server/auth/current-user';
import {hotelDateKey} from '@/domain/time';
import {createHkWork,changeHkWork,getHkWorkday} from '@/server/services/housekeeping-work';
import {changeEntryStatus,updateEntry} from '@/server/services/entries';
import {executeFrontiCommand} from '@/server/ai/execution/commands';
import {parseNaturalHousekeeping} from '@/server/ai/execution/natural-housekeeping';
let actor:CurrentUser;
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:async()=>{
 const row=await prisma.user.findUnique({where:{id:actor.id},include:{role:{include:{permissions:{include:{permission:true}}}}}});
 return row?.active?{...actor,roleKey:row.role.key,roleId:row.roleId,departmentId:row.departmentId,permissions:row.role.permissions.map(p=>p.permission.key)}:null;
}}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
describe('Etapa 3: resultado entre áreas sin duplicar trabajo',()=>{
 let admin:CurrentUser,maid:CurrentUser,other:CurrentUser,supervisor:CurrentUser,area:string,roomId:string;
 beforeAll(seedCatalog);
 beforeEach(async()=>{
  await resetOperationalData();admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});other=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});supervisor=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});actor=admin;
  area=(await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}})).id;roomId=(await prisma.room.findUniqueOrThrow({where:{number:'512'}})).id;
  await prisma.user.updateMany({where:{id:{in:[admin.id,maid.id,other.id,supervisor.id]}},data:{departmentId:area}});
 });
 async function change(user:CurrentUser,id:string,action:Parameters<typeof changeHkWork>[1]['action'],note='Hecho declarado',extra:Record<string,unknown>={}){const r=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id}});return changeHkWork(user,{id,version:r.version,action,note,...extra});}
 async function blocked(){const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Limpieza solicitada',description:'Limpiar tras revisión de fuga',departmentId:area,workDate:hotelDateKey(new Date()),workKind:'LIMPIEZA',roomId,priority:'ALTA',effortMinutes:25,assignedToId:maid.id});await change(maid,r.id,'COMENZAR');await change(maid,r.id,'IMPEDIMENTO','Fuga de agua');return change(supervisor,r.id,'MANTENIMIENTO','Reparar fuga',{severity:'ALTA'});}
 it('devuelve resultado y evidencia, exige retomar e inspeccionar, sin cambios comerciales',async()=>{
  const r=await blocked();const roomBefore=await prisma.room.findUniqueOrThrow({where:{id:roomId}});
  await expect(change(maid,r.id,'RETOMAR')).rejects.toThrow('resultado vigente');
  await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'RESUELTO',resolution:'Válvula reparada y probada'});
  const current=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}});expect(current.status).toBe('BLOQUEADO');expect(current.assignedToId).toBe(maid.id);expect(current.humanId).toBe(r.humanId);expect(current.version).toBeGreaterThan(r.version);
  const board=await getHkWorkday(maid,{focusId:r.humanId});expect(board.requests[0]?.maintenanceEntry?.resolution).toBe('Válvula reparada y probada');expect((await getHkWorkday(other,{focusId:r.humanId})).requests).toHaveLength(0);
  await expect(changeHkWork(maid,{id:r.id,version:r.version,action:'RETOMAR',note:'Formulario anterior'})).rejects.toThrow('cambió');
  await change(maid,r.id,'RETOMAR','Resultado revisado, acceso seguro');await change(maid,r.id,'TERMINAR','Limpieza realizada');await change(supervisor,r.id,'APROBAR','Inspección conforme');
  expect((await getHkWorkday(admin,{focusId:r.humanId})).requests[0]?.resolution).toContain('Inspección conforme');
  expect(await prisma.room.findUniqueOrThrow({where:{id:roomId}})).toEqual(roomBefore);expect(await prisma.roomStay.count()).toBe(0);expect(await prisma.shift.count()).toBe(0);
  expect(await prisma.task.count({where:{entryId:r.maintenanceEntryId}})).toBe(1);expect(await prisma.followUp.count({where:{entryId:r.maintenanceEntryId}})).toBe(1);
 });
 it('rechaza un resultado vacío y revierte la transición y sus derivados',async()=>{
  const r=await blocked();const before=await prisma.operationalEntry.findUniqueOrThrow({where:{id:r.maintenanceEntryId!}});const events=await prisma.housekeepingEvent.count({where:{requestId:r.id}});
  await expect(changeEntryStatus(admin,{id:before.id,status:'RESUELTO',resolution:'   '})).rejects.toThrow('resultado de Mantenimiento');
  expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:before.id}})).status).toBe(before.status);expect(await prisma.housekeepingEvent.count({where:{requestId:r.id}})).toBe(events);
 });
 it('reintentos concurrentes generan un solo resultado y conservan ambas identidades vinculadas',async()=>{
  const r=await blocked();const command={id:r.maintenanceEntryId!,status:'RESUELTO' as const,resolution:'Fuga corregida'};
  const attempts=await Promise.allSettled([changeEntryStatus(admin,command),changeEntryStatus(admin,command)]);expect(attempts.some(x=>x.status==='fulfilled')).toBe(true);
  await changeEntryStatus(admin,command);expect(await prisma.housekeepingEvent.count({where:{requestId:r.id,action:'MANTENIMIENTO_RESULTADO'}})).toBe(1);
  expect(await prisma.housekeepingRequest.count({where:{maintenanceEntryId:r.maintenanceEntryId}})).toBe(1);expect(await prisma.operationalEntry.count({where:{id:r.maintenanceEntryId!}})).toBe(1);
 });
 it('ediciones del resultado y reapertura quedan en el mismo historial, sin resolver Housekeeping',async()=>{
  const r=await blocked();await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'RESUELTO',resolution:'Ajuste inicial'});
  await updateEntry(admin,{id:r.maintenanceEntryId!,resolution:'Prueba adicional completada'});await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'EN_CURSO',reason:'Revisión adicional'});
  await expect(change(maid,r.id,'RETOMAR')).rejects.toThrow('resultado vigente');
  const events=await prisma.housekeepingEvent.findMany({where:{requestId:r.id,action:{startsWith:'MANTENIMIENTO_'}}});expect(events.map(e=>e.action)).toEqual(expect.arrayContaining(['MANTENIMIENTO_RESULTADO','MANTENIMIENTO_REABIERTO']));expect(events.some(e=>e.note?.includes('Prueba adicional completada'))).toBe(true);
  expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('BLOQUEADO');
 });
 it('no envía la actualización a una persona que perdió el acceso al área',async()=>{
  const r=await blocked();const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.RECEPTIONIST}});await prisma.user.update({where:{id:maid.id},data:{roleId:role.id,departmentId:(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id}});
  const before=await prisma.notification.count({where:{userId:maid.id,entityId:r.id}});await changeEntryStatus(admin,{id:r.maintenanceEntryId!,status:'RESUELTO',resolution:'Reparación terminada'});expect(await prisma.notification.count({where:{userId:maid.id,entityId:r.id}})).toBe(before);
 });
 it('Fronti completa instrucciones naturales por pasos nativos y un reintento no duplica el efecto',async()=>{
  const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Reposición',description:'Reponer tras revisión',departmentId:area,workDate:hotelDateKey(new Date()),workKind:'REPOSICION',roomId,priority:'MEDIA',effortMinutes:10,assignedToId:admin.id});
  const key=randomUUID();const taking=`Toma Housekeeping #${r.humanId}`;expect((await executeFrontiCommand(taking,key))?.reply).toContain('Completado');expect((await executeFrontiCommand(taking,key))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(`Informa impedimento en Housekeeping #${r.humanId}: Falta reparar fuga`,randomUUID()))?.reply).toContain('Completado');
  const before=await prisma.frontiExecution.count();expect((await executeFrontiCommand(`Solicita Mantenimiento para Housekeeping #${r.humanId}: Reparar fuga`,randomUUID()))?.reply).toContain('gravedad');expect(await prisma.frontiExecution.count()).toBe(before);
  expect((await executeFrontiCommand(`Solicita Mantenimiento para Housekeeping #${r.humanId} con gravedad ALTA: Reparar fuga`,randomUUID()))?.reply).toContain('Completado');
  const maintenance=(await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id},include:{maintenanceEntry:true}})).maintenanceEntry!;
  expect((await executeFrontiCommand(`Finaliza Mantenimiento #${maintenance.humanId}: Reparación comprobada`,randomUUID()))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(`Consulta el resultado de Housekeeping #${r.humanId}`))?.reply).toContain('Reparación comprobada');
  expect((await executeFrontiCommand(`Retoma Housekeeping #${r.humanId}: Resultado revisado`,randomUUID()))?.reply).toContain('Completado');
  expect((await executeFrontiCommand(`Finaliza Housekeeping #${r.humanId}: Reposición terminada`,randomUUID()))?.reply).toContain('Completado');
  expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('RESUELTO');
 });
 it('no interpreta citas, negaciones, preguntas ni ausencia de un folio como autorización',()=>{
  for(const message of ['No finaliza Housekeeping #123: prueba','Documento ajeno: Toma Housekeeping #123','¿Toma Housekeeping #123?','Toma Housekeeping','Toma Housekeeping #123\nFinaliza Mantenimiento #456: texto'])expect(parseNaturalHousekeeping(message)).toBeNull();
 });
});
''')

write('scripts/etapa3/browser.mjs',r'''import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const f=JSON.parse(readFileSync('/tmp/etapa1-fixture.json','utf8'));
const db=new PrismaClient(),browser=await chromium.launch({headless:true}),results=[];
try{
 const area=await db.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});const room=await db.room.findUniqueOrThrow({where:{number:'512'}});
 await db.user.update({where:{id:f.users.maid.id},data:{departmentId:area.id}});
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const width of [1280,390]){
  const contexts=[];
  async function session(key){const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);await context.addCookies([{name:'lor_session',value:f.users[key].token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname!=='localhost'||['/api/notifications/stream','/api/alarms','/api/auth/pulse'].some(p=>u.pathname.startsWith(p))?route.abort():route.continue();});const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);return {context,page};}
  const admin=await session('admin'),maid=await session('maid');const key=randomUUID(),title=`ETAPA3_HK_${width}`;
  const create=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:'/ejecutar '+JSON.stringify([{action:'createHkWorkAction',fields:{requestKey:key,title,description:'Limpiar tras revisión de fuga sintética',workKind:'LIMPIEZA',workDate:date,departmentId:area.id,roomId:room.id,priority:'ALTA',effortMinutes:'25',assignedToId:f.users.maid.id}}]),requestKey:randomUUID()}});
  const createBody=await create.json();assert.equal(create.status(),200,createBody.error);assert.match(createBody.reply,/Completado/);
  const work=await db.housekeepingRequest.findUniqueOrThrow({where:{requestKey:key}});const href=`http://localhost:3000/admin/housekeeping?area=${area.id}&aviso=${work.humanId}`;
  async function open(page){await page.goto(href);await page.locator(`#aviso-${work.humanId}`).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal overflow');}
  async function act(page,label,note,extra){const card=page.locator(`#aviso-${work.humanId}`);if(note){await card.getByRole('button',{name:label,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('textarea[name=note]').fill(note);if(extra)await dialog.locator('select[name=severity]').selectOption(extra);await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/admin/housekeeping'),dialog.getByRole('button',{name:'Confirmar',exact:true}).click()]);await dialog.waitFor({state:'hidden'});}else{await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/admin/housekeeping'),card.getByRole('button',{name:label,exact:true}).click()]);}await open(page);}
  await open(maid.page);await act(maid.page,'Comenzar');await act(maid.page,'Informar impedimento','Fuga de agua sintética');
  await open(admin.page);await act(admin.page,'Solicitar Mantenimiento','Reparar fuga sintética','ALTA');
  const linked=await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id},include:{maintenanceEntry:true}});assert.ok(linked.maintenanceEntry);
  const completeMessage=`Finaliza Mantenimiento #${linked.maintenanceEntry.humanId}: Válvula reparada y comprobada ${width}`;const resultKey=randomUUID();
  const response=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:completeMessage,requestKey:resultKey}});const body=await response.json();assert.equal(response.status(),200,body.error);assert.match(body.reply,/Completado/);
  const retry=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:completeMessage,requestKey:resultKey}});assert.equal(retry.status(),200);assert.equal(await db.housekeepingEvent.count({where:{requestId:work.id,action:'MANTENIMIENTO_RESULTADO'}}),1);
  await open(maid.page);const result=maid.page.getByRole('region',{name:'Resultado de Mantenimiento',exact:true});await result.getByText(`Válvula reparada y comprobada ${width}`,{exact:false}).waitFor();assert.equal(await result.getByRole('link',{name:'Ver incidencia'}).count(),0,'Area-only user gets scoped result, not a generic book link');
  assert.equal((await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}})).status,'BLOQUEADO');await act(maid.page,'Retomar','Resultado revisado, acceso seguro');await act(maid.page,'Marcar terminado','Limpieza realizada');
  assert.equal((await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}})).status,'POR_REVISAR');await open(admin.page);await act(admin.page,'Aprobar revisión','Inspección conforme');
  const final=await db.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}});assert.equal(final.status,'RESUELTO');assert.equal(final.inspectedById,f.users.admin.id);assert.equal(final.humanId,work.humanId);assert.deepEqual(await db.room.findUniqueOrThrow({where:{id:room.id}}),room);
  const query=await admin.context.request.post('http://localhost:3000/api/fronti',{headers:{Origin:'http://localhost:3000'},data:{message:`Consulta el resultado de Housekeeping #${work.humanId}`,requestKey:randomUUID()}});assert.equal(query.status(),200);const queryBody=await query.json();assert.match(queryBody.reply,/Inspección conforme/);assert.match(queryBody.reply,/Válvula reparada/);
  results.push({width,scenario:'HK-impediment-maintenance-native-Fronti-result-retry-resume-inspection',status:'passed',physicalSafari:false,provider:'not-used'});
  for(const context of contexts)await context.close();
 }
}finally{writeFileSync('etapa3-browser-results.json',JSON.stringify(results,null,2));await browser.close();await db.$disconnect();}
''')
replace('.github/workflows/compuerta.yml',"          exit \"$journey_status\"", "          if ! PLAYWRIGHT_MODULE=\"$PWD/node_modules/playwright-core/index.mjs\" node scripts/etapa3/browser.mjs; then\n            journey_status=1\n          fi\n          exit \"$journey_status\"")
replace('.github/workflows/compuerta.yml',"            etapa2-browser-results.json", "            etapa2-browser-results.json\n            etapa3-browser-results.json")
write('docs/etapa3/PENDIENTES.md',r'''# Etapa 3 · lista única de entregas y pendientes

Base comprobada: Production 1.47.1 / d9472e479dabbb2d1e7a4809750c3cc4b7226ebf. No se repite auditoría general. Esta lista no atribuye a Etapa 3 funciones de etapas anteriores ni confunde código preparado con publicación.

## Bloques

1. **Recepción–Housekeeping–Mantenimiento: devolución del resultado** (PR #248, versión propuesta 1.48.0). Implementación preparada: resultado nativo, historial, aviso autorizado, continuidad explícita sin cierre automático, formularios invalidados por cambios de contexto, consulta/acciones naturales concretas mediante Fronti existente. No modifica PMS, Caja, llaves, roles o áreas reales. Estado de pruebas y despliegue se registra en la PR; este documento no declara publicación anticipada.
2. **Coordinación completa y custodia de objetos**: completar vistas de solicitudes y origen, aclaraciones/derivaciones, mantenimiento y relevos, objetos olvidados dentro de módulos existentes. Pendiente funcional.
3. **Supervisión/gerencia y cierre de recorridos Fronti**: indicadores y fuentes, continuidad y carga, cobertura natural de procedimientos restantes, navegación de escritorio/móvil. Pendiente funcional.

## Pendientes vigentes

| ID | Prioridad / impacto | Requisito pendiente | Motivo / criterio de cierre |
|---|---|---|---|
| E3-01 | Alta · operación entre áreas | Verificar y publicar el bloque 1 | Requiere Compuerta del commit final, revisión y comprobación posterior de SHA/version; no basta crear adaptadores. |
| E3-02 | Alta · coordinación | Solicitudes de Recepción, origen inmutable de derivaciones, aclaraciones y devolución al solicitante, continuidad visible en Mantenimiento | Bloque 2; reutilizar registros, asignaciones, suplencias y delegaciones existentes. No inferir disponibilidad de una malla. |
| E3-03 | Alta · custodia | Registro de objetos encontrados, ubicación, entrega/disposición, evidencia y acceso | Bloque 2. Pendiente funcional, no sustituir por llaves ni por texto sin historial. |
| E3-04 | Alta · decisiones | Completar vistas de supervisión y gerencia, carga por persona/área, períodos/cálculos y vínculos a fuentes | Bloque 3. Reutilizar indicadores de Etapa 2, distinguir datos medidos/estimados. |
| E3-05 | Alta · Fronti | Cobertura natural restante y recorridos completos nuevos/modificados | Bloque 3; el bloque 1 sólo acredita sus frases/procedimientos comprobados. Permisos actuales y segunda persona para inspección se conservan. |
| E3-06 | Media · continuidad | Archivar/restaurar una incidencia vinculada comunica aviso específico al área | La vista reconoce archivo y bloquea continuar sin resultado vigente; ampliar notificación específica en estabilización sin borrar historial. |
| E3-07 | Media · comprobación física | Safari/iPhone físico | No hay dispositivo disponible. Chromium con ancho 390 no es equivalente. |
| E3-08 | Baja · presentación | Transiciones/ajustes visuales secundarios | Posponibles sólo si ningún botón/capa/diálogo bloquea la operación. |
| E2-ARRASTRE | Alta · alcance previo | Variantes Caja/llaves/turnos/admin/HTTP, recurrencias HK, comparación completa entre turnos, recuperación supervisada y cobertura natural general | Permanecen abiertos según #247 y docs/etapa2/MATRIZ_ACCIONES.md. No bloquean conexiones independientes. CRON_SECRET ya verificado; no activar reglas reales ni habilitar sobrecostes. |

Conservar colaborador=usuario existente, horas semanales en horas, sin configuración/descuento de descansos y pertenencias/historial aditivos. No habilitar módulos para demostrar funciones. No nuevas reservas, estadías, tarifas o disponibilidad comercial.
''')
write('docs/AGENT_HANDOFF.md',r'''## 02/10/2026 · Etapa 3 bloque 1 · PR #248

Base de Production comprobada una vez: 1.47.1 / d9472e4. Esta modificación prepara 1.48.0; consultar la PR para pruebas/commit/despliegue real. No atribuir publicación por la presencia de este documento.

Conecta devolución nativa Mantenimiento→HK en la transacción de la incidencia: resultado obligatorio, historial y aviso con alcance actual, versión del trabajo invalidada. Housekeeping conserva estado/responsable y exige retomar e inspeccionar donde corresponda; no modifica disponibilidad comercial. Fronti utiliza sus servicios/ejecutor para frases naturales concretas de consulta, asignación, atención, impedimento, resultado y revisión. Reintentos con la misma referencia conservan el plan autorizado.

Pruebas nuevas PostgreSQL y recorrido Chromium 1280/390 agregado a la compuerta existente, sin aumentar sus límites. Copilot debe revisarse una vez sobre el bloque terminado; cuota anterior agotada, no comprar créditos. Sin migración nueva, sin datos operativos de prueba en Production y sin permisos ampliados. Entorno local dejó de ejecutar; preparación mediante objetos Git en CI, sin mover referencias desde el token del workflow. Los archivos temporales de preparación no forman parte del árbol final.

Lista única: docs/etapa3/PENDIENTES.md. Etapa 3 no está completa; custodia, resto de coordinación y supervisión/gerencia pendientes. Safari/iPhone físico no acreditado.

'''+read('docs/AGENT_HANDOFF.md'))
for path in ['package.json','package-lock.json']:
    data=json.loads(read(path));data['version']='1.48.0'
    if path=='package-lock.json':data['packages']['']['version']='1.48.0'
    write(path,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for path in ['.github/etapa3_prepare.py','.github/workflows/etapa3-prepare.yml']:
    Path(path).unlink()

# Create only Git objects. A separate authenticated connector operation adopts the reviewed SHA.
def api(path,body=None):
    req=urllib.request.Request('https://api.github.com/repos/'+REPO+'/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(req,timeout=45) as response:return json.load(response)
head=os.environ['EXPECTED_HEAD']
if api('git/ref/heads/feat/etapa3-coordinacion')['object']['sha']!=head:raise RuntimeError('Branch moved; reconcile before publishing objects')
base=api('git/commits/'+head)['tree']['sha']
changed=subprocess.check_output(['git','diff','--name-only','-z','HEAD']).decode().split('\0')
new=subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z']).decode().split('\0')
paths=sorted(set(p for p in changed+new if p))
entries=[]
for p in paths:
    if not (p.startswith(('src/','tests/','docs/','scripts/etapa3/','.github/')) or p in ['package.json','package-lock.json']):raise RuntimeError('Unexpected changed path: '+p)
    if Path(p).exists():
        blob=api('git/blobs',{'content':read(p),'encoding':'utf-8'})['sha']
        entries.append({'path':p,'mode':'100644','type':'blob','sha':blob})
    else:entries.append({'path':p,'mode':'100644','type':'blob','sha':None})
tree=api('git/trees',{'base_tree':base,'tree':entries})['sha']
commit=api('git/commits',{'message':'feat: devolver resultados entre Housekeeping y Mantenimiento (1.48.0)','tree':tree,'parents':[head]})['sha']
print('PREPARED_COMMIT='+commit)
print('Changed paths: '+', '.join(paths))
print('No ref update, merge, deployment, migration or production data access performed by this workflow.')
