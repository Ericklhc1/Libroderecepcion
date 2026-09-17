'use client';

import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  changeFineStatusAction,
  createFineAction,
} from '@/server/actions/fines';
import {
  FINE_KIND_LABELS,
  FINE_STATUS_LABELS,
  LINEN_KIND_LABELS,
  allowedTransitions,
  type FineKindValue,
  type FineStatusValue,
} from '@/domain/fines';

export type FineContext = {
  roomNumber: string;
  stayId: string | null;
  reservationCode: string;
  guestName: string;
  reservationReferenceId: string | null;
};

/**
 * Formulario de multa.
 *
 * Es el de papel, con los mismos campos y en el mismo orden, porque llevaba
 * años funcionando. Lo único que cambia es que el número de reserva y el
 * nombre del huésped **vienen rellenos** desde la estadía de la habitación:
 * quien registra la multa tiene al huésped delante, y pedirle que transcriba
 * el número es pedirle que se equivoque. Siguen siendo editables, porque la
 * multa puede descubrirse después de que el PMS ya movió la habitación.
 *
 * Los campos de blanco y mancha aparecen sólo cuando lo que se cobra es un
 * blanco. El servidor valida lo mismo, así que esconderlos es comodidad, no
 * la regla.
 */
export function FineDialog({ context }: { context: FineContext }) {
  const [kind, setKind] = useState<FineKindValue>('BLANCO');
  const [linenKind, setLinenKind] = useState<string>('');

  const isLinen = kind === 'BLANCO';

  return (
    <Dialog
      triggerVariant="secondary"
      trigger={
        <>
          <Receipt className="h-4 w-4" aria-hidden="true" />
          Registrar multa
        </>
      }
      title={`Multa · habitación ${context.roomNumber}`}
      description="Cobro por blanco afectado, daño o faltante. Lo que escribas acá es lo que queda si el huésped lo discute."
    >
      <ActionForm action={createFineAction} closeOnSuccess resetOnSuccess>
        <input type="hidden" name="roomNumber" value={context.roomNumber} />
        {context.stayId ? (
          <input type="hidden" name="stayId" value={context.stayId} />
        ) : null}
        {context.reservationReferenceId ? (
          <input
            type="hidden"
            name="reservationReferenceId"
            value={context.reservationReferenceId}
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Número de ID de la reserva"
            name="reservationCode"
            required
            hint={context.reservationCode ? 'Viene de la estadía de la habitación.' : undefined}
          >
            <Input
              name="reservationCode"
              required
              maxLength={40}
              defaultValue={context.reservationCode}
              placeholder="7486899"
            />
          </Field>
          <Field label="Número de habitación" name="roomNumberShown">
            {/* Sólo informativo: el valor real viaja en el campo oculto. */}
            <Input value={context.roomNumber} readOnly disabled />
          </Field>
        </div>

        <Field
          label="Nombre completo del huésped"
          name="guestName"
          required
          hint={context.guestName ? 'Viene de la estadía de la habitación.' : undefined}
        >
          <Input
            name="guestName"
            required
            maxLength={150}
            defaultValue={context.guestName}
            placeholder="Angela Holzhauer"
          />
        </Field>

        <Field label="Qué se cobra" name="kind" required>
          <Select
            name="kind"
            required
            value={kind}
            onChange={(event) => setKind(event.target.value as FineKindValue)}
            options={Object.entries(FINE_KIND_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Field>

        {isLinen ? (
          <>
            <Field label="Tipo de blanco afectado" name="linenKind" required>
              <Select
                name="linenKind"
                required
                value={linenKind}
                onChange={(event) => setLinenKind(event.target.value)}
                placeholder="Elige el blanco"
                options={Object.entries(LINEN_KIND_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Field>
            {linenKind === 'OTRO' ? (
              <Field label="Detalla el blanco" name="itemDetail" required>
                <Input name="itemDetail" required maxLength={200} />
              </Field>
            ) : null}
            <Field
              label="Tipo de mancha identificada"
              name="stainType"
              required
              hint="De esto depende si la prenda se recupera o se pierde."
            >
              <Input
                name="stainType"
                required
                maxLength={200}
                placeholder="Maquillaje lápiz de ojos negro"
              />
            </Field>
          </>
        ) : (
          <Field label="Qué se dañó, faltó o se cobra" name="itemDetail" required>
            <Input
              name="itemDetail"
              required
              maxLength={200}
              placeholder="Velador de madera, tapa quemada"
            />
          </Field>
        )}

        <Field
          label="Motivo por el cual se considera procedente el cobro"
          name="reason"
          required
          hint="Cuando el huésped lo discuta, esto es lo único que queda."
        >
          <Textarea
            name="reason"
            rows={3}
            required
            maxLength={2000}
            placeholder="Multa: la mancha no se recupera con el lavado habitual."
          />
        </Field>

        <Field
          label="Observaciones o antecedentes sobre la negativa del huésped"
          name="guestStatement"
          hint="Su versión, tal como la dijo. Es lo que sostiene el cobro si escala."
        >
          <Textarea
            name="guestStatement"
            rows={3}
            maxLength={2000}
            placeholder="Según lo que comentó la huésped, encontraba totalmente normal usar la toalla de mano y mancharla al momento de su ducha."
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cantidad"
            name="quantity"
            hint="Unidades afectadas por esta misma multa. Por defecto 1."
          >
            <Input name="quantity" type="number" min={1} step={1} defaultValue={1} className="tabular" />
          </Field>
          <Field label="Monto (opcional)" name="amount" hint="Vacío si todavía no se tarifica.">
            <Input name="amount" type="number" min={1} step="0.01" className="tabular" />
          </Field>
        </div>

        <SubmitButton pendingLabel="Registrando…">Registrar la multa</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

/** Mueve el estado de una multa. Sólo ofrece las transiciones posibles. */
export function FineStatusDialog({
  fineId,
  roomNumber,
  status,
}: {
  fineId: string;
  roomNumber: string;
  status: FineStatusValue;
}) {
  const options = allowedTransitions(status);
  if (options.length === 0) {
    return (
      <p className="mt-1 text-xs text-slate-400">
        {FINE_STATUS_LABELS[status]}: no admite más cambios.
      </p>
    );
  }

  return (
    <Dialog
      trigger="Resolver"
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      title="Resolver la multa"
      description="Condonar o anular exige un motivo: sin él, la decisión no se sostiene."
    >
      <ActionForm action={changeFineStatusAction} closeOnSuccess>
        <input type="hidden" name="fineId" value={fineId} />
        <input type="hidden" name="roomNumber" value={roomNumber} />
        <Field label="Nuevo estado" name="status" required>
          <Select
            name="status"
            required
            options={options.map((option) => ({
              value: option,
              label: FINE_STATUS_LABELS[option],
            }))}
          />
        </Field>
        <Field
          label="Nota"
          name="note"
          hint="Obligatoria si condonas o anulas."
        >
          <Textarea name="note" rows={2} maxLength={500} />
        </Field>
        <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

/** Insignia del estado. Nunca sólo color: siempre con texto. */
export function FineBadge({ status }: { status: FineStatusValue }) {
  const tone =
    status === 'COBRADA'
      ? 'resuelto'
      : status === 'NOTIFICADA'
        ? 'atencion'
        : status === 'REGISTRADA'
          ? 'pendiente'
          : 'neutro';
  return <Badge tone={tone}>{FINE_STATUS_LABELS[status]}</Badge>;
}
