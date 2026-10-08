import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
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
      const result=await executePlan(previous.executionId,false);
      return reply(executionSummary(result.steps)+'\n'+result.href);
    }
  }
  let step:FrontiStep;
  if(parsed.kind==='maintenance'){
    const entry=await readEntries(prisma, user).findFirst({where:{humanId:parsed.humanId,type:'INCIDENCIA',department:{key:'MANTENIMIENTO'},AND:[coordinationEntries(user)]},select:{id:true}});
    if(!entry)throw new NotFoundError();
    if(!parsed.note)return reply('¿Qué hizo Mantenimiento y cuál fue el resultado? Indícalo después de dos puntos; no se ha cambiado el registro.');
    step={action:'changeEntryStatusAction',fields:{id:entry.id,status:'RESUELTO',resolution:parsed.note}};
  }else{
    const work=await prisma.housekeepingRequest.findFirst({where:{humanId:parsed.humanId,workflowVersion:1,isDemo:false,AND:[await hkWorkVisibility(user)]},include:{assignedTo:{select:{name:true}},maintenanceEntry:{select:{humanId:true,status:true,resolution:true,deletedAt:true}}}});
    if(!work)throw new NotFoundError();
    if(parsed.kind==='query')return reply(`Housekeeping #${work.humanId} · Responsable: ${work.assignedTo?.name??'Por asignar'}.\n${work.resolution?'Resultado de Housekeeping: '+work.resolution:'Housekeeping todavía no tiene un resultado final.'}${work.maintenanceEntry?'\nMantenimiento #'+work.maintenanceEntry.humanId+': '+(maintenanceAllowsContinuation(work.maintenanceEntry)?'resultado disponible':'requiere atención')+(work.maintenanceEntry.resolution?' · '+work.maintenanceEntry.resolution:''):''}\nSiguiente acción: ${hkNextAction(work)}\n/housekeeping?aviso=${work.humanId}`);
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
