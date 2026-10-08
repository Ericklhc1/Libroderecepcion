import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import type {Prisma} from '@prisma/client';
import type {PermissionKey} from '@/lib/permissions';
import type {CurrentUser} from '@/server/auth/current-user';
import {coordinationTasks,coordinationEntries} from './coordination-access';
import {notify} from '@/server/notifications';

export async function sourceStakeholders(tx:Prisma.TransactionClient,entryId:string|null|undefined){
  if(!entryId)return [];
  const entry=await readEntries(tx, {engine:"stakeholders"}).findUnique({where:{id:entryId},select:{createdById:true,ownerId:true}});
  return entry?[...new Set([entry.createdById,entry.ownerId].filter((id):id is string=>!!id))]:[];
}
/** Filter every recipient against the current source, including outgoing responsibility. */
export async function notifyNativeWork(tx:Prisma.TransactionClient,input:{kind:'task'|'entry';id:string;actorId:string;ids:(string|null|undefined)[];title:string;body?:string;internalOnly?:boolean}){
  const people=await tx.user.findMany({where:{id:{in:[...new Set(input.ids.filter((id):id is string=>!!id&&id!==input.actorId))]},active:true,deletedAt:null},select:{id:true,role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}});
  const recipients:string[]=[];
  for(const person of people){
    const reader={id:person.id,roleKey:person.role.key,permissions:person.role.permissions.map(p=>p.permission.key as PermissionKey)} as CurrentUser;
    if(input.kind==='task'?await tx.task.count({where:{id:input.id,AND:[coordinationTasks(reader)]}}):await readEntries(tx, reader).count({where:{id:input.id,AND:[coordinationEntries(reader)]}}))recipients.push(person.id);
  }
  await notify(recipients.map(userId=>({internalOnly:input.internalOnly??true,userId,type:'ACTUALIZACION_OPERATIVA' as const,title:input.title,body:input.body,link:input.kind==='task'?`/tareas/${input.id}`:`/libro/${input.id}`,entity:input.kind==='task'?'Task':'OperationalEntry',entityId:input.id})),tx);
}

export async function notifyUnassignedTask(tx:Prisma.TransactionClient,task:{id:string;humanId:number;departmentId:string|null;assigneeId:string|null;createdById:string},actorId:string){
  if(task.assigneeId||!task.departmentId)return;
  const area=task.departmentId;
  const people=await tx.user.findMany({where:{active:true,deletedAt:null,hiddenFromSelectors:false,AND:[{OR:[{departmentId:area},{scheduleCollaborator:{active:true,memberships:{some:{departmentId:area,active:true}}}}]}],role:{permissions:{some:{permission:{key:'task.assign'}}}}},select:{id:true}});
  await notifyNativeWork(tx,{kind:'task',id:task.id,actorId,ids:people.map(p=>p.id),title:`Por revisar: solicitud #${task.humanId} sin responsable`,body:'Revisa la bandeja del área y asigna, informa o solicita una aclaración.'});
}
