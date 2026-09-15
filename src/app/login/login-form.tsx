'use client';

import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { loginAction } from '@/server/actions/auth';

export function LoginForm() {
  return (
    <ActionForm action={loginAction} hideSuccess>
      <Field label="Correo" name="email" required>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="nombre@hotel.com"
        />
      </Field>
      <Field label="Contraseña" name="password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Verificando…" size="lg">
        Entrar
      </SubmitButton>
    </ActionForm>
  );
}
