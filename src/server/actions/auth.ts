'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { AuditAction } from '@prisma/client';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { loginSchema, passwordChangeSchema } from '@/server/schemas';
import { clearSessionCookie, requestMeta, revokeSession, writeSessionCookie } from '@/server/auth/session';
import { getCurrentUser } from '@/server/auth/current-user';
import { requireUser } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';
import { authenticate, changeOwnPassword } from '@/server/services/auth';

/**
 * Inicio de sesión. La verificación de credenciales, el bloqueo por intentos
 * fallidos y la auditoría viven en `@/server/services/auth`; aquí sólo se
 * escribe la cookie httpOnly y se redirige.
 */
export async function loginAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let destination: string | null = null;

  const result = await runAction(async () => {
    const input = parseOrThrow(loginSchema, formDataToObject(formData));
    const meta = await requestMeta();
    const session = await authenticate({ ...input, ...meta });
    await writeSessionCookie(session.token, session.expiresAt);
    destination = session.mustChangePassword ? '/cambiar-contrasena' : '/';
    return { ok: true as const, message: 'Sesión iniciada' };
  });

  if (destination) redirect(destination);
  return result;
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await revokeSession(user.sessionId);
    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.LOGOUT,
      summary: `${user.name} cerró sesión`,
      user,
    });
  }
  await clearSessionCookie();
  redirect('/login');
}

export async function changePasswordAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(passwordChangeSchema, formDataToObject(formData));

    const session = await changeOwnPassword(user, input);
    await writeSessionCookie(session.token, session.expiresAt);

    revalidatePath('/');
    return {
      ok: true as const,
      message: 'Contraseña actualizada. Se cerraron las otras sesiones.',
    };
  });
}
