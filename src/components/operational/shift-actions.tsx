'use client';

import Link from 'next/link';
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

/** Entrar al mesón: si no hay turno, lo abre; si ya hay uno, se suma. */
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
    <div className="space-y-3">
      <div className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-petrol-900 ring-1 ring-gold-200">
        <p className="font-medium">Antes de enviar: actualiza la fotografía PMS.</p>
        <p className="mt-0.5 text-xs text-slate-600">
          El cierre exige una carga nueva de Entradas, In house y Salidas posterior al inicio de la entrega.
        </p>
        <Link
          href="/huespedes/importar?volverA=turno"
          className="mt-2 inline-flex text-sm font-semibold text-petrol-700 underline-offset-2 hover:underline"
        >
          Cargar informes para el cierre
        </Link>
      </div>
      <ActionForm action={sendHandoverAction} hideSuccess className="space-y-2">
        <input type="hidden" name="shiftId" value={shiftId} />
        <p className="text-xs text-slate-500">
          La nota para el turno siguiente se guarda como Observación + Siguiente acción. Aquí sólo se confirma el envío.
        </p>
        <SubmitButton variant="gold" pendingLabel="Enviando…">
          Enviar entrega al turno siguiente
        </SubmitButton>
      </ActionForm>
    </div>
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

/**
 * El cierre final tiene dos pasos visibles y la base de datos refuerza el
 * orden. Si Caja está habilitada, el segundo botón no puede completar el
 * cierre hasta que exista un cierre de Caja vigente.
 */
export function CloseShiftForm({ shiftId }: { shiftId: string }) {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
      <Link
        href="/caja/cierre"
        className="flex items-center justify-center rounded-lg bg-petrol-700 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-800"
      >
        1. Revisar y cerrar Caja
      </Link>
      <ActionForm action={closeShiftAction} hideSuccess className="space-y-0">
        <input type="hidden" name="shiftId" value={shiftId} />
        <SubmitButton variant="secondary" pendingLabel="Cerrando…">
          2. Cerrar turno
        </SubmitButton>
      </ActionForm>
      <p className="text-[0.7rem] leading-snug text-slate-500">
        Si existe fondo de Caja y aún no está cuadrado/cerrado, el servidor rechazará el cierre del turno.
      </p>
    </div>
  );
}
