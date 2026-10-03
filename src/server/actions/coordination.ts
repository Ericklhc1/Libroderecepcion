'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/guard';
import { runAction, parseOrThrow, formDataToObject, type ActionState } from '@/server/action';
import { coordinateWork } from '@/server/services/coordination';
const schema=z.object({kind:z.enum(['entry','task']),id:z.string().min(1).max(100),updatedAt:z.coerce.date(),requestKey:z.string().uuid(),action:z.enum(['RECIBIR','ASIGNAR','SIGUIENTE','ACLARACION']),ownerId:z.string().max(100).optional(),nextAction:z.string().trim().min(1).max(1000)});
export async function coordinateWorkAction(_state:ActionState|null,form:FormData):Promise<ActionState>{
  return runAction(async()=>{
    const user=await requireUser();const input=parseOrThrow(schema,formDataToObject(form));
    await coordinateWork(user,input);
    for(const path of ['/coordinacion','/libro','/tareas','/supervision','/gerencia'])revalidatePath(path);
    revalidatePath(`${input.kind==='entry'?'/libro':'/tareas'}/${input.id}`);
    return {ok:true as const,message:input.action==='RECIBIR'?'Recepción confirmada. El trabajo sigue pendiente de atención.':input.action==='ACLARACION'?'Aclaración solicitada. El responsable y el historial se conservan.':'Responsable y siguiente acción actualizados.'};
  });
}
