'use client';

import { LogIn, LogOut } from 'lucide-react';
import { ActionForm, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { confirmCheckInAction } from '@/server/actions/rooms';
import { completeStayCheckoutAction } from '@/server/actions/stay-lifecycle';

export function StayActions({
  kind,
  stayId,
  guest,
  roomNumber,
  availableKeys = [],
}: {
  kind: 'checkout' | 'early-checkout' | 'checkin';
  stayId: string;
  guest: string;
  roomNumber: string;
  availableKeys?: Array<{ value: string; label: string }>;
}) {
  if (kind === 'checkout' || kind === 'early-checkout') {
    const early = kind === 'early-checkout';
    return (
      <div className="mt-3">
        <Dialog
          title={early ? `Check-out anticipado de la ${roomNumber}` : `Confirmar la salida de la ${roomNumber}`}
          description={
            early
              ? `${guest} todavía figura In House. Se conservará la fecha de salida prevista en el historial y se registrará la salida real como anticipada. Los pendientes de esta estadía seguirán heredándose sin contaminar al próximo huésped.`
              : `${guest} deja la habitación. Los pendientes de esta estadía seguirán en el historial hasta resolverse. Las llaves se reciben por separado.`
          }
          triggerVariant="primary"
          triggerSize="sm"
          triggerClassName="w-full"
          trigger={
            <>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {early ? 'Realizar check-out anticipado' : 'Confirmar salida'}
            </>
          }
        >
          <ActionForm action={completeStayCheckoutAction} closeOnSuccess>
            <input type="hidden" name="stayId" value={stayId} />
            <Field label="Nota" name="note" hint="Opcional. Queda en el historial de la estadía.">
              <Input name="note" maxLength={300} placeholder={early ? 'Ej: huésped decide retirarse antes de la fecha prevista' : 'Ej: huésped salió sin devolver una copia'} />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Confirmando…">
              {early ? 'Confirmar check-out anticipado' : 'Confirmar salida'}
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
          <Field label="Llave a entregar" name="keyId" hint="Si no eliges ninguna, se entrega la llave principal de la habitación.">
            <Select name="keyId" placeholder="Llave principal de la habitación" options={availableKeys} />
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
