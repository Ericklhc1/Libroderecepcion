'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, X } from 'lucide-react';
import { ActionForm, Field, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  addShiftMemberAction,
  cancelHandoverPreparationAction,
  closeShiftAction,
  confirmHandoverReviewStepAction,
  openShiftAction,
  prepareHandoverAction,
  receiveHandoverAction,
  sendHandoverAction,
} from '@/server/actions/shifts';
import {
  SHIFT_EMERGENCY_REASON_KEYS,
  SHIFT_EMERGENCY_REASON_LABEL,
  SHIFT_WINDOW_LABEL,
} from '@/domain/shift';

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
  receiving = false,
}: {
  suggestedType: 'DIA' | 'NOCHE';
  guided?: boolean;
  guidanceSession?: number;
  receiving?: boolean;
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
        buttonLabel={receiving ? 'INICIAR RECEPCIÓN DE TURNO' : 'Abrir mi turno'}
        title={receiving ? 'Vas a iniciar la recepción del turno' : 'Vas a iniciar tu turno'}
        description={
          receiving
            ? 'Tu turno quedará INICIADO mientras revisas y recibes el relevo. La operación se habilita sólo al confirmar la recepción.'
            : 'El Libro te habilitará la operación y desde aquí irá marcando qué paso corresponde.'
        }
        steps={
          receiving
            ? [
                'Confirma el turno sugerido según la hora.',
                'El Libro vinculará la entrega pendiente a tu turno y lo dejará en estado INICIADO.',
                'Revisa la entrega, recuenta Caja y garantías, y confirma la custodia física dentro de Mi turno.',
                'Al confirmar la recepción, tu turno pasará a ACTIVO y se habilitará la operación.',
              ]
            : [
                'Confirma el turno sugerido según la hora.',
                'Al abrirlo, Novedades, Caja y Llaves quedan disponibles para tu cuenta.',
                'Durante el turno, registra sólo lo que realmente ocurra; no necesitas preparar el cierre todavía.',
                'Cuando termines, usa INICIAR CIERRE DE TURNO: el sistema te llevará por Caja, entrega y cierre final.',
              ]
        }
        confirmLabel={receiving ? 'INICIAR RECEPCIÓN' : 'INICIAR MI TURNO'}
        pendingLabel={receiving ? 'Iniciando recepción…' : 'Abriendo…'}
      />
    </ActionForm>
  );
}

/**
 * Excepción controlada cuando el turno saliente no puede terminar su cierre.
 *
 * La primera acción sólo abre la advertencia. El servidor exige además causa
 * cerrada + aceptación expresa; ocultar o manipular el modal no permite saltar
 * esas condiciones.
 */
