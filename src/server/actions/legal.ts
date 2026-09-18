'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { requestMeta } from '@/server/auth/session';
import { RuleError } from '@/server/errors';
import { acceptCurrentTerms } from '@/server/services/legal-acceptance';

export async function acceptTermsAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let accepted = false;

  const result = await runAction(async () => {
    const user = await requireUser();
    if (user.mustChangePassword) {
      throw new RuleError('Primero debes definir tu contraseña personal.');
    }

    if (String(formData.get('accept') ?? '') !== 'yes') {
      throw new RuleError('Debes leer y aceptar los términos para continuar.');
    }

    const meta = await requestMeta();
    await acceptCurrentTerms(user, meta);
    accepted = true;

    revalidatePath('/');
    return {
      ok: true as const,
      message: 'Términos aceptados.',
    };
  });

  if (accepted) redirect('/');
  return result;
}
