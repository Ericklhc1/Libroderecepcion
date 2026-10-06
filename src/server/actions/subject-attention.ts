'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireUser} from '@/server/auth/guard';
import {formDataToObject,runAction,type ActionState} from '@/server/action';
import {requestSubjectAttention} from '@/server/services/subject-attention';
const input=z.object({entryId:z.string().min(1).max(100),departmentId:z.string().min(1).max(100),requestKey:z.string().uuid(),revision:z.string().datetime(),assigneeId:z.string().max(100).optional().transform(v=>v||undefined),location:z.string().trim().max(160).optional().transform(v=>v||undefined)});
export async function requestSubjectAttentionAction(_state:ActionState|null,form:FormData):Promise<ActionState>{
  return runAction(async()=>{
    const user=await requireUser();const data=input.parse(formDataToObject(form));
    const result=await requestSubjectAttention(user,data);
    revalidatePath(`/libro/${data.entryId}`);revalidatePath('/coordinacion');revalidatePath('/tareas');revalidatePath('/housekeeping');
    return{ok:true as const,message:result.existing?'La atención existente conserva el mismo asunto.':'Atención solicitada. El resultado vuelve a este asunto.',id:result.id,navigateTo:`/libro/${encodeURIComponent(data.entryId)}`};
  });
}
