'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, X } from 'lucide-react';
import { ActionForm, Field, Select, Textarea } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { useShiftReturnNavigation, useShiftStartNavigation } from '@/components/operational/shift-start-navigation';
import { ShiftActionDialog } from './shift-action-dialog';
import {
  addShiftMemberAction,
  cancelHandoverPreparationAction,
  cancelShiftAction,
  closeShiftAction,
  confirmHandoverReviewStepAction,
  confirmReceptionReviewStepAction,
  openShiftAction,
  prepareHandoverAction,
  receiveHandoverAction,
  removeShiftMemberAction,
  changeShiftTypeAction,
  sendHandoverAction,
  startReceptionShiftAction,
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
      <Button
        type="button"
        variant="gold"
        onClick={() => setOpen(true)}
        className="min-h-10"
      >
        {buttonLabel}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-petrol-950/50 p-4 no-print"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shift-guide-title"
            className="max-h-[min(90vh,44rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-[0_18px_48px_-28px_rgba(9,24,32,0.48)] ring-1 ring-slate-200"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-petrol-50 p-2 text-petrol-800">
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
        description="La Central te habilitará la operación y desde aquí irá marcando qué paso corresponde."
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
            className="max-h-[min(92vh,48rem)] w-full max-w-xl overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-[0_18px_48px_-28px_rgba(9,24,32,0.48)] ring-1 ring-red-200"
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

            <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200">
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

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
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
                VOLVER Y ESPERAR EL CIERRE NORMAL
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

/** Saca a una persona del turno vigente conservando el historial de participación. */
export function RemoveShiftMemberForm({
  shiftId,
  participants,
}: {
  shiftId: string;
  participants: Array<{ value: string; label: string }>;
}) {
  if (participants.length <= 1) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        El turno necesita al menos una persona activa. No se puede retirar a la única persona.
      </p>
    );
  }

  return (
    <ActionForm action={removeShiftMemberAction} refreshOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      <Field
        label="Sacar del turno"
        name="userId"
        hint="La persona deja de participar desde este momento. Su participación anterior permanece en el historial."
      >
        <Select
          name="userId"
          required
          placeholder="Elige a la persona"
          options={participants}
        />
      </Field>
      <SubmitButton variant="danger" pendingLabel="Retirando…">
        Sacar del turno
      </SubmitButton>
    </ActionForm>
  );
}

/** Corrige el turno vigente entre las dos franjas canónicas. */
export function ChangeShiftTypeForm({
  shiftId,
  currentType,
}: {
  shiftId: string;
  currentType: 'DIA' | 'NOCHE';
}) {
  const nextType = currentType === 'DIA' ? 'NOCHE' : 'DIA';

  return (
    <ActionForm action={changeShiftTypeAction} refreshOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId} />
      <input type="hidden" name="type" value={nextType} />
      <p className="text-xs leading-5 text-slate-600">
        Tipo actual: <strong>{currentType === 'DIA' ? 'DÍA' : 'NOCHE'}</strong>. Al corregirlo,
        la fecha operativa se conserva y la ventana pasa a {SHIFT_WINDOW_LABEL[nextType]}.
      </p>
      <SubmitButton variant="secondary" pendingLabel="Cambiando turno…">
        CAMBIAR A TURNO {nextType === 'DIA' ? 'DÍA' : 'NOCHE'}
      </SubmitButton>
    </ActionForm>
  );
}

