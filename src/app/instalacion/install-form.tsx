'use client';

import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { installAction } from '@/server/actions/install';

export function InstallForm() {
  return (
    <ActionForm action={installAction} hideSuccess>
      <Field label="Nombre del hotel" name="hotelName" required>
        <Input name="hotelName" required autoFocus placeholder="Hotel Costa Serena" maxLength={80} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tu nombre" name="name" required>
          <Input
            name="name"
            required
            defaultValue="Erick Herrera"
            placeholder="Nombre y apellido"
            maxLength={120}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contraseña" name="password" required>
          <Input name="password" type="password" required autoComplete="new-password" />
        </Field>
        <Field label="Repetir contraseña" name="confirmPassword" required>
          <Input name="confirmPassword" type="password" required autoComplete="new-password" />
        </Field>
      </div>
      <SubmitButton className="w-full" size="lg" pendingLabel="Instalando…">
        Crear el sistema
      </SubmitButton>
    </ActionForm>
  );
}
