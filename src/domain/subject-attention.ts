/** Las solicitudes de atención usan la tarea existente y devuelven su resultado al origen. */
export function isSubjectAttentionTask(occurrenceKey?:string|null){return !!occurrenceKey?.startsWith('subject:');}

/** Input is newest first; a new unfinished attempt supersedes older results. */
export function returnedSubjectTask<T extends {procedureOccurrenceKey:string|null;status:string;completedAt:Date|null;isDemo?:boolean}>(tasks:readonly T[],reopenedAt:Date|null){
  const latest=tasks.find(task=>!task.isDemo&&isSubjectAttentionTask(task.procedureOccurrenceKey));
  return latest&&['VALIDADA','COMPLETADA'].includes(latest.status)&&(!reopenedAt||!!latest.completedAt&&latest.completedAt>=reopenedAt)?latest:undefined;
}
