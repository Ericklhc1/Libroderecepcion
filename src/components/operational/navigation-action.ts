'use client';
import type { ActionState } from '@/server/action';

async function submit(procedure: 'coordination'|'task-status', form: FormData): Promise<ActionState> {
  try {
    const response=await fetch(`/api/operational-actions/${procedure}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form.entries()))});
    const result=await response.json() as ActionState & { navigateTo?:string };
    if (!response.ok || !result.ok) return 'error' in result && typeof result.error==='string'?result:{ok:false,error:'No se pudo confirmar el resultado. Revisa el registro antes de volver a enviar.'};
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
