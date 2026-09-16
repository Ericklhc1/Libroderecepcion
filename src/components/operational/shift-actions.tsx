'use client';

import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  cancelHandoverPreparationAction,
  closeShiftAction,
  prepareHandoverAction,
  receiveHandoverAction,
  sendHandoverAction,
  startShiftAction,
} from '@/server/actions/shifts';

/**
 * Toma de turno. Viaja la franja (`AAAA-MM-DD:TIPO`), no un id de fila: sin
 * asignación previa el turno puede no existir hasta que alguien lo tome.
 */
export function StartShiftForm({ slot, label }: { slot: string; label: string }) {
  return (
    <ActionForm action={startShiftAction} hideSuccess className="space-y-0">
      <input type="hidden" name="slot" value={slot} />
      <SubmitButton variant="gold" pendingLabel="Iniciando…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Confirmación de recepción de la entrega anterior.
 *
 * El botón se deshabilita mientras la acción corre y el servidor rechaza una
 * segunda confirmación, de modo que una entrega no puede recibirse dos veces.
 */
export function ReceiveHandoverForm({
  shiftId,
  handoverId,
  hasHandover,
}: {
  shiftId: string;
  handoverId?: string | null;
  hasHandover: boolean;
}) {
  return (
    <ActionForm action={receiveHandoverAction} hideSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      {handoverId ? <input type="hidden" name="handoverId" value={handoverId} /> : null}
      <Field
        label="Observaciones de recepción"
        name="observations"
        hint={
          hasHandover
            ? 'Opcional: deja constancia de lo que revisaste o de cualquier discrepancia.'
            : 'No hay entrega pendiente. Se registrará que activaste el turno sin entrega previa.'
        }
      >
        <Textarea name="observations" rows={2} placeholder="Recibido conforme…" />
      </Field>
      <SubmitButton variant="gold" pendingLabel="Confirmando…">
        {hasHandover ? 'Confirmar recepción del turno' : 'Activar turno sin entrega previa'}
      </SubmitButton>
    </ActionForm>
  );
}

export function PrepareHandoverForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={prepareHandoverAction} hideSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton variant="gold" pendingLabel="Generando resumen…">
        Preparar entrega de turno
      </SubmitButton>
    </ActionForm>
  );
}

export function SendHandoverForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={sendHandoverAction} hideSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      <Field
        label="Nota de cierre para el turno siguiente"
        name="notes"
        hint="Lo más importante, en pocas líneas. El resumen automático ya va incluido."
      >
        <Textarea
          name="notes"
          rows={3}
          placeholder="Prioridad de la tarde: llegada VIP de la 402 y regularizar el pago de la 215."
        />
      </Field>
      <SubmitButton variant="gold" pendingLabel="Enviando…">
        Enviar entrega al turno siguiente
      </SubmitButton>
    </ActionForm>
  );
}

export function CancelPreparationForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={cancelHandoverPreparationAction} hideSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Cancelando…">
        Cancelar preparación
      </SubmitButton>
    </ActionForm>
  );
}

export function CloseShiftForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={closeShiftAction} hideSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      <Field label="Observaciones de cierre" name="notes">
        <Textarea name="notes" rows={2} />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Cerrando…">
        Cerrar turno
      </SubmitButton>
    </ActionForm>
  );
}
