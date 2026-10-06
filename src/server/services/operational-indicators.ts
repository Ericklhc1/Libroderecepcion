import 'server-only';
import { z } from 'zod';
import type { CurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { getCoordinationBoard, coordinationMetrics, type CoordinationRow } from './coordination';
import { coordinationTasks } from './coordination-access';
import { TASK_COMPLETED_STATUSES, ENTRY_RESOLVED_STATUSES } from '@/domain/operational-metrics';
import { measuredDurations, periodChanges } from '@/domain/operational-indicators';

/** Same visibility and same grouping as the operational board; never global/private chat totals. */
export async function operationalIndicators(user:CurrentUser,raw:{departmentId?:string;from:Date;to:Date}){
  const input=z.object({departmentId:z.string().min(1).optional(),from:z.date(),to:z.date()}).strict().refine(v=>v.to>=v.from&&v.to.getTime()-v.from.getTime()<=31*86400000,'Selecciona hasta 31 días.').parse(raw);
  const scan=async(history:boolean)=>{
    const rows:CoordinationRow[]=[];let complete=false;let byAreaComplete=false;let byArea:Awaited<ReturnType<typeof getCoordinationBoard>>['byArea']=[];
    for(let page=1;page<=10;page++){
      const board=await getCoordinationBoard(user,{departmentId:input.departmentId,history,page});
      rows.push(...board.rows);if(page===1){byArea=board.byArea;byAreaComplete=board.totalExact;}
      if(!board.hasMore){complete=true;break;}
    }
    return {rows,complete,byArea,byAreaComplete};
  };
  const [pending,history,steps,automation,procedures,shifts]=await Promise.all([
    scan(false),scan(true),
    prisma.frontiExecutionStep.findMany({where:{execution:{userId:user.id},completedAt:{gte:input.from,lte:input.to}},orderBy:{completedAt:'desc'},take:1001,select:{status:true,action:true,startedAt:true,completedAt:true,executionId:true}}),
    prisma.operationalAutomationRun.groupBy({by:['status'],where:{policy:{ownerId:user.id,...(input.departmentId?{departmentId:input.departmentId}:{})},startedAt:{gte:input.from,lte:input.to}},_count:{_all:true}}),
    prisma.task.findMany({where:{AND:[coordinationTasks(user)],...(input.departmentId?{departmentId:input.departmentId}:{}),procedureOccurrenceKey:{not:null},createdAt:{gte:input.from,lte:input.to}},orderBy:{createdAt:'desc'},take:1001,select:{id:true,status:true,dueAt:true,completedAt:true,requiresIndependentValidation:true,evidenceProvided:true,checklist:{select:{done:true}}}}),
    prisma.shift.findMany({where:{isDemo:false,assignments:{some:{userId:user.id}},actualStart:{not:null,lte:input.to}},orderBy:{actualStart:'desc'},take:2,select:{id:true,humanId:true,actualStart:true,actualEnd:true}}),
  ]);
  const seen=new Set<string>();const rows=[...pending.rows,...history.rows].filter(row=>{const key=row.kind+':'+row.id;if(seen.has(key))return false;seen.add(key);return true;});
  const [audit,hkEvents]=await Promise.all([
    prisma.auditLog.findMany({where:{createdAt:{gte:input.from,lte:input.to},OR:[{entity:'Task',entityId:{in:rows.filter(r=>r.kind==='task').map(r=>r.id)}},{entity:'OperationalEntry',entityId:{in:rows.filter(r=>r.kind==='entry').map(r=>r.id)}}]},orderBy:{createdAt:'desc'},take:2001,select:{entity:true,entityId:true,before:true,after:true,createdAt:true}}),
    prisma.housekeepingEvent.findMany({where:{requestId:{in:rows.filter(r=>r.kind==='housekeeping').map(r=>r.id)},createdAt:{gte:input.from,lte:input.to},action:{in:['REABRIR','IMPEDIMENTO']}},take:2001,select:{action:true,requestId:true}}),
  ]);
  const terminal=new Set<string>([...TASK_COMPLETED_STATUSES, ...ENTRY_RESOLVED_STATUSES, 'CANCELADA', 'CANCELADO']);
  const state=(v:unknown)=>v&&typeof v==='object'&&'status' in v?String(v.status):null;
  const reopened=audit.slice(0,2000).filter(event=>{const before=state(event.before),after=state(event.after);return before&&after&&terminal.has(before)&&!terminal.has(after);}).length+hkEvents.slice(0,2000).filter(event=>event.action==='REABRIR').length;
  const blocked=audit.slice(0,2000).filter(event=>{const before=state(event.before),after=state(event.after);return after&&['BLOQUEADO','BLOQUEADA','EN_ESPERA'].includes(after)&&before!==after;}).length+hkEvents.slice(0,2000).filter(event=>event.action==='IMPEDIMENTO').length;
  const observed=steps.slice(0,1000);const successful=observed.filter(step=>step.status==='SUCCEEDED');
  const durations=successful.filter(step=>step.startedAt&&step.completedAt&&step.completedAt>=step.startedAt).map(step=>step.completedAt!.getTime()-step.startedAt!.getTime()).sort((a,b)=>a-b);
  const sampledProcedures=procedures.slice(0,1000);
  const compliant=sampledProcedures.filter(task=>TASK_COMPLETED_STATUSES.includes(task.status)&&(!task.requiresIndependentValidation||task.status==='VALIDADA')&&!!task.evidenceProvided&&task.checklist.every(item=>item.done));
  const shiftFrom=shifts[0]?.actualStart??null;
  return {generatedAt:new Date(),period:{from:input.from,to:input.to},scope:input.departmentId??'Áreas y registros dentro de tu acceso',complete:pending.complete&&history.complete,
    denominator:rows.length,pending:{...coordinationMetrics(pending.rows,input.to),denominator:pending.rows.length,complete:pending.complete,sources:pending.rows.slice(0,30)},
    byArea:pending.byArea,byAreaComplete:pending.byAreaComplete,durations:measuredDurations(rows,input.from,input.to),changes:periodChanges(rows,input.from,input.to),
    shift:{current:shifts[0]??null,previous:shifts[1]??null,from:shiftFrom,changes:shiftFrom?periodChanges(rows,shiftFrom,input.to):null,note:'Turnos reales de los que eres integrante; sin apertura registrada no se inventa un corte de turno.'},
    recurrence:{reopened,blockEvents:blocked,denominator:audit.slice(0,2000).length+hkEvents.slice(0,2000).length,complete:pending.complete&&history.complete&&audit.length<=2000&&hkEvents.length<=2000,definition:'Reaperturas y nuevos bloqueos acreditados por eventos; no se equiparan títulos parecidos a reincidencia.'},
    procedures:{compliant:compliant.length,denominator:sampledProcedures.length,complete:procedures.length<=1000,definition:'Ocurrencias creadas en el período, con evidencia, lista completa y validación independiente cuando corresponde.'},
    automation:{scope:'Políticas autorizadas por ti',statuses:automation.map(row=>({status:row.status,count:row._count._all})),denominator:automation.reduce((sum,row)=>sum+row._count._all,0)},
    fronti:{scope:'Sólo tus acciones',complete:steps.length<=1000,denominator:observed.length,successful:successful.length,failed:observed.filter(s=>s.status==='INTERVENTION').length,changed:observed.filter(s=>s.status==='CHANGED').length,p95Ms:durations.length?durations[Math.ceil(durations.length*.95)-1]!:null,durationSamples:durations.length,
      estimatedManualSubmissionsAvoided:successful.length,estimate:'Estimación: una presentación manual de formulario por acción nativa completada. No mide clics ni ahorro de tiempo humano.',observedHumanTimeSaved:null,baselineStage1:null},
    note:'No se imputan tiempos faltantes. Las muestras acotadas se señalan como parciales. Los pendientes son actuales; los tiempos usan eventos finales del período. El historial mantiene el estado actual del registro y no constituye una reconstrucción de todos sus estados anteriores.',
  };
}
