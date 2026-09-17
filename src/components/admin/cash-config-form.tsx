'use client';

import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { saveCashConfigurationAction } from '@/server/actions/cash-config';

export function CashConfigForm({
  clpMinimum,
  usdMinimum,
}: {
  clpMinimum: number;
  usdMinimum: number;
}) {
  return (
    <ActionForm action={saveCashConfigurationAction} className="space-y-3">
      <p className="text-sm text-slate-600">
        Caja trabaja únicamente con CLP y USD. Define cuánto debe quedar como caja mínima por divisa.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Caja mínima CLP" name="clpMinimum" required>
          <Input name="clpMinimum" type="number" min={0} step={1} defaultValue={clpMinimum} required />
        </Field>
        <Field label="Caja mínima USD" name="usdMinimum" required>
          <Input name="usdMinimum" type="number" min={0} step="0.01" defaultValue={usdMinimum} required />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar Caja</SubmitButton>
      </div>
    </ActionForm>
  );
}
