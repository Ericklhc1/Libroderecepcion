'use client';

import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { saveLiveCashAuditAction, voidGymPassAction } from '@/server/actions/live-cash';
import { formatGymFolio } from '@/server/services/live-cash';

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
      title={`Anular folio ${formatGymFolio(folio)}`}
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
