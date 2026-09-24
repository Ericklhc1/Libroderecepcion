'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  createCashDifferenceRegularizationAction,
  createGymPassAction,
  createManualCashMovementAction,
  markCashMovementAsRegularizationAction,
  returnCashGuaranteeAction,
  saveLiveCashAuditAction,
  voidGymPassAction,
} from '@/server/actions/live-cash';
import { createGuaranteeAction } from '@/server/actions/references';
import { DenominationVisual } from '@/components/cash/denomination-visual';

function formatFolio(folio: number) {
  return String(folio).padStart(4, '0');
}

export function CreateGymPassForm({
  defaultServiceDate,
}: {
  defaultServiceDate: string;
}) {
  return (
    <ActionForm action={createGymPassAction} className="space-y-3" resetOnSuccess>
      <Field
        label="Fecha del folio"
        name="serviceDate"
        required
        hint="Fecha de uso/servicio del gimnasio."
      >
        <Input name="serviceDate" type="date" required defaultValue={defaultServiceDate} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Habitación" name="roomNumber" required>
          <Input
            name="roomNumber"
            required
            maxLength={20}
            placeholder="Ej.: 512"
            autoComplete="off"
          />
        </Field>
        <Field label="Huésped" name="guestName" required>
          <Input
            name="guestName"
            required
            maxLength={160}
            placeholder="Nombre del huésped"
            autoComplete="off"
          />
        </Field>
      </div>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        El recepcionista se registra automáticamente con tu sesión. El folio no modifica el saldo de Caja.
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Generando…">Generar folio</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ManualCashMovementForm({
  allowIn = true,
  allowOut = true,
}: {
  allowIn?: boolean;
  allowOut?: boolean;
  /** Compatibilidad: el formulario ya no consume contexto PMS. */
  context?: {
    roomNumber?: string | null;
    reservationCode?: string | null;
    stayId?: string | null;
  };
}) {
  const directions = [
    ...(allowIn ? [{ value: 'ENTRADA', label: 'Ingreso' }] : []),
    ...(allowOut ? [{ value: 'SALIDA', label: 'Egreso' }] : []),
  ];

  return (
    <ActionForm action={createManualCashMovementAction} className="space-y-3" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de movimiento" name="direction" required>
          <Select
            name="direction"
            required
            placeholder="Selecciona"
            options={directions}
          />
        </Field>
        <Field label="Moneda" name="currency" required>
          <Select
            name="currency"
            required
            defaultValue="CLP"
            options={[
              { value: 'CLP', label: 'CLP · Pesos chilenos' },
              { value: 'USD', label: 'USD · Dólares' },
            ]}
          />
        </Field>
      </div>

      <Field label="Monto" name="amount" required>
        <Input
          name="amount"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          placeholder="0"
        />
      </Field>

      <Field
        label="Fecha/hora efectiva"
        name="effectiveAt"
        hint="Opcional. Vacío = ahora. La fecha real de registro se conserva aparte."
      >
        <Input name="effectiveAt" type="datetime-local" />
      </Field>

      <Field
        label="Concepto"
        name="reference"
        required
        hint="Ej.: cambio para Caja, reembolso o compra menor. No uses esta opción para devolver un faltante anterior."
      >
        <Input
          name="reference"
          maxLength={120}
          required
          placeholder="Describe por qué entra o sale dinero"
        />
      </Field>

      <Field label="Observaciones" name="notes">
        <Textarea name="notes" rows={2} maxLength={1000} placeholder="Opcional" />
      </Field>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        El movimiento queda ligado al usuario y a Auditoría. Ingreso/egreso cambia el efectivo esperado. Si el dinero sólo corrige un faltante o sobrante previo, usa «Regularizar diferencia».
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Registrando…">Registrar movimiento</SubmitButton>
      </div>
    </ActionForm>
  );
}


