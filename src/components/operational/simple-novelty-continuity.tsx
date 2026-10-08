import Link from 'next/link';
import type {CurrentUser} from '@/server/auth/current-user';
import {getSimpleNoveltyContinuity} from '@/server/services/simple-novelty-continuity';
import {TASK_STATUS_LABEL,FOLLOWUP_STATUS_LABEL} from '@/domain/labels';
import {HK_WORK_LABELS} from '@/domain/housekeeping-work';
export async function SimpleNoveltyContinuity({entryId,user}:{entryId:string;user:CurrentUser}){
  const work=await getSimpleNoveltyContinuity(entryId,user);if(!work.tasks.length&&!work.followups.length&&!work.housekeeping.length)return null;
  return <section className="border border-slate-300 bg-white" aria-label="Continuidad vigente"><h2 className="p-2 font-semibold">Trabajo pendiente vinculado</h2><p className="px-2 text-sm">Completa, valida o cancela con motivo el trabajo existente antes de resolver esta novedad.</p><ul className="divide-y divide-slate-300 p-2 text-sm">
    {work.tasks.map(task=><li key={task.id} className="py-1"><Link className="underline" href={`/tareas/${task.id}`}>Tarea #{task.humanId} · {task.title}</Link> · {TASK_STATUS_LABEL[task.status]} · {task.assignee?.name??'Sin responsable'}</li>)}
    {work.followups.map(followup=><li key={followup.id} className="py-1"><Link className="underline" href={`/seguimientos?q=${followup.humanId}&estado=todos`}>Seguimiento #{followup.humanId} · {followup.action}</Link> · {FOLLOWUP_STATUS_LABEL[followup.status]} · {followup.owner.name}</li>)}
    {work.housekeeping.map(request=><li key={request.id} className="py-1"><Link className="underline" href={`/housekeeping?area=${request.departmentId??''}&aviso=${request.humanId}`}>Housekeeping #{request.humanId} · {request.title}</Link> · {HK_WORK_LABELS[request.status]}</li>)}
  </ul></section>;
}
