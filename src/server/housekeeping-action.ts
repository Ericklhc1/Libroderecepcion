import 'server-only';
import {runAction,type ActionState} from '@/server/action';
const fields:Record<string,string>={requestKey:'referencia de la solicitud',title:'título',description:'qué se necesita',workKind:'tipo de trabajo',workDate:'fecha de trabajo',departmentId:'área',roomId:'habitación',zoneId:'zona',location:'lugar',priority:'prioridad',dueAt:'plazo',effortMinutes:'duración estimada',requiresInspection:'revisión requerida',assignedToId:'responsable',sourceEntryId:'solicitud de origen',id:'trabajo',version:'versión del trabajo',action:'acción',severity:'gravedad',note:'observación',userId:'colaborador',available:'disponibilidad',permission:'permiso',startsAt:'inicio',endsAt:'término',reason:'motivo',active:'activación'};
/** Keep validation useful when Fronti has no form to highlight; never echo submitted values. */
export async function runHkAction(fn:()=>Promise<ActionState>):Promise<ActionState>{
 const result=await runAction(fn);
 if(result.ok||!result.fieldErrors)return result;
 const invalid=Object.keys(result.fieldErrors).filter(key=>Object.hasOwn(fields,key));
 return invalid.length?{...result,error:`Revisa estos datos: ${invalid.map(key=>fields[key]).join(', ')}.`}:result;
}
