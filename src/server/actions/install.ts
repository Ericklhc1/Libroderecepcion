'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, zRequiredString, type ActionState } from '@/server/action';
import { passwordSchema } from '@/server/auth/password';
import { needsInstall, runInstall } from '@/server/services/install';

const installSchema = z
  .object({
    hotelName: zRequiredString(80, 'El nombre del hotel'),
    name: zRequiredString(120, 'Tu nombre'),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Repite la contraseña'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

export async function installAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let installed = false;

  const result = await runAction(async () => {
    const input = parseOrThrow(installSchema, formDataToObject(formData));
    await runInstall(input);
    installed = true;
    return { ok: true as const, message: 'Sistema instalado.' };
  });

  if (installed) redirect('/login?instalado=1');
  return result;
}

/** Permite que el formulario sepa si otra persona completó la instalación. */
export async function checkInstallState(): Promise<{ pending: boolean }> {
  return { pending: await needsInstall() };
}
