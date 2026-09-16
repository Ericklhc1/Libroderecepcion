'use client';

import { LogIn, LogOut } from 'lucide-react';
import { ActionForm, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { confirmCheckInAction, confirmCheckOutAction } from '@/server/actions/rooms';

/**
 * Confirmación de salida y de check-in.
 *
 * Las dos son un botón y un diálogo de una sola pantalla: en el mesón no hay
 * tiempo para formularios largos. La confirmación se pide porque estos dos
 * gestos mueven al huésped de una capa a otra.
 *
 * La llave NO forma parte de la confirmación de salida. Un huésped puede haber
 * dejado la habitación y seguir debiendo una llave: la habitación se libera y
 * el objeto físico queda pendiente hasta que recepción lo reciba desde el
 * módulo de llaves. Mezclar ambas cosas dejaba C/O abiertos sólo para poder
 * representar una llave que no volvió.
 */
export function StayActions({
  kind,
  stayId,
  guest,
  roomNumber,
  availableKeys = [],
}: {
  kind: 'checkout' | 'checkin';
  stayId: string;
  guest: string;
  roomNumber: string;
  availableKeys?: Array<{ value: string; label: string }>;
}) {
  if (kind === 'checkout') {
    return (
      <div className="mt-3">
        <Dialog
          title={`Confirmar la salida de la ${roomNumber}`}
          description={`${guest} deja la habitación. Las llaves se reciben por separado: si siguen fuera, quedan pendientes de devolución hasta que recepción las reciba.`}
          triggerVariant="primary"
          triggerSize="sm"
          triggerClassName="w-full"
          trigger={
            <>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Confirmar salida
            </>
          }
        >
          <ActionForm action={confirmCheckOutAction} closeOnSuccess>
            <input type="hidden" name="stayId" value={stayId} />
            <Field label="Nota" name="note" hint="Opcional. Queda en el historial de la habitación.">
              <Input name="note" maxLength={300} placeholder="Ej: huésped salió sin devolver una copia" />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Confirmando…">
              Confirmar salida
            </SubmitButton>
          </ActionForm>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <Dialog
        title={`Confirmar el check-in de la ${roomNumber}`}
        description={`${guest} pasa a in house y recibe su llave. Hasta este momento no tiene ninguna.`}
        triggerVariant="gold"
        triggerSize="sm"
        triggerClassName="w-full"
        trigger={
          <>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Confirmar check-in
          </>
        }
      >
        <ActionForm action={confirmCheckInAction} closeOnSuccess>
          <input type="hidden" name="stayId" value={stayId} />
          <Field
            label="Llave a entregar"
            name="keyId"
            hint="Si no eliges ninguna, se entrega la llave principal de la habitación."
          >
            <Select
              name="keyId"
              placeholder="Llave principal de la habitación"
              options={availableKeys}
            />
          </Field>
          <Field label="Nota" name="note">
            <Input name="note" maxLength={300} placeholder="Opcional" />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Confirmando…">
            Confirmar check-in y entregar llave
          </SubmitButton>
        </ActionForm>
      </Dialog>
    </div>
  );
}
