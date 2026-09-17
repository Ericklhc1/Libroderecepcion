'use client';

import { useState } from 'react';
import { KeyRound, LogIn, LogOut } from 'lucide-react';
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
  assignedKeyCount = 0,
}: {
  kind: 'checkout' | 'early-checkout' | 'checkin';
  stayId: string;
  guest: string;
  roomNumber: string;
  availableKeys?: Array<{ value: string; label: string }>;
  assignedKeyCount?: number;
}) {
  const [keyDecision, setKeyDecision] = useState<'return' | 'none'>('return');
  const [returnedCount, setReturnedCount] = useState(Math.max(assignedKeyCount, 1));

  if (kind === 'checkout' || kind === 'early-checkout') {
    const early = kind === 'early-checkout';
    const effectiveReturned =
      assignedKeyCount === 0 ? 0 : keyDecision === 'none' ? 0 : Math.min(returnedCount, assignedKeyCount);

    return (
      <div className="mt-3">
        <Dialog
          title={early ? `Check-out anticipado de la ${roomNumber}` : `Confirmar la salida de la ${roomNumber}`}
          description={
            early
              ? `${guest} todavía figura In House. Se conservará la salida prevista en el historial y se registrará el cambio como check-out anticipado.`
              : `${guest} deja la habitación. Los pendientes de la estadía se conservarán ligados a su reserva.`
          }
          triggerVariant="primary"
          triggerSize="sm"
          triggerClassName="w-full"
          trigger={
            <>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {early ? 'C/O anticipado' : 'Confirmar salida'}
            </>
          }
        >
          <ActionForm action={completeStayCheckoutAction} closeOnSuccess>
            <input type="hidden" name="stayId" value={stayId} />
            <input type="hidden" name="returnedKeyCount" value={effectiveReturned} />

            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-petrol-900">Devolución de llaves</p>
              </div>

              {assignedKeyCount === 0 ? (
                <p className="mt-2 text-sm text-slate-600">
                  El estado actual de la habitación no registra llaves entregadas a esta estadía.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    El sistema registra {assignedKeyCount} llave{assignedKeyCount === 1 ? '' : 's'} entregada{assignedKeyCount === 1 ? '' : 's'}.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setKeyDecision('return')}
                      className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ${
                        keyDecision === 'return'
                          ? 'bg-petrol-700 text-white ring-petrol-700'
                          : 'bg-white text-petrol-800 ring-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      Devuelve llave/s
                    </button>
                    <button
                      type="button"
                      onClick={() => setKeyDecision('none')}
                      className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ${
                        keyDecision === 'none'
                          ? 'bg-red-700 text-white ring-red-700'
                          : 'bg-white text-red-700 ring-slate-300 hover:bg-red-50'
                      }`}
                    >
                      No devuelve llave/s
                    </button>
                  </div>

                  {keyDecision === 'return' && assignedKeyCount > 1 ? (
                    <div className="mt-3">
                      <label htmlFor={`returned-keys-${stayId}`} className="label-base">
                        ¿Cuántas llaves devuelve?
                      </label>
                      <select
                        id={`returned-keys-${stayId}`}
                        value={Math.min(returnedCount, assignedKeyCount)}
                        onChange={(event) => setReturnedCount(Number(event.currentTarget.value))}
                        className="input-base mt-1 max-w-40"
                      >
                        {Array.from({ length: assignedKeyCount }, (_, index) => index + 1).map((count) => (
                          <option key={count} value={count}>
                            {count} de {assignedKeyCount}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {keyDecision === 'none' ? (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      La salida podrá confirmarse, pero las {assignedKeyCount} llave{assignedKeyCount === 1 ? '' : 's'} quedará{assignedKeyCount === 1 ? '' : 'n'} pendiente{assignedKeyCount === 1 ? '' : 's'} de devolución.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <Field label="Nota" name="note" hint="Opcional. Queda en el historial de la estadía.">
              <Input
                name="note"
                maxLength={300}
                placeholder={early ? 'Ej.: huésped decide retirarse antes de la fecha prevista' : 'Opcional'}
              />
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
