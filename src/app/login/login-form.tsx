'use client';

import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { loginAction } from '@/server/actions/auth';

export function LoginForm() {
  return (
    <ActionForm action={loginAction} hideSuccess>
      {/*
        Se entra con el usuario, no con el correo: la casilla de recepción la
        comparte todo el mesón, así que no identifica a nadie.
      */}
      <Field label="Usuario" name="username" required>
        <Input
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          placeholder="@EHerrera"
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
