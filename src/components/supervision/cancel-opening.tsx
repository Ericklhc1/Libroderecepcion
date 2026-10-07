'use client';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { cancelSupervisionOpeningAction } from '@/server/actions/supervision-center';
export function CancelSupervisionOpeningDialog({ shiftId }: { shiftId: string }) {
  return <Dialog title="Cancelar apertura" trigger="Cancelar apertura" triggerVariant="danger" triggerSize="sm" width="sm"
    description="La preparación quedará cancelada. No se borran pendientes, Caja, garantías, evidencia PMS ni su historial. Esto no cierra un turno activo.">
    <ActionForm action={cancelSupervisionOpeningAction} closeOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId}/>
      <Field name="reason" label="Motivo" required><Textarea name="reason" required minLength={5} maxLength={500}/></Field>
      <Field name="confirmation" label="Escribe CANCELAR para confirmar" required><Input name="confirmation" required pattern="CANCELAR" autoComplete="off"/></Field>
      <SubmitButton variant="danger" pendingLabel="Cancelando…">Cancelar apertura</SubmitButton>
    </ActionForm>
  </Dialog>;
}
