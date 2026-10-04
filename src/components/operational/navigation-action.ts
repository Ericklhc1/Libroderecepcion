'use client';
import type { ActionState } from '@/server/action';

async function submit(procedure: 'coordination'|'task-status'|'automation-save'|'automation-simulate'|'automation-state'|'custody-create'|'custody-change'|'handover-missing'|'handover-missing-approve', form: FormData): Promise<ActionState> {
  try {
    const fields:Record<string,string|string[]>={};
    for(const [key,value] of form.entries()){if(typeof value!=='string')throw new Error('File not supported');if(key==='weekdays')fields[key]=form.getAll(key).map(String);else fields[key]=value;}
    const response=await fetch(`/api/operational-actions/${procedure}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});
    const result=await response.json() as ActionState & { navigateTo?:string };
    if (!response.ok || !result.ok) return 'error' in result && typeof result.error==='string'?result:{ok:false,error:'No se pudo confirmar el resultado. Revisa el registro antes de volver a enviar.'};
    if (procedure==='automation-simulate') return result;
    if (typeof result.navigateTo!=='string') throw new Error('Missing destination');
    const destination=new URL(result.navigateTo,window.location.origin);
    if(destination.origin!==window.location.origin)throw new Error('Invalid destination');
    // A document navigation does not depend on the stalled RSC action transition.
    window.location.assign(destination.href);
    return result;
  } catch {
    return {ok:false,error:'No se pudo confirmar el resultado. Revisa el registro antes de volver a enviar.'};
  }
}
export async function coordinateWorkFormAction(_state:ActionState|null,form:FormData){return submit('coordination',form);}
export async function changeTaskStatusFormAction(_state:ActionState|null,form:FormData){return submit('task-status',form);}

export async function saveAutomationAction(_state:ActionState|null,form:FormData){return submit('automation-save',form);}
export async function simulateAutomationAction(_state:ActionState|null,form:FormData){return submit('automation-simulate',form);}
export async function setAutomationStateAction(_state:ActionState|null,form:FormData){return submit('automation-state',form);}

export async function createLostFoundAction(_state:ActionState|null,form:FormData){return submit('custody-create',form);}
export async function changeLostFoundAction(_state:ActionState|null,form:FormData){return submit('custody-change',form);}
export async function reportMissingElementAction(_state:ActionState|null,form:FormData){return submit('handover-missing',form);}
export async function approveMissingElementAction(_state:ActionState|null,form:FormData){return submit('handover-missing-approve',form);}
