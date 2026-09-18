'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  createManualCashMovementAction,
  returnCashGuaranteeAction,
  saveLiveCashAuditAction,
  voidGymPassAction,
} from '@/server/actions/live-cash';

function formatFolio(folio: number) {
  return String(folio).padStart(4, '0');
}

export function ManualCashMovementForm() {
  return (
    <ActionForm action={createManualCashMovementAction} className="space-y-3" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de movimiento" name="direction" required>
          <Select
            name="direction"
            required
            placeholder="Selecciona"
            options={[
              { value: 'ENTRADA', label: 'Ingreso' },
              { value: 'SALIDA', label: 'Egreso' },
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
        <Input name="amount" inputMode="decimal" min="0.01" step="0.01" required placeholder="0" />
      </Field>
      <Field label="Concepto" name="reference" required hint="Ej.: cambio para caja, reembolso, compra menor, diferencia autorizada.">
        <Input name="reference" maxLength={120} required placeholder="Describe por qué entra o sale dinero" />
      </Field>
      <Field label="Observaciones" name="notes">
        <Textarea name="notes" rows={2} maxLength={1000} placeholder="Opcional" />
      </Field>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        Sólo se puede registrar mientras tengas un turno abierto o recibido. El movimiento queda ligado al turno, al Libro y a Auditoría.
      </p>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Registrando…">Registrar movimiento</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function LiveCashAuditForm({
  currency,
  denominations,
}: {
  currency: string;
  denominations: Array<{ id: string; value: number; medium: 'BILLETE' | 'MONEDA' }>;
}) {
  const bills = denominations.filter((row) => row.medium === 'BILLETE');
  const coins = denominations.filter((row) => row.medium === 'MONEDA');

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
              <span className="text-sm font-medium tabular text-petrol-900">
                {currency} {denomination.value.toLocaleString('es-CL')}
              </span>
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
    <ActionForm action={saveLiveCashAuditAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="currency" value={currency} />
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        Cuenta físicamente la Caja por billetes y monedas. El total se calcula a partir de las cantidades; no se escribe a mano.
      </p>
      <div className="space-y-3">
        {rows(bills, 'Billetes')}
        {rows(coins, 'Monedas')}
      </div>
      <Field label="Observaciones" name="notes" hint="Opcional. Úsalo para explicar una diferencia.">
        <Textarea name="notes" rows={2} maxLength={1000} placeholder="Ej.: faltan CLP 2.000 al corroborar." />
      </Field>
      <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-900 ring-1 ring-gold-200">
        Corroborar no ajusta ni «hace cuadrar» la Caja. Si existe una diferencia, queda registrada y visible para seguimiento.
      </p>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Corroborando…">Guardar corroboración</SubmitButton>
      </div>
    </ActionForm>
  );
}


export function ReturnCashGuaranteeForm({
  guaranteeId,
  reservationCode,
}: {
  guaranteeId: string;
  reservationCode: string;
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
        title={`Devolver garantía · ID ${reservationCode}`}
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
