'use client';

import { ActionForm, Field, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  addShiftMemberAction,
  cancelHandoverPreparationAction,
  closeShiftAction,
  openShiftAction,
  prepareHandoverAction,
  receiveHandoverAction,
  sendHandoverAction,
} from '@/server/actions/shifts';
import { SHIFT_WINDOW_LABEL } from '@/domain/shift';

/**
 * Entrar al mesón.
 *
 * **Un botón para las dos cosas.** Si no hay turno abierto, lo abre; si ya hay
 * uno, se suma a ése. Quien llega no tiene por qué saber cuál de los dos casos
 * es, y ofrecerle la elección era pedirle que decidiera algo que el sistema ya
 * sabe. El tipo se propone según el reloj y se puede cambiar.
 */
export function OpenShiftForm({
  suggestedType,
  joining,
}: {
  suggestedType: 'DIA' | 'NOCHE';
  joining: boolean;
}) {
  return (
    <ActionForm action={openShiftAction} hideSuccess refreshOnSuccess>
      {joining ? (
        <SubmitButton variant="gold" pendingLabel="Entrando…">
          Sumarme al turno abierto
        </SubmitButton>
      ) : (
        <>
          <Field
            label="Turno"
            name="type"
            hint={`Propuesto según la hora: ${SHIFT_WINDOW_LABEL[suggestedType]}.`}
          >
            <Select
              name="type"
              defaultValue={suggestedType}
              options={[
                { value: 'DIA', label: `Día · ${SHIFT_WINDOW_LABEL.DIA}` },
                { value: 'NOCHE', label: `Noche · ${SHIFT_WINDOW_LABEL.NOCHE}` },
              ]}
            />
          </Field>
          <SubmitButton variant="gold" pendingLabel="Abriendo…">
            Abrir mi turno
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Suma a otra persona al turno vigente. */
export function AddShiftMemberForm({
  shiftId,
  candidates,
}: {
  shiftId: string;
  candidates: Array<{ value: string; label: string }>;
}) {
  if (candidates.length === 0) return null;
  return (
    <ActionForm action={addShiftMemberAction} refreshOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      <Field
        label="Sumar a alguien al turno"
        name="userId"
        hint="Quien se suma queda como apoyo; el titular sigue siendo quien lo abrió."
      >
        <Select name="userId" required placeholder="Elige a la persona" options={candidates} />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Sumando…">
        Sumar al turno
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
    <ActionForm action={sendHandoverAction} hideSuccess className="space-y-2">
      <input type="hidden" name="shiftId" value={shiftId} />
      <p className="text-xs text-slate-500">
        La nota para el turno siguiente se guarda arriba como Observación + Siguiente acción. Aquí sólo se confirma el envío.
      </p>
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
    <ActionForm action={closeShiftAction} hideSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton variant="secondary" pendingLabel="Cerrando…">
        Cerrar turno
      </SubmitButton>
    </ActionForm>
  );
}
