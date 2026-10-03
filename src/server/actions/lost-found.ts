'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {requireUser} from '@/server/auth/guard';
import {runAction,parseOrThrow,formDataToObject,zOptionalDate,type ActionState} from '@/server/action';
import {createLostFound,changeLostFound} from '@/server/services/lost-found';
const text=(n:number)=>z.string().trim().max(n);
const optional=(n:number)=>text(n).optional().transform(v=>v||undefined);
export async function createLostFoundAction(_s:ActionState|null,form:FormData):Promise<ActionState>{return runAction(async()=>{const user=await requireUser();const input=parseOrThrow(z.object({requestKey:z.string().uuid(),item:text(240).min(1),foundLocation:text(240).min(1),foundAt:zOptionalDate.refine((value):value is Date=>value!==null,'Indica la fecha y hora del hallazgo.'),custodyLocation:text(240).min(1),custodianId:text(100).optional().transform(value=>value===''?null:value)}),formDataToObject(form));const r=await createLostFound(user,input);revalidatePath('/custodia');return{ok:true as const,message:`Objeto #${r.humanId} registrado en custodia.`,id:r.id};});}
export async function changeLostFoundAction(_s:ActionState|null,form:FormData):Promise<ActionState>{return runAction(async()=>{const user=await requireUser();const input=parseOrThrow(z.object({id:text(100).min(1),version:z.coerce.number().int().min(1),action:z.enum(['MOVER','ENTREGAR','DISPONER','REABRIR']),custodyLocation:optional(240),custodianId:text(100).optional().transform(value=>value===''?null:value),note:text(2000).min(1),evidenceNote:optional(1000)}),formDataToObject(form));const r=await changeLostFound(user,input);revalidatePath('/custodia');return{ok:true as const,message:`Objeto #${r.humanId} actualizado.`,id:r.id};});}