export function CashDifferenceRegularizationForm() {
  return (
    <ActionForm
      action={createCashDifferenceRegularizationAction}
      className="space-y-3"
      resetOnSuccess
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Movimiento físico" name="direction" required>
          <Select
            name="direction"
            required
            defaultValue="ENTRADA"
            options={[
              { value: 'ENTRADA', label: 'Entró dinero que faltaba' },
              { value: 'SALIDA', label: 'Salió dinero que sobraba' },
            ]}
          />
        </Field>
        <Field label="Moneda" name="currency" required>
          <Select
            name="currency"
            required
            defaultValue="CLP"
            options={[
              { value: 'CLP', label: 'CLP · Pesos chilenos' },
              { value: 'USD', label: 'USD · Dólares' },
            ]}
          />
        </Field>
      </div>

      <Field label="Monto" name="amount" required>
        <Input
          name="amount"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          placeholder="0"
        />
      </Field>

      <Field
        label="Fecha/hora efectiva"
        name="effectiveAt"
        hint="Opcional. Vacío = ahora."
      >
        <Input name="effectiveAt" type="datetime-local" />
      </Field>

      <Field
        label="Concepto"
        name="reference"
        required
        hint="Ej.: devolución de faltante detectado en arqueo anterior."
      >
        <Input
          name="reference"
          maxLength={120}
          required
          placeholder="Describe qué diferencia se está regularizando"
        />
      </Field>

      <Field label="Observaciones" name="notes">
        <Textarea name="notes" rows={2} maxLength={1000} placeholder="Opcional" />
      </Field>

      <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-900 ring-1 ring-gold-200">
        Esta operación deja trazabilidad del dinero que vuelve o sale para corregir una diferencia previa, pero no crea un ingreso o egreso operativo nuevo ni modifica el efectivo esperado.
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Regularizando…">Registrar regularización</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ReclassifyCashMovementDialog({
  movementId,
  label,
}: {
  movementId: string;
  label: string;
}) {
  return (
    <Dialog
      title="Reclasificar como regularización"
      description={`El movimiento ${label} seguirá existiendo y conservará su autor, fecha y monto. Sólo dejará de incrementar o disminuir el efectivo esperado.`}
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger="Regularizar"
    >
      <ActionForm action={markCashMovementAsRegularizationAction} closeOnSuccess>
        <input type="hidden" name="movementId" value={movementId} />
        <Field label="Motivo" name="reason" required>
          <Textarea
            name="reason"
            rows={3}
            minLength={5}
            maxLength={500}
            required
            placeholder="Ej.: corresponde a los CLP 2.000 que regresaron tras el faltante del arqueo anterior."
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="gold" pendingLabel="Regularizando…">
            Confirmar regularización
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function CreateCashGuaranteeForm() {
  return (
    <ActionForm action={createGuaranteeAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="kind" value="EFECTIVO" />
      <input type="hidden" name="state" value="VIGENTE" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Moneda" name="currency" required>
          <Select
            name="currency"
            required
            defaultValue="CLP"
            options={[
              { value: 'CLP', label: 'CLP · Pesos chilenos' },
              { value: 'USD', label: 'USD · Dólares' },
            ]}
          />
        </Field>
        <Field label="Monto" name="amount" required>
          <Input
            name="amount"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            placeholder="0"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Huésped / persona" name="guestName" hint="Opcional. Texto libre.">
          <Input name="guestName" maxLength={160} placeholder="Nombre" />
        </Field>
        <Field label="Habitación" name="roomNumber" hint="Opcional. Texto libre.">
          <Input name="roomNumber" maxLength={20} placeholder="512" />
        </Field>
      </div>

      <Field
        label="Referencia"
        name="reference"
        hint="Opcional. Ej.: reserva, sobre, motivo o cualquier identificador útil."
      >
        <Input name="reference" maxLength={160} placeholder="Referencia libre" />
      </Field>

      <Field label="Vigencia / fecha objetivo" name="dueAt" hint="Opcional.">
        <Input name="dueAt" type="datetime-local" />
      </Field>

      <Field label="Observaciones" name="notes">
        <Textarea name="notes" rows={2} maxLength={1000} placeholder="Opcional" />
      </Field>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        La garantía queda bajo custodia de Caja. No necesita reserva, estadía ni sincronización con PMS.
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Registrando…">Registrar garantía</SubmitButton>
      </div>
    </ActionForm>
  );
}

type CashAuditGuarantee = {
  id: string;
  amount: number;
  guestName: string | null;
  roomNumber: string | null;
  reference: string | null;
};

type CashAuditDenomination = {
  id: string;
  value: number;
  medium: 'BILLETE' | 'MONEDA';
};

export function LiveCashAuditForm({
  currency,
  denominations,
  guarantees,
  onSuccess,
}: {
  currency: string;
  denominations: CashAuditDenomination[];
  guarantees: CashAuditGuarantee[];
  onSuccess?: (state: { ok: true; message: string; id?: string }) => void;
}) {
  const [validatedIds, setValidatedIds] = useState<Set<string>>(() => new Set());
  const bills = denominations.filter((row) => row.medium === 'BILLETE');
  const coins = denominations.filter((row) => row.medium === 'MONEDA');
  const allGuaranteesValidated = validatedIds.size === guarantees.length;

  function toggleGuarantee(id: string) {
    setValidatedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = (items: typeof denominations, label: string) =>
    items.length ? (
      <fieldset className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        <legend className="sr-only">{label}</legend>
        <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <div className="divide-y divide-slate-100">
          {items.map((denomination) => (
            <label
              key={denomination.id}
              className="grid grid-cols-[1fr_7rem] items-center gap-3 px-3 py-2"
            >
              <DenominationVisual
                currency={currency}
                value={denomination.value}
                medium={denomination.medium}
              />
              <Input
                name={`d_${denomination.id}`}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="0"
                className="h-9 text-right tabular"
              />
            </label>
          ))}
        </div>
      </fieldset>
    ) : null;

  return (
    <ActionForm
      action={saveLiveCashAuditAction}
      className="space-y-3"
      hideSuccess
      onSuccess={onSuccess}
    >
      <input type="hidden" name="currency" value={currency} />
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        Cuenta por billetes y monedas únicamente el fondo fijo. No incluyas aquí dinero de garantías.
      </p>
      <div className="space-y-3">
        {rows(bills, 'Billetes')}
        {rows(coins, 'Monedas')}
      </div>

      <fieldset className="overflow-hidden rounded-xl ring-1 ring-gold-200">
        <legend className="sr-only">Validación de garantías</legend>
        <div className="bg-gold-50 px-3 py-2">
          <p className="text-sm font-semibold text-petrol-900">Validar garantías en efectivo</p>
          <p className="mt-0.5 text-xs text-slate-600">
            Confirma cada garantía físicamente por separado. No forman parte de las denominaciones del fondo.
          </p>
        </div>
        {guarantees.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-500">No hay garantías vigentes en {currency}.</p>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {guarantees.map((guarantee) => {
                const validated = validatedIds.has(guarantee.id);
                return (
                  <div
                    key={guarantee.id}
                    className={`flex items-start gap-3 px-3 py-3 text-sm ${validated ? 'bg-emerald-50/60' : 'bg-white'}`}
                  >
                    {validated ? (
                      <input type="hidden" name={`g_${guarantee.id}`} value="1" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-petrol-900">
                        {guarantee.guestName ?? guarantee.reference ?? 'Garantía sin referencia'}
                        {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                      </p>
                      <p className="text-xs tabular text-slate-500">
                        {currency} {guarantee.amount.toLocaleString('es-CL')}
                        {guarantee.reference ? ` · ${guarantee.reference}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={validated ? 'secondary' : 'gold'}
                      aria-pressed={validated}
                      onClick={() => toggleGuarantee(guarantee.id)}
                      className={validated ? 'text-emerald-800 ring-emerald-300' : undefined}
                    >
                      {validated ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Validada
                        </>
                      ) : (
                        'Validar'
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-gold-100 bg-gold-50/60 px-3 py-2 text-xs font-medium text-slate-600">
              {validatedIds.size} de {guarantees.length} garantías validadas.
            </p>
          </>
        )}
      </fieldset>

      <Field label="Observaciones" name="notes" hint="Opcional. Úsalo para explicar una diferencia del fondo fijo.">
        <Textarea name="notes" rows={2} maxLength={1000} placeholder="Ej.: faltan CLP 2.000 al arquear." />
      </Field>
      <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-900 ring-1 ring-gold-200">
        El descuadre se calcula únicamente sobre el fondo fijo. Las garantías quedan registradas como validaciones independientes del mismo arqueo.
      </p>
      <div className="flex items-center justify-between gap-3">
        {guarantees.length > 0 && !allGuaranteesValidated ? (
          <p className="text-xs text-slate-500">Valida todas las garantías para continuar.</p>
        ) : (
          <span />
        )}
        <SubmitButton pendingLabel="Arqueando…" disabled={!allGuaranteesValidated}>
          Guardar arqueo
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function LiveCashAuditDialog({
  currency,
  fund,
  denominations,
  guarantees,
}: {
  currency: string;
  fund: number;
  denominations: CashAuditDenomination[];
  guarantees: CashAuditGuarantee[];
}) {
  const router = useRouter();
  const [auditOpen, setAuditOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleSuccess = useCallback((state: { ok: true; message: string }) => {
    setSuccessMessage(state.message);
    setAuditOpen(false);
    setSuccessOpen(true);
  }, []);

  function acceptSuccess() {
    setSuccessOpen(false);
    router.refresh();
  }

  return (
    <>
      <Dialog
        open={auditOpen}
        onOpenChange={setAuditOpen}
        title={`Arquear Caja ${currency}`}
        description={`Fondo fijo esperado: ${currency} ${fund.toLocaleString('es-CL')}. Las denominaciones validan sólo el fondo fijo; las garantías se confirman aparte.`}
        triggerVariant="secondary"
        triggerSize="sm"
        width="sm"
        trigger={
          <>
            <span aria-hidden="true">💵</span>
            Generar arqueo
          </>
        }
      >
        <LiveCashAuditForm
          currency={currency}
          denominations={denominations}
          guarantees={guarantees}
          onSuccess={handleSuccess}
        />
      </Dialog>

      <Dialog
        open={successOpen}
        onOpenChange={setSuccessOpen}
        dismissible={false}
        title="Arqueo guardado correctamente"
        description="La Caja fue actualizada con el nuevo arqueo."
        width="sm"
      >
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
          <p className="text-sm text-slate-600" role="status">{successMessage}</p>
          <div className="flex justify-center">
            <Button type="button" variant="gold" onClick={acceptSuccess}>
              Aceptar
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}


export function ReturnCashGuaranteeForm({
  guaranteeId,
  reference,
}: {
  guaranteeId: string;
  reference?: string | null;
}) {
  return (
    <ActionForm
      action={returnCashGuaranteeAction}
      className="space-y-0"
      hideSuccess
      refreshOnSuccess
    >
      <input type="hidden" name="guaranteeId" value={guaranteeId} />
      <SubmitButton
        variant="secondary"
        size="sm"
        pendingLabel="Devolviendo…"
        title={reference ? `Devolver garantía · ${reference}` : 'Devolver garantía'}
      >
        Devolver garantía
      </SubmitButton>
    </ActionForm>
  );
}

export function VoidGymPassDialog({ id, folio }: { id: string; folio: number }) {
  return (
    <Dialog
      title={`Anular folio ${formatFolio(folio)}`}
      description="El folio no se elimina ni se reutiliza. La anulación conserva toda la trazabilidad del pase."
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger="Anular"
    >
      <ActionForm action={voidGymPassAction} closeOnSuccess>
        <input type="hidden" name="id" value={id} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={3} minLength={5} required />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Anulando…">Anular folio</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
