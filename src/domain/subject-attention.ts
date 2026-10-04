/** Las solicitudes de atención usan la tarea existente y devuelven su resultado al origen. */
export function isSubjectAttentionTask(occurrenceKey?:string|null){return !!occurrenceKey?.startsWith('subject:');}
