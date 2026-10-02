import { createHash } from 'node:crypto';
import { canonicalJson } from '@/domain/fronti-execution';

export const adminUserRevisionSelect = { id:true, name:true, roleId:true, active:true, departmentId:true, updatedAt:true } as const;
export function adminUserRevision(row: {id:string;name:string;roleId:string;active:boolean;departmentId:string|null;updatedAt:Date}) {
  return adminRevision({id:row.id,name:row.name,roleId:row.roleId,active:row.active,departmentId:row.departmentId,updatedAt:row.updatedAt});
}
export function adminRevision(value: unknown) {
  return createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(value)))).digest('hex');
}
