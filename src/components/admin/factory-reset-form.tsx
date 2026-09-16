'use client';

import { useState } from 'react';
import { ActionForm, Checkbox, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { factoryResetAction } from '@/server/actions/factory-reset';

/**
 * Confirmación de la puesta en cero.
 *
 * **El botón está deshabilitado hasta que la frase coincide.** Es deliberado:
 * lo que protege de un borrado accidental no es un diálogo que se cierra con
 * Enter, sino tener que escribir algo a mano. El servidor valida la frase
 * igualmente —la interfaz no es la única puerta— pero así nadie llega a
 * enviarla por error.
 *
 * Las dos decisiones que quedan abiertas son las que de verdad dependen del
 * momento: si las estadías del PMS se van (se recargan los informes) y si las
 * demás cuentas se van (se recrean con el modelo nuevo).
 */
export function FactoryResetForm({
  phrase,
  stays,
  batches,
  users,
}: {
  phrase: string;
  stays: number;
  batches: number;
  users: number;
}) {
  const [written, setWritten] = useState('');
  const matches = written.trim().toUpperCase() === phrase;

  return (
    <ActionForm action={factoryResetAction} refreshOnSuccess>
      <div className="space-y-3">
        <Checkbox
          name="includeStays"
          value="true"
          label={`Borrar también las estadías y los informes del PMS (${stays} estadías, ${batches} lotes)`}
          hint="Déjalo marcado si vas a cargar los informes de nuevo. Sin marcar, el tablero de habitaciones conserva lo que hay."
          defaultChecked
        />
        <Checkbox
          name="includeUsers"
          value="true"
          label={`Borrar las demás cuentas de usuario (${Math.max(users - 1, 0)} además de la tuya)`}
          hint="Útil para volver a crear el equipo con el modelo nuevo: nombre, usuario y contraseña. Tu cuenta nunca se borra."
        />
      </div>

      <Field
        label={`Escribe «${phrase}» para confirmar`}
        name="phrase"
        required
        hint="En mayúsculas o minúsculas, da igual. Lo que importa es escribirlo."
      >
        <Input
          name="phrase"
          required
          autoComplete="off"
          value={written}
          onChange={(event) => setWritten(event.target.value)}
          placeholder={phrase}
        />
      </Field>

      <SubmitButton
        variant="danger"
        disabled={!matches}
        pendingLabel="Dejando el sistema en cero…"
      >
        Dejar el sistema en cero
      </SubmitButton>
    </ActionForm>
  );
}