/** Permite a una persona operativa incorporarse al turno vigente sin abrir otro. */
export function JoinShiftForm({
  shiftId,
  userId,
}: {
  shiftId: string;
  userId: string;
}) {
  return (
    <ActionForm action={addShiftMemberAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton variant="gold" pendingLabel="Sumándote al turno…">
        SUMARME AL TURNO VIGENTE
      </SubmitButton>
    </ActionForm>
  );
}

export function StartReceptionShiftForm({
  handoverId,
  suggestedType,
  guided = false,
  guidanceSession = 1,
}: {
  handoverId: string;
  suggestedType: 'DIA' | 'NOCHE';
  guided?: boolean;
  guidanceSession?: number;
}) {
  const startReception = useShiftStartNavigation(startReceptionShiftAction, 'reception', handoverId);

  return (
    <ActionForm
      action={startReception}
      hideSuccess
      className="space-y-0"
    >
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="type" value={suggestedType} />
      <GuidedShiftSubmit
        guided={guided}
        session={guidanceSession}
        buttonLabel="INICIAR RECEPCIÓN DE TURNO"
        title="Vas a recibir el turno anterior"
        description="La Central abrirá tu turno en modo RECEPCIÓN. La operación seguirá bloqueada hasta completar el relevo."
        steps={[
          'Revisar entrega: lee los pendientes, prioridades y puntos urgentes.',
          'Recontar Caja: cuenta CLP/USD y valida físicamente las garantías.',
          'Recibir custodia: confirma llaves, teléfono y demás elementos declarados.',
          'Revisión final: compara lo declarado con lo que realmente recibiste.',
          'Confirmar y abrir: la entrega queda recibida y tu turno pasa a ACTIVO.',
        ]}
        confirmLabel="SÍ, INICIAR RECEPCIÓN"
        pendingLabel="Iniciando recepción…"
      />
    </ActionForm>
  );
}

export function CancelStartedShiftForm({ shiftId }: { shiftId: string }) {
  return (
    <ShiftActionDialog
      action={cancelShiftAction}
      shiftId={shiftId}
      trigger="Cancelar inicio"
      triggerVariant="danger"
      title="¿Cancelar este inicio de turno?"
      description="Disponible sólo mientras el turno siga INICIADO. El turno quedará ANULADO, se liberará la participación y, si había una entrega tomada sin custodia confirmada, volverá a quedar disponible para otra persona."
      backLabel="CONTINUAR RECEPCIÓN"
      confirmLabel="SÍ, CANCELAR INICIO"
      pendingLabel="Cancelando inicio…"
      variant="danger"
      refreshOnSuccess
    >
      <Field
        label="Motivo"
        name="reason"
        hint="Quedará registrado en Auditoría. Mínimo 5 caracteres."
      >
        <Textarea
          name="reason"
          rows={3}
          minLength={5}
          required
          placeholder="Ej.: recepción iniciada por error"
        />
      </Field>
    </ShiftActionDialog>
  );
}

export function ConfirmReceptionReviewStepForm({
  handoverId,
  step,
  urgentCount = 0,
  simpleNovelties = false,
}: {
  handoverId: string;
  step: 'BRIEFING' | 'CUSTODY' | 'FINAL';
  urgentCount?: number;
  simpleNovelties?: boolean;
}) {
  return (
    <ActionForm
      action={confirmReceptionReviewStepAction}
      hideSuccess
      refreshOnSuccess
      className="space-y-3"
    >
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="step" value={step} />

      {step === 'FINAL' && (simpleNovelties || urgentCount > 0) ? (
        <label className={`flex items-start gap-3 border px-3 py-3 text-sm ${urgentCount>0?'border-red-200 bg-red-50 text-red-950':'border-slate-300 bg-white text-petrol-900'}`}>
          <input
            type="checkbox"
            name="urgentAcknowledged"
            value="1"
            required
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            {simpleNovelties ? 'Estoy al tanto de las novedades.' : <>Revisé expresamente {urgentCount} punto(s) urgente(s) y comprendo que quedan bajo
            responsabilidad del turno que estoy recibiendo.</>}
          </span>
        </label>
      ) : null}

      <SubmitButton variant="gold" pendingLabel="Confirmando…">
        {step === 'BRIEFING'
          ? simpleNovelties ? 'Continuar a Caja y custodia' : 'CONFIRMAR ENTREGA REVISADA'
          : step === 'CUSTODY'
            ? 'CONFIRMAR CAJA Y CUSTODIA'
            : 'CONFIRMAR REVISIÓN FINAL'}
      </SubmitButton>
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
  const router = useRouter();
  if (!handoverId) return null;

  return (
    <ActionForm
      action={receiveHandoverAction}
      hideSuccess
      onSuccess={() => router.push('/turno')}
    >
      <input type="hidden" name="handoverId" value={handoverId} />
      <Field
        label="Observaciones de recepción"
        name="observations"
        hint="Opcional: deja constancia final de una diferencia, ausencia o antecedente relevante."
      >
        <Textarea name="observations" rows={2} placeholder="Recibido conforme…" />
      </Field>
      <SubmitButton variant="gold" pendingLabel="Activando turno…">
        CONFIRMAR RECEPCIÓN Y ABRIR MI TURNO
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
  const prepareHandover = useShiftStartNavigation(prepareHandoverAction, 'handover', shiftId);

  return (
    <ActionForm
      action={prepareHandover}
      hideSuccess
      className="space-y-0"
    >
      <input type="hidden" name="shiftId" value={shiftId} />
      <GuidedShiftSubmit
        guided={guided}
        session={guidanceSession}
        buttonLabel="INICIAR CIERRE DE TURNO"
        title="Vas a iniciar el cierre"
        description="Desde este punto el sistema cambia de operación a cierre. La Central te llevará por una pantalla a la vez."
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
  simpleNovelties = false,
}: {
  handoverId: string;
  step: 'PENDINGS' | 'FINAL';
  urgentCount?: number;
  simpleNovelties?: boolean;
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

      {step === 'FINAL' && (simpleNovelties || urgentCount > 0) ? (
        <label className={`flex items-start gap-3 border px-3 py-3 text-sm ${urgentCount>0?'border-red-200 bg-red-50 text-red-950':'border-slate-300 bg-white text-petrol-900'}`}>
          <input
            type="checkbox"
            name="urgentAcknowledged"
            value="1"
            required
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            {simpleNovelties ? 'Estoy al tanto de las novedades.' : <>Revisé expresamente {urgentCount} punto(s) urgente(s) y comprendo que continuarán
            visibles para el turno entrante hasta su resolución.</>}
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
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Éste es el punto de no retorno del cierre normal. Antes de enviarla todavía puedes volver a cualquier paso o cancelar el cierre.
      </p>
      <ShiftActionDialog
        action={sendHandoverAction}
        shiftId={shiftId}
        refreshOnSuccess
        trigger="REVISAR Y ENVIAR ENTREGA"
        triggerClassName="min-h-10"
        title="¿Estás seguro/a de que quieres enviar la entrega?"
        description="Después de enviarla quedará registrada de forma permanente. Ya no podrás cancelar el cierre ni editarla desde el flujo normal."
        backLabel="VOLVER A REVISAR"
        confirmLabel="SÍ, ENVIAR ENTREGA"
        pendingLabel="Enviando…"
      />
    </div>
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
  const closeShift = useShiftReturnNavigation(closeShiftAction, shiftId);

  return (
    <ShiftActionDialog
      action={closeShift}
      shiftId={shiftId}
      trigger={guided ? 'Cerrar mi turno' : 'CERRAR MI TURNO'}
      triggerClassName="min-h-10"
      title={guided ? 'Último paso: cerrar el turno' : '¿Confirmas el cierre definitivo de tu turno?'}
      description={guided
        ? 'Este cierre termina tu responsabilidad operativa sobre el turno, pero conserva toda la trazabilidad.'
        : 'La entrega ya fue enviada. Al confirmar dejarás de ocupar el turno y terminará tu responsabilidad operativa. La validación de Supervisión ocurrirá después.'}
      backLabel={guided ? 'Volver' : 'VOLVER'}
      confirmLabel={guided ? 'CERRAR TURNO' : 'SÍ, CERRAR TURNO'}
      pendingLabel="Cerrando…"
    >
      {guided ? (
        <>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gold-700">
            <Compass className="h-5 w-5" aria-hidden="true" />
            Guía ampliada · turno {guidanceSession} de 5
          </p>
          <ol className="space-y-2">
            {[
              'Caja debe haber quedado cerrada.',
              'La entrega debe estar enviada y disponible para quien llegue después.',
              'Al confirmar, dejas de ocupar el turno y tu cuenta queda fuera de operación hasta iniciar otro.',
              'La validación de Supervisión ocurre después y no bloquea tu salida.',
            ].map((step, index) => (
              <li key={step} className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-petrol-800 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-sm leading-5 text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">
            Esta explicación ampliada se muestra durante tus primeros 5 turnos. Después el flujo
            sigue siendo el mismo, pero con menos texto.
          </p>
        </>
      ) : null}
    </ShiftActionDialog>
  );
}

export function CancelPreparationForm({ shiftId }: { shiftId: string }) {
  const cancelPreparation = useShiftReturnNavigation(cancelHandoverPreparationAction, shiftId);

  return (
    <ShiftActionDialog
      action={cancelPreparation}
      shiftId={shiftId}
      trigger="Cancelar cierre"
      triggerVariant="ghost"
      title="¿Estás seguro/a de que quieres cancelar el cierre?"
      description="Tu turno volverá a ACTIVO. Los arqueos y las confirmaciones de revisión se invalidarán y deberán hacerse otra vez. Las notas del borrador de esta entrega pueden requerir volver a registrarse. Ningún ingreso, egreso, garantía, devolución o transferencia ya realizada será borrado."
      backLabel="CONTINUAR CON EL CIERRE"
      confirmLabel="SÍ, CANCELAR CIERRE"
      pendingLabel="Cancelando…"
      variant="danger"
    />
  );
}
