'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/server/action';
import { executePlan, readExecution } from '@/server/ai/execution/service';
import { RuleError } from '@/server/errors';

/** Secrets/files stay in this authenticated request, never in a model, plan or audit. */
export async function completeProtectedFrontiStep(_: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = z.string().min(1).max(100).parse(form.get('executionId'));
    const position = z.coerce.number().int().nonnegative().max(11).parse(form.get('position'));
    z.literal('AUTHORIZE_DISPLAYED_STEP').parse(form.get('authorization'));
    const before = await readExecution(id);
    const next = before.steps.findIndex(step => step.status !== 'SUCCEEDED');
    if (next !== position || before.steps[next]?.status !== 'PENDING' || !before.steps[next]?.requiresProtectedInput) throw new RuleError('Este paso ya no está pendiente. Consulta su resultado antes de continuar.');
    let credentials: Extract<ActionState, {ok:true}>['credentials'];
    const result = await executePlan(id, true, {position, form, receiveResult: native => { if(native.ok) credentials = native.credentials; }});
    const step = result.steps[position]!;
    if(step.status !== 'SUCCEEDED') return {ok:false,error:'El paso no se completó. Consulta su resultado; no repitas efectos con resultado incierto.'};
    revalidatePath('/fronti/procedimientos');
    return {ok:true,message:'Paso completado. Consulta los resultados para continuar los pasos restantes.',...(credentials?{credentials}:{})};
  });
}