export function EmergencyOpenShiftForm({
  suggestedType,
}: {
  suggestedType: 'DIA' | 'NOCHE';
}) {
  const [open, setOpen] = useState(false);

  return (
    <ActionForm action={openShiftAction} hideSuccess refreshOnSuccess className="space-y-2">
      <input type="hidden" name="type" value={suggestedType} />
      <input type="hidden" name="continuity" value="1" />

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
      >
        EVALUAR TURNO DE EMERGENCIA
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-petrol-950/60 p-4 no-print"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="emergency-shift-title"
            className="max-h-[min(92vh,48rem)] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-red-200"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-red-700">EXCEPCIÓN OPERATIVA</p>
                <h2
                  id="emergency-shift-title"
                  className="mt-1 text-xl font-semibold text-petrol-950"
                >
                  El turno saliente todavía no está cerrado
                </h2>
                <p className="mt-2 text-sm leading-5 text-slate-700">
                  La regla normal es esperar el cierre del recepcionista saliente. Abrir un turno de
                  emergencia rompe el relevo secuencial y queda registrado para revisión de
                  Supervisión.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="Cerrar advertencia"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
              <p className="text-sm font-semibold text-red-900">
                Sólo procede por una de estas razones:
              </p>
              <div className="mt-2 space-y-2">
                {SHIFT_EMERGENCY_REASON_KEYS.map((reason) => (
                  <label
                    key={reason}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-white px-3 py-2.5 text-sm text-slate-700 ring-1 ring-red-100"
                  >
                    <input
                      type="radio"
                      name="emergencyReason"
                      value={reason}
                      required
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>{SHIFT_EMERGENCY_REASON_LABEL[reason]}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs leading-4 text-red-800">
                Un atraso, descuido u olvido del cierre no es por sí solo una causa válida.
              </p>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              <input
                type="checkbox"
                name="emergencyAccepted"
                value="1"
                required
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                Comprendo que este inicio es una excepción, que el turno saliente seguirá pendiente
                hasta su cierre formal y que Supervisión recibirá una alerta crítica mientras la
                situación no se regularice.
              </span>
            </label>

            <p className="mt-4 text-xs text-slate-500">
              Se abrirá el turno {suggestedType === 'DIA' ? 'DÍA' : 'NOCHE'} ·{' '}
              {SHIFT_WINDOW_LABEL[suggestedType]}.
            </p>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                VOLVER Y ESPERAR EL CIERRE DEL SALIENTE
              </button>
              <SubmitButton variant="danger" pendingLabel="Abriendo emergencia…">
                ABRIR TURNO DE EMERGENCIA
              </SubmitButton>
            </div>
          </div>
        </div>
      ) : null}
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
  finalActivation = false,
}: {
  shiftId?: string;
  handoverId?: string | null;
  hasHandover?: boolean;
  finalActivation?: boolean;
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
        {finalActivation ? 'CONFIRMAR RECEPCIÓN Y ABRIR MI TURNO' : 'Confirmar recepción operativa'}
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
  const router = useRouter();

  return (
    <ActionForm
      action={prepareHandoverAction}
      hideSuccess
      className="space-y-0"
      onSuccess={(state) => {
        if (state.id) router.push(`/turno/entrega/${state.id}?paso=1`);
      }}
    >
      <input type="hidden" name="shiftId" value={shiftId} />
      <GuidedShiftSubmit
        guided={guided}
        session={guidanceSession}
        buttonLabel="INICIAR CIERRE DE TURNO"
        title="Vas a iniciar el cierre"
        description="Desde este punto el sistema cambia de operación a cierre. El Libro te llevará por una pantalla a la vez."
        steps={[
          'Caja, garantías y elementos: cuenta, valida y deja Caja formalmente cerrada.',
          'Novedades y pendientes: revisa lo que seguirá vigente después de tu turno.',
          'Revisión final: comprueba exactamente qué información vas a entregar.',
          'Envío: confirma la entrega. Hasta ese momento puedes volver atrás o cancelar el cierre.',
          'Cierre formal: una vez enviada la entrega, termina tu responsabilidad sobre el turno.',
        ]}
        confirmLabel="SÍ, INICIAR CIERRE"
        pendingLabel="Iniciando cierre…"
      />
    </ActionForm>
  );
}

export function ConfirmHandoverReviewStepForm({
  handoverId,
  step,
  urgentCount = 0,
}: {
  handoverId: string;
  step: 'PENDINGS' | 'FINAL';
  urgentCount?: number;
}) {
  const router = useRouter();
  const nextStep = step === 'PENDINGS' ? 3 : 4;

  return (
    <ActionForm
      action={confirmHandoverReviewStepAction}
      hideSuccess
      className="space-y-3"
      onSuccess={() => router.push(`/turno/entrega/${handoverId}?paso=${nextStep}`)}
    >
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="step" value={step} />

      {step === 'FINAL' && urgentCount > 0 ? (
        <label className="flex items-start gap-3 rounded-xl bg-red-50 px-3 py-3 text-sm text-red-950 ring-1 ring-red-200">
          <input
            type="checkbox"
            name="urgentAcknowledged"
            value="1"
            required
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            Revisé expresamente {urgentCount} punto(s) urgente(s) y comprendo que continuarán
            visibles para el turno entrante hasta su resolución.
          </span>
        </label>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton variant="gold" pendingLabel="Confirmando…">
          {step === 'PENDINGS'
            ? 'CONFIRMAR PENDIENTES REVISADOS'
            : 'CONFIRMAR REVISIÓN FINAL'}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SendHandoverForm({ shiftId }: { shiftId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <ActionForm action={sendHandoverAction} hideSuccess refreshOnSuccess className="space-y-2">
      <input type="hidden" name="shiftId" value={shiftId} />
      <p className="text-xs text-slate-500">
        Éste es el punto de no retorno del cierre normal. Antes de enviarla todavía puedes volver a cualquier paso o cancelar el cierre.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
      >
        REVISAR Y ENVIAR ENTREGA
      </button>

      {open ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-petrol-950/60 p-4 no-print">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-handover-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">
                  Confirmación de envío
                </p>
                <h2 id="send-handover-title" className="mt-1 text-lg font-semibold text-petrol-950">
                  ¿Estás seguro/a de que quieres enviar la entrega?
                </h2>
                <p className="mt-2 text-sm leading-5 text-slate-600">
                  Después de enviarla quedará registrada de forma permanente. Ya no podrás cancelar el cierre ni editarla desde el flujo normal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar confirmación"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                VOLVER A REVISAR
              </button>
              <SubmitButton variant="gold" pendingLabel="Enviando…">
                SÍ, ENVIAR ENTREGA
              </SubmitButton>
            </div>
          </div>
        </div>
      ) : null}
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
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (guided) {
    return (
      <ActionForm
        action={closeShiftAction}
        hideSuccess
        className="space-y-0"
        onSuccess={() => router.push('/turno')}
      >
        <input type="hidden" name="shiftId" value={shiftId} />
        <GuidedShiftSubmit
          guided
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

  return (
    <ActionForm
      action={closeShiftAction}
      hideSuccess
      className="space-y-0"
      onSuccess={() => router.push('/turno')}
    >
      <input type="hidden" name="shiftId" value={shiftId} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
      >
        CERRAR MI TURNO
      </button>

      {open ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-petrol-950/60 p-4 no-print">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-shift-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-gold-200"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">Último paso</p>
            <h2 id="close-shift-title" className="mt-1 text-lg font-semibold text-petrol-950">
              ¿Confirmas el cierre definitivo de tu turno?
            </h2>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              La entrega ya fue enviada. Al confirmar dejarás de ocupar el turno y terminará tu
              responsabilidad operativa. La validación de Supervisión ocurrirá después.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                VOLVER
              </button>
              <SubmitButton variant="gold" pendingLabel="Cerrando…">
                SÍ, CERRAR TURNO
              </SubmitButton>
            </div>
          </div>
        </div>
      ) : null}
    </ActionForm>
  );
}

export function CancelPreparationForm({ shiftId }: { shiftId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <ActionForm
      action={cancelHandoverPreparationAction}
      hideSuccess
      className="space-y-0"
      onSuccess={() => router.push('/turno')}
    >
      <input type="hidden" name="shiftId" value={shiftId} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-red-700"
      >
        Cancelar cierre
      </button>

      {open ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-petrol-950/60 p-4 no-print">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-close-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-red-200"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
              Volver a operación
            </p>
            <h2 id="cancel-close-title" className="mt-1 text-lg font-semibold text-petrol-950">
              ¿Estás seguro/a de que quieres cancelar el cierre?
            </h2>
            <p className="mt-2 text-sm leading-5 text-slate-600">
              Tu turno volverá a ACTIVO. Los arqueos y las confirmaciones de revisión se invalidarán y deberán hacerse otra vez. Las notas del borrador de esta entrega pueden requerir volver a registrarse. Ningún ingreso, egreso, garantía, devolución o transferencia ya realizada será borrado.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                CONTINUAR CON EL CIERRE
              </button>
              <SubmitButton variant="danger" pendingLabel="Cancelando…">
                SÍ, CANCELAR CIERRE
              </SubmitButton>
            </div>
          </div>
        </div>
      ) : null}
    </ActionForm>
  );
}
