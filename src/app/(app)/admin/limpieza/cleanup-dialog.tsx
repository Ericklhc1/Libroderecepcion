'use client';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { cleanupAdminRecordAction, cleanupShiftMemberAction } from '@/server/actions/admin-cleanup';
import type { CleanupKind } from '@/server/services/admin-cleanup';

export function CleanupDialog({ kind, id, revision, label }: { kind: CleanupKind; id: string; revision: string; label: string }) {
  return <Dialog title="Eliminar dato de prueba" trigger="Eliminar" triggerVariant="danger" triggerSize="sm" width="sm"
    description={`Se retirará «${label}» de la operación conservando el historial. En Caja, anular un movimiento modifica el efectivo esperado; sus documentos de origen y arqueos históricos se conservan. ${kind === 'fronti' ? 'En Fronti privado también se retira la memoria derivada de esa conversación.' : ''}`}>
    <ActionForm action={cleanupAdminRecordAction} closeOnSuccess>
      <input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/>
      <Field name="reason" label="Motivo" required><Textarea name="reason" required minLength={5} maxLength={500}/></Field>
      <Field name="confirmation" label="Escribe ELIMINAR para confirmar" required><Input name="confirmation" required pattern="ELIMINAR" autoComplete="off"/></Field>
      <SubmitButton variant="danger" pendingLabel="Eliminando…">Eliminar dato de prueba</SubmitButton>
    </ActionForm>
  </Dialog>;
}
export function CleanupShiftMemberDialog({ shiftId, userId, name }: { shiftId: string; userId: string; name: string }) {
  return <Dialog title={`Retirar a ${name}`} trigger={`Retirar a ${name}`} triggerVariant="danger" triggerSize="sm" width="sm"
    description="Se termina sólo esta participación. El turno y su historial permanecen. Si sale el titular, se promueve al apoyo restante; si sale la última persona, el turno queda anulado y consultable, sin borrar sus registros. Disponible en turnos iniciados o activos.">
    <ActionForm action={cleanupShiftMemberAction} closeOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId}/><input type="hidden" name="userId" value={userId}/>
      <Field name="reason" label="Motivo" required><Textarea name="reason" required minLength={5} maxLength={500}/></Field>
      <Field name="confirmation" label="Escribe RETIRAR para confirmar" required><Input name="confirmation" required pattern="RETIRAR" autoComplete="off"/></Field>
      <SubmitButton variant="danger" pendingLabel="Retirando…">Retirar persona</SubmitButton>
    </ActionForm>
  </Dialog>;
}
