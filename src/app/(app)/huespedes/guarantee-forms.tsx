'use client';

import { ShieldCheck } from 'lucide-react';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  changeGuaranteeStateAction,
  createGuaranteeAction,
  deleteGuaranteeAction,
  updateGuaranteeAction,
} from '@/server/actions/references';
import { ROOM_NUMBER_OPTIONS } from '@/domain/room-catalog';
import {
  GUARANTEE_KIND_LABELS,
  GUARANTEE_STATE_ACTIONS,
  GUARANTEE_STATE_LABELS,
  allowedTransitions,
  type GuaranteeKindValue,
  type GuaranteeStateValue,
} from '@/domain/guarantees';

const KIND_OPTIONS = (Object.keys(GUARANTEE_KIND_LABELS) as GuaranteeKindValue[]).map((kind) => ({
  value: kind,
  label: GUARANTEE_KIND_LABELS[kind],
}));

/** Registrar una garantía sobre la reserva. */
export function GuaranteeDialog({
  reservationId,
  reservationCode,
  stayId,
  roomId,
}: {
  reservationId: string;
  reservationCode: string;
  stayId?: string | null;
  roomId?: string | null;
}) {
  return (
    <Dialog
      title={`Registrar garantía · reserva ${reservationCode}`}
      description="La garantía queda ligada a la reserva, así que sobrevive a un cambio de habitación y a los turnos."
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger={
        <>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Agregar garantía
        </>
      }
    >
      <ActionForm action={createGuaranteeAction} closeOnSuccess resetOnSuccess>
        <input type="hidden" name="reservationReferenceId" value={reservationId} />
        {stayId ? <input type="hidden" name="stayId" value={stayId} /> : null}
        {roomId ? <input type="hidden" name="roomId" value={roomId} /> : null}
        <Field label="Forma" name="kind" required>
          <Select name="kind" options={KIND_OPTIONS} defaultValue="TARJETA" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto" name="amount" required>
            <Input name="amount" required inputMode="decimal" placeholder="100000" />
          </Field>
          <Field label="Moneda" name="currency" hint="Código de tres letras.">
            <Input name="currency" defaultValue="CLP" maxLength={3} />
          </Field>
        </div>
        <Field
          label="Estado inicial"
          name="state"
          hint="«Pendiente» si todavía no se ha tomado."
        >
          <Select
            name="state"
            defaultValue="VIGENTE"
            options={[
              { value: 'VIGENTE', label: GUARANTEE_STATE_LABELS.VIGENTE },
              { value: 'PENDIENTE', label: GUARANTEE_STATE_LABELS.PENDIENTE },
            ]}
          />
        </Field>
        <Field label="Observaciones" name="notes">
          <Textarea name="notes" rows={2} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Registrando…">Registrar garantía</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function GuaranteeEditDialog({
  guaranteeId,
  kind,
  state,
  amount,
  currency,
  guestName,
  roomNumber,
  reference,
  dueAt,
  notes,
}: {
  guaranteeId: string;
  kind: GuaranteeKindValue;
  state: GuaranteeStateValue;
  amount: string;
  currency: string;
  guestName?: string | null;
  roomNumber?: string | null;
  reference?: string | null;
  dueAt?: string;
  notes?: string | null;
}) {
  const terminal = state === 'DEVUELTA' || state === 'MULTA' || state === 'CERRADA';
  const kindLocked = state !== 'PENDIENTE';

  return (
    <Dialog
      title="Editar garantía"
      description="Corrige los datos del registro sin borrar su historial. El estado se gestiona por separado con «Resolver»."
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger="Editar"
    >
      <ActionForm action={updateGuaranteeAction} closeOnSuccess>
        <input type="hidden" name="id" value={guaranteeId} />

        {kindLocked ? <input type="hidden" name="kind" value={kind} /> : null}
        <Field
          label="Forma"
          name="kind"
          hint={kindLocked ? 'La forma queda fija una vez que la garantía está vigente.' : undefined}
        >
          <Select
            name="kind"
            options={KIND_OPTIONS}
            defaultValue={kind}
            disabled={kindLocked}
          />
        </Field>

        {terminal ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monto" name="amount" required>
              <Input name="amount" required inputMode="decimal" defaultValue={amount} />
            </Field>
            <Field label="Moneda" name="currency">
              <Input name="currency" defaultValue={currency} maxLength={3} />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Huésped / persona" name="guestName">
            <Input name="guestName" maxLength={160} defaultValue={guestName ?? ''} />
          </Field>
          <Field label="Habitación" name="roomNumber">
            <Select
              name="roomNumber"
              placeholder="Sin habitación"
              defaultValue={roomNumber ?? ''}
              options={ROOM_NUMBER_OPTIONS}
            />
          </Field>
        </div>

        <Field label="Referencia" name="reference">
          <Input name="reference" maxLength={160} defaultValue={reference ?? ''} />
        </Field>
        <Field label="Vigencia / fecha objetivo" name="dueAt">
          <Input name="dueAt" type="datetime-local" defaultValue={dueAt ?? ''} />
        </Field>
        <Field label="Observaciones" name="notes">
          <Textarea name="notes" rows={2} defaultValue={notes ?? ''} />
        </Field>

        {terminal ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
            Esta garantía ya fue resuelta. El historial conserva el monto, la moneda y la forma de pago; todavía puedes corregir contexto y observaciones.
          </p>
        ) : null}

        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/**
 * Cambiar el estado de una garantía.
 *
 * Sólo ofrece las transiciones que el dominio permite: una devuelta no vuelve
 * a estar vigente y una cerrada no se reabre.
 */
export function GuaranteeStateDialog({
  guaranteeId,
  state,
  amount,
  currency,
}: {
  guaranteeId: string;
  state: GuaranteeStateValue;
  amount: string;
  currency: string;
}) {
  const options = allowedTransitions(state).map((next) => ({
    value: next,
    label: GUARANTEE_STATE_LABELS[next],
  }));

  if (options.length === 0) {
    return (
      <p className="mt-0.5 text-xs text-slate-400">
        {GUARANTEE_STATE_ACTIONS[state]}
      </p>
    );
  }

  return (
    <Dialog
      title="Resolver la garantía"
      description={`${currency} ${amount} · ${GUARANTEE_STATE_ACTIONS[state]}`}
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger="Resolver"
    >
      <ActionForm action={changeGuaranteeStateAction} closeOnSuccess>
        <input type="hidden" name="id" value={guaranteeId} />
        <Field label="Nuevo estado" name="state" required>
          <Select name="state" options={options} />
        </Field>
        <Field
          label="Monto aplicado"
          name="appliedAmount"
          hint="Obligatorio al aplicarla parcialmente. Lo que se cobró del consumo o de daños."
        >
          <Input name="appliedAmount" inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Motivo de la aplicación" name="applicationReason">
          <Input name="applicationReason" maxLength={500} placeholder="Opcional" />
        </Field>
        <Field
          label="Multa"
          name="penaltyAmount"
          hint="Obligatoria al cobrarla como multa. Es distinta del consumo."
        >
          <Input name="penaltyAmount" inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Observaciones" name="notes">
          <Textarea name="notes" rows={2} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function DeleteGuaranteeDialog({ guaranteeId }: { guaranteeId: string }) {
  return (
    <Dialog
      title="Eliminar garantía"
      description="Eliminación lógica: se conserva y queda en la auditoría."
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger="Eliminar"
    >
      <ActionForm action={deleteGuaranteeAction} closeOnSuccess>
        <input type="hidden" name="id" value={guaranteeId} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={3} required minLength={5} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Eliminando…">
            Eliminar
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
