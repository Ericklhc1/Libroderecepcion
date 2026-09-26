'use client';

import { useState } from 'react';
import { Compass, X } from 'lucide-react';
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

function GuidedShiftSubmit({
  guided,
  session,
  buttonLabel,
  title,
  description,
  steps,
  confirmLabel,
  pendingLabel,
}: {
  guided: boolean;
  session: number;
  buttonLabel: string;
  title: string;
  description: string;
  steps: string[];
  confirmLabel: string;
  pendingLabel: string;
}) {
  const [open, setOpen] = useState(false);

  if (!guided) {
    return (
      <SubmitButton variant="gold" pendingLabel={pendingLabel}>
        {buttonLabel}
      </SubmitButton>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 transition-colors hover:bg-gold-400"
      >
        {buttonLabel}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-petrol-950/50 p-4 no-print"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shift-guide-title"
            className="max-h-[min(90vh,44rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-petrol-50 p-2 text-petrol-800">
                <Compass className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">
                  Guía ampliada · turno {session} de 5
                </p>
                <h2 id="shift-guide-title" className="mt-1 text-lg font-semibold text-petrol-950">
                  {title}
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="Cerrar explicación"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="mt-4 space-y-2">
              {steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-petrol-800 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="pt-0.5 text-sm leading-5 text-slate-700">{step}</span>
                </li>
              ))}
            </ol>

            <p className="mt-3 text-xs text-slate-500">
              Esta explicación ampliada se muestra durante tus primeros 5 turnos. Después el flujo
              sigue siendo el mismo, pero con menos texto.
            </p>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                Volver
              </button>
              <SubmitButton variant="gold" pendingLabel={pendingLabel}>
                {confirmLabel}
              </SubmitButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** El turno propio sólo se abre cuando ya no queda una entrega cerrada por recibir. */
export function OpenShiftForm({
  suggestedType,
  guided = false,
  guidanceSession = 1,
}: {
  suggestedType: 'DIA' | 'NOCHE';
  guided?: boolean;
  guidanceSession?: number;
}) {
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
      <GuidedShiftSubmit
        guided={guided}
        session={guidanceSession}
        buttonLabel="Abrir mi turno"
        title="Vas a iniciar tu turno"
        description="El Libro te habilitará la operación y desde aquí irá marcando qué paso corresponde."
        steps={[
          'Confirma el turno sugerido según la hora.',
          'Al abrirlo, Novedades, Caja y Llaves quedan disponibles para tu cuenta.',
          'Durante el turno, registra sólo lo que realmente ocurra; no necesitas preparar el cierre todavía.',
          'Cuando termines, usa INICIAR CIERRE DE TURNO: el sistema te llevará por Caja, entrega y cierre final.',
        ]}
        confirmLabel="INICIAR MI TURNO"
        pendingLabel="Abriendo…"
      />
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

export function PrepareHandoverForm({
  shiftId,
  guided = false,
  guidanceSession = 1,
}: {
  shiftId: string;
  guided?: boolean;
  guidanceSession?: number;
}) {
  return (
    <ActionForm action={prepareHandoverAction} hideSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <GuidedShiftSubmit
        guided={guided}
        session={guidanceSession}
        buttonLabel="INICIAR CIERRE DE TURNO"
        title="Vas a iniciar el cierre"
        description="Desde este punto el sistema cambia de operación a cierre. No necesitas inventar qué revisar: el flujo te lo irá pidiendo."
        steps={[
          'La operación normal de tu cuenta queda bloqueada para evitar cambios mientras cierras.',
          'Cuenta y valida Caja: fondo fijo por denominación y garantías por separado.',
          'Revisa el resumen de Novedades y pendientes que el Libro preparó automáticamente.',
          'Envía la entrega para dejar la liana disponible al siguiente turno.',
          'Cierra formalmente tu turno. Supervisión valida después; no tienes que esperar esa revisión.',
        ]}
        confirmLabel="SÍ, INICIAR CIERRE"
        pendingLabel="Iniciando cierre…"
      />
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

export function CloseShiftForm({
  shiftId,
  guided = false,
  guidanceSession = 1,
}: {
  shiftId: string;
  guided?: boolean;
  guidanceSession?: number;
}) {
  return (
    <ActionForm action={closeShiftAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <GuidedShiftSubmit
        guided={guided}
        session={guidanceSession}
        buttonLabel="Cerrar mi turno"
        title="Último paso: cerrar el turno"
        description="Este cierre termina tu responsabilidad operativa sobre el turno, pero conserva toda la trazabilidad."
        steps={[
          'Caja debe haber quedado cerrada.',
          'La entrega debe estar enviada y disponible para quien llegue después.',
          'Al confirmar, dejas de ocupar el turno y tu cuenta queda fuera de operación hasta iniciar otro.',
          'La validación de Supervisión ocurre después y no bloquea tu salida.',
        ]}
        confirmLabel="CERRAR TURNO"
        pendingLabel="Cerrando…"
      />
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
