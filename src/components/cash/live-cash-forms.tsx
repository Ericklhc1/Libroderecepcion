'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  createManualCashMovementAction,
  saveLiveCashAuditAction,
  voidGymPassAction,
} from '@/server/actions/live-cash';

function formatFolio(folio: number) {
  return String(folio).padStart(6, '0');
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

export function LiveCashAuditForm({ currency }: { currency: string }) {
  return (
    <ActionForm action={saveLiveCashAuditAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="currency" value={currency} />
      <Field label={`Total físico ${currency}`} name="countedAmount" required>
        <Input name="countedAmount" inputMode="decimal" required placeholder="0" />
      </Field>
      <Field label="Observaciones" name="notes">
        <Textarea name="notes" rows={2} placeholder="Opcional" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Auditando…">Registrar auditoría</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function VoidGymPassDialog({ id, folio }: { id: string; folio: number }) {
  return (
    <Dialog
      title={`Anular folio ${formatFolio(folio)}`}
      description="El folio no se elimina ni se reutiliza. Si fue pagado en efectivo, se registra la salida correspondiente de Caja viva."
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
