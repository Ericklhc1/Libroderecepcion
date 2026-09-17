'use client';

import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { resetRoomAction } from '@/server/actions/rooms';
import { deleteStayPreservingPendingAction } from '@/server/actions/stay-lifecycle';

export function DeleteStayDialog({
  stayId,
  reservationId,
  roomNumber,
}: {
  stayId: string;
  reservationId: string;
  roomNumber: string;
}) {
  return (
    <Dialog
      trigger="Eliminar estadía"
      triggerVariant="ghost"
      title={`Eliminar la estadía ${reservationId}`}
      description={
        `Se elimina de forma lógica y conserva cualquier pendiente de la estadía en el historial heredable. ` +
        `La llave que tuviera asignada vuelve al inventario. Úsalo para resolver un conflicto de la habitación ${roomNumber}.`
      }
    >
      <ActionForm action={deleteStayPreservingPendingAction} closeOnSuccess>
        <input type="hidden" name="stayId" value={stayId} />
        <Field label="Motivo" name="reason" required hint="Queda en la auditoría. Explica qué conflicto resuelve.">
          <Textarea
            name="reason"
            rows={3}
            maxLength={500}
            required
            placeholder="Estadía duplicada: la misma reserva llegó en dos informes del PMS."
          />
        </Field>
        <SubmitButton variant="danger" pendingLabel="Eliminando…">
          Eliminar la estadía
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

export function ResetRoomDialog({ roomNumber }: { roomNumber: string }) {
  return (
    <Dialog
      trigger="Resetear la habitación"
      triggerVariant="secondary"
      title={`Resetear la habitación ${roomNumber}`}
      description={
        'Úsalo cuando la habitación no deje confirmar el check-in o el check-out por una duplicidad. Conserva una estadía por reserva —la más avanzada—, elimina lógicamente las repetidas, devuelve al inventario las llaves que quedaron sueltas y vuelve a aplicar la regla de la llave principal. Si no hay nada duplicado, no toca nada.'
      }
    >
      <ActionForm action={resetRoomAction} closeOnSuccess={false}>
        <input type="hidden" name="roomNumber" value={roomNumber} />
        <Field label="Motivo" name="reason" required hint="Queda en la auditoría. Describe qué no te dejaba confirmar.">
          <Textarea
            name="reason"
            rows={3}
            maxLength={500}
            required
            placeholder="No deja confirmar el check-out: la misma reserva aparece como Actual y Entrante."
          />
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Reseteando…">
          Resetear la habitación
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
