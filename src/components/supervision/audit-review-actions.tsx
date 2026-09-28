'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  reviewSupervisionAuditItemAction,
  updateSupervisionAuditDeparturesPendingAction,
} from '@/server/actions/supervision-center';

export function AuditItemReviewDialog({
  auditImportId,
  target,
  itemKey,
  label,
}: {
  auditImportId: string;
  target: 'CHECK' | 'FINDING';
  itemKey: string;
  label: string;
}) {
  return (
    <Dialog
      title="Actualizar punto de auditoría"
      description="Esto actualiza tu trabajo de Supervisión, pero conserva intacto lo que decía el informe original."
      trigger="Resolver / retirar"
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
    >
      <ActionForm action={reviewSupervisionAuditItemAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="auditImportId" value={auditImportId} />
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="key" value={itemKey} />
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          {label}
        </p>
        <Field
          label="Resultado"
          name="status"
          required
          hint="«No aplica» exige una justificación y retira el punto de los pendientes activos."
        >
          <Select
            name="status"
            defaultValue="RESUELTO"
            options={[
              { value: 'RESUELTO', label: 'Resuelto · trabajo completado' },
              { value: 'NO_APLICA', label: 'No aplica · retirar del pendiente' },
            ]}
          />
        </Field>
        <Field label="Nota" name="note">
          <Textarea
            name="note"
            rows={3}
            placeholder="Qué se hizo o por qué este punto no aplica."
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Actualizando…">Guardar resultado</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function ReopenAuditReviewForm({
  auditImportId,
  target,
  itemKey,
}: {
  auditImportId: string;
  target: 'CHECK' | 'FINDING';
  itemKey: string;
}) {
  return (
    <ActionForm
      action={reviewSupervisionAuditItemAction}
      hideSuccess
      refreshOnSuccess
      className="space-y-0"
    >
      <input type="hidden" name="auditImportId" value={auditImportId} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="key" value={itemKey} />
      <input type="hidden" name="status" value="REABRIR" />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Reabriendo…">
        Reabrir
      </SubmitButton>
    </ActionForm>
  );
}

export function AuditDeparturesDialog({
  auditImportId,
  sourcePending,
  currentPending,
  total,
}: {
  auditImportId: string;
  sourcePending: number;
  currentPending: number;
  total: number | null;
}) {
  return (
    <Dialog
      title="Actualizar check-outs pendientes"
      description="El valor del informe queda como evidencia. Este ajuste representa el avance real durante tu turno."
      trigger="Actualizar pendientes"
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
    >
      <ActionForm
        action={updateSupervisionAuditDeparturesPendingAction}
        closeOnSuccess
        refreshOnSuccess
      >
        <input type="hidden" name="auditImportId" value={auditImportId} />
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          Informe: <strong>{sourcePending}</strong> pendiente(s)
          {total !== null ? ' de ' + total + ' salidas' : ''}. Estado operativo actual:{' '}
          <strong>{currentPending}</strong>.
        </div>
        <Field label="Pendientes ahora" name="value" required>
          <Input
            type="number"
            name="value"
            min={0}
            max={total ?? undefined}
            step={1}
            defaultValue={currentPending}
            required
          />
        </Field>
        <Field
          label="Qué cambió"
          name="note"
          required
          hint="Ej.: «Se completaron 3 check-outs y queda 1 por cobrar»."
        >
          <Textarea name="note" rows={3} required />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Actualizando…">Actualizar estado</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function ResetAuditDeparturesForm({ auditImportId }: { auditImportId: string }) {
  return (
    <ActionForm
      action={updateSupervisionAuditDeparturesPendingAction}
      hideSuccess
      refreshOnSuccess
      className="space-y-0"
    >
      <input type="hidden" name="auditImportId" value={auditImportId} />
      <input type="hidden" name="value" value="0" />
      <input type="hidden" name="reset" value="1" />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Restaurando…">
        Usar valor del informe
      </SubmitButton>
    </ActionForm>
  );
}