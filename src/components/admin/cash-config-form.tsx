'use client';

import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { saveCashConfigurationAction } from '@/server/actions/cash-config';

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-petrol-700"
      />
      <span>
        <span className="block text-sm font-medium text-petrol-900">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

export function CashConfigForm({
  clpMinimum,
  usdMinimum,
  treasuryTransfersEnabled,
  transferReceiptRequired,
  usdRateEnabled,
  requireDifferenceNote,
}: {
  clpMinimum: number;
  usdMinimum: number;
  treasuryTransfersEnabled: boolean;
  transferReceiptRequired: boolean;
  usdRateEnabled: boolean;
  requireDifferenceNote: boolean;
}) {
  return (
    <ActionForm action={saveCashConfigurationAction} className="space-y-4">
      <div>
        <p className="text-sm font-medium text-petrol-900">Fondos mínimos</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Caja trabaja únicamente con CLP y USD. Estos montos son el efectivo mínimo que debe quedar físicamente en el cajón y se hereda entre turnos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Caja mínima CLP" name="clpMinimum" required>
          <Input name="clpMinimum" type="number" min={0} step={1} defaultValue={clpMinimum} required />
        </Field>
        <Field label="Caja mínima USD" name="usdMinimum" required>
          <Input name="usdMinimum" type="number" min={0} step="0.01" defaultValue={usdMinimum} required />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-petrol-900">Reglas de operación</p>
        <div className="grid gap-2">
          <Toggle
            name="treasuryTransfersEnabled"
            label="Egresos a Tesorería"
            hint="Activa el módulo de egresos a Tesorería. Quién puede ejecutarlo se configura por rol en Administración → Roles y permisos."
            defaultChecked={treasuryTransfersEnabled}
          />
          <Toggle
            name="transferReceiptRequired"
            label="Exigir comprobante en egresos"
            hint="Cuando esté activo, no se podrá registrar un egreso sin referencia o número de comprobante."
            defaultChecked={transferReceiptRequired}
          />
          <Toggle
            name="usdRateEnabled"
            label="Declarar tipo de cambio USD/CLP"
            hint="Habilita la declaración del dólar del turno. El valor utilizado queda historizado por entrega."
            defaultChecked={usdRateEnabled}
          />
          <Toggle
            name="requireDifferenceNote"
            label="Exigir explicación si la caja no cuadra"
            hint="Si el efectivo contado difiere del fondo mínimo, exige una observación antes de enviar la entrega."
            defaultChecked={requireDifferenceNote}
          />
        </div>
      </div>

      <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-petrol-800 ring-1 ring-gold-200">
        Los permisos de Caja son granulares por rol: ingresos, egresos, garantías, arqueos, tesorería, dólar, cierre y reapertura se activan o desactivan por separado. La trazabilidad no se desactiva.
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar configuración de Caja</SubmitButton>
      </div>
    </ActionForm>
  );
}
