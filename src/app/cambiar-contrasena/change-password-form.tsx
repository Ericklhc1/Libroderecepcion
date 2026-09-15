'use client';

import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { changePasswordAction } from '@/server/actions/auth';

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction}>
      <Field label="Contraseña actual" name="currentPassword" required>
        <Input name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Nueva contraseña" name="newPassword" required>
        <Input name="newPassword" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Repetir nueva contraseña" name="confirmPassword" required>
        <Input name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Guardando…">
        Cambiar contraseña
      </SubmitButton>
    </ActionForm>
  );
}
