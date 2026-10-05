import 'server-only';
import type {Prisma} from '@prisma/client';
import type {PermissionKey} from '@/lib/permissions';
import {prisma} from '@/lib/prisma';
import {isHkFocused} from '@/domain/housekeeping-work';
import {RuleError} from '@/server/errors';

export function canReceiveGenericTask(role:{key:string;permissions:{permission:{key:string}}[]}){
  return !isHkFocused({roleKey:role.key,permissions:role.permissions.map(p=>p.permission.key as PermissionKey)});
}
/** A native task must be openable by its responsible person. Hybrid roles stay explicit. */
export async function assertTaskAssignable(id:string,tx:Prisma.TransactionClient=prisma){
  const person=await tx.user.findFirst({where:{id,active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true}},select:{name:true,role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}}});
  if(!person)throw new RuleError('Selecciona una persona operativa activa y visible.');
  if(!canReceiveGenericTask(person.role))throw new RuleError(`${person.name} trabaja en Housekeeping y no tiene acceso a tareas generales. Solicita atención por el flujo del área.`);
}
