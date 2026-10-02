import 'server-only';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@/domain/fronti-execution';
import { RuleError } from '@/server/errors';

export function authorizedRevision(value: unknown): string {
  return createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest('hex');
}
/** Call against the row used by a locked mutation or bind its version in the UPDATE predicate. */
export function assertAuthorizedRevision(expected: string | undefined, value: unknown) {
  if (expected && expected !== authorizedRevision(value)) throw new RuleError('El registro cambió después de la autorización. Revisa su estado y autoriza nuevamente.');
}
export function revisionFromForm(form:FormData):string|undefined {
  const value=form.get('__frontiRevision');
  if(value===null)return undefined;
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new RuleError('La revisión autorizada no es válida.');
  return value;
}

/** Hash only the row returned by the native mutation, never a later re-read. */
export function operationalRecordRevision(kind:'tasks'|'entries'|'followups', row:{updatedAt:Date;status:string;assigneeId?:string|null;ownerId?:string|null;dueAt?:Date|null;scheduledAt?:Date|null}) {
  return authorizedRevision(kind==='tasks'
    ? {updatedAt:row.updatedAt,status:row.status,assigneeId:row.assigneeId,dueAt:row.dueAt}
    : kind==='entries'
      ? {updatedAt:row.updatedAt,status:row.status,ownerId:row.ownerId,dueAt:row.dueAt}
      : {updatedAt:row.updatedAt,status:row.status,ownerId:row.ownerId,scheduledAt:row.scheduledAt});
}
