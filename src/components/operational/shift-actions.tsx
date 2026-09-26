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

/** El turno propio sólo se abre cuando ya no queda una entrega cerrada por recibir. */
export function OpenShiftForm({ suggestedType }: { suggestedType: 'DIA' | 'NOCHE' }) {
  return (
    <ActionForm action={openShiftAction} hideSuccess refreshOnSuccess>
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
    </ActionForm>
  );
}

/**
 * Vía de escape controlada cuando el turno anterior quedó atascado.
 *
 * No exige que la persona diagnostique el problema: inicia su turno, conserva
 * el cierre anterior pendiente y genera trazabilidad crítica para Supervisión.
 */
export function ContinuityOpenShiftForm({
  suggestedType,
}: {
  suggestedType: 'DIA' | 'NOCHE';
}) {
  return (
    <ActionForm action={openShiftAction} hideSuccess refreshOnSuccess className="space-y-2">
      <input type="hidden" name="type" value={suggestedType} />
      <input type="hidden" name="continuity" value="1" />
      <input
        type="hidden"
        name="continuityReason"
        value="El turno saliente no completó el cierre antes del relevo."
      />
      <p className="text-xs text-amber-900">
        Se iniciará el turno {suggestedType === 'DIA' ? 'DÍA' : 'NOCHE'} ·{' '}
        {SHIFT_WINDOW_LABEL[suggestedType]}. El cierre anterior quedará pendiente y alertado para
        Supervisión.
      </p>
      <SubmitButton variant="gold" pendingLabel="Iniciando continuidad…">
        INICIAR TURNO POR CONTINGENCIA
      </SubmitButton>
    </ActionForm>
  );
}

/** Suma a otra persona al turno vigente. */
export function AddShiftMemberForm({
  shiftId,
  candidates,
}: {
  shiftId: string;
  candidates: Array<{ value: string; label: string; disabled?: boolean }>;
}) {
  if (candidates.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        Todos los usuarios operativos disponibles ya están incorporados a este turno.
      </p>
    );
  }

  const enabled = candidates.some((candidate) => !candidate.disabled);

  return (
    <ActionForm action={addShiftMemberAction} refreshOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      <Field
        label="Compartir turno / sumar al equipo"
        name="userId"
        hint="Quien se suma queda como apoyo. Si aparece «en otro turno», primero debe terminar esa participación."
      >
        <Select name="userId" required placeholder="Elige a la persona" options={candidates} />
      </Field>
      {enabled ? (
        <SubmitButton variant="secondary" pendingLabel="Sumando…">
          Sumar al turno
        </SubmitButton>
      ) : (
        <p className="text-xs text-slate-500">
          No hay usuarios disponibles para incorporarse ahora.
        </p>
      )}
    </ActionForm>
  );
}

export function ReceiveHandoverForm({
  handoverId,
}: {
  shiftId?: string;
  handoverId?: string | null;
  hasHandover?: boolean;
}) {
  if (!handoverId) return null;

  return (
    <ActionForm action={receiveHandoverAction} hideSuccess refreshOnSuccess>
      <input type="hidden" name="handoverId" value={handoverId} />
      <Field
        label="Observaciones de recepción"
        name="observations"
        hint="Opcional: deja constancia de lo que revisaste o de cualquier discrepancia."
      >
        <Textarea name="observations" rows={2} placeholder="Recibido conforme…" />
      </Field>
      <SubmitButton variant="gold" pendingLabel="Confirmando…">
        Confirmar recepción operativa
      </SubmitButton>
    </ActionForm>
  );
}

export function PrepareHandoverForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={prepareHandoverAction} hideSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton variant="gold" pendingLabel="Iniciando cierre…">
        INICIAR CIERRE DE TURNO
      </SubmitButton>
    </ActionForm>
  );
}

export function SendHandoverForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={sendHandoverAction} hideSuccess className="space-y-2">
      <input type="hidden" name="shiftId" value={shiftId} />
      <p className="text-xs text-slate-500">
        Revisa Novedades, Caja y pendientes antes de enviar la entrega.
      </p>
      <SubmitButton variant="gold" pendingLabel="Enviando…">
        Enviar entrega al turno siguiente
      </SubmitButton>
    </ActionForm>
  );
}

export function CloseShiftForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={closeShiftAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton variant="gold" pendingLabel="Cerrando…">
        Cerrar mi turno
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
