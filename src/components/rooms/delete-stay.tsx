'use client';

import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { deleteStayAction, resetRoomAction } from '@/server/actions/rooms';

/**
 * Eliminación de una estadía para desatascar un conflicto.
 *
 * Es del Administrador de sistema, y por eso vive en un diálogo aparte con un
 * motivo obligatorio en lugar de un botón suelto: no es una acción del mesón,
 * es una reparación, y tiene que costar el gesto de explicarla.
 */
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
        `Se elimina de forma lógica —queda en el registro y el Administrador de sistema ` +
        `puede restaurarla— y la llave que tuviera asignada vuelve al inventario. ` +
        `Úsalo para resolver un conflicto de la habitación ${roomNumber}, no para dar de ` +
        `baja a un huésped: eso son la salida y el check-in.`
      }
    >
      <ActionForm action={deleteStayAction} closeOnSuccess>
        <input type="hidden" name="stayId" value={stayId} />
        <Field
          label="Motivo"
          name="reason"
          required
          hint="Queda en la auditoría. Explica qué conflicto resuelve."
        >
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

/**
 * Reseteo de la habitación: colapsa las estadías duplicadas.
 *
 * Es la salida cuando la duplicidad impide confirmar un check-in o un
 * check-out. No borra la habitación: conserva una estadía por reserva y fase,
 * la de estado más avanzado, y vuelve a aplicar la regla de la llave.
 */
export function ResetRoomDialog({ roomNumber }: { roomNumber: string }) {
  return (
    <Dialog
      trigger="Resetear la habitación"
      triggerVariant="secondary"
      title={`Resetear la habitación ${roomNumber}`}
      description={
        'Úsalo cuando la habitación no deje confirmar el check-in o el check-out por una ' +
        'duplicidad. Conserva una estadía por reserva —la más avanzada—, elimina lógicamente ' +
        'las repetidas, devuelve al inventario las llaves que quedaron sueltas y vuelve a ' +
        'aplicar la regla de la llave principal. Si no hay nada duplicado, no toca nada.'
      }
    >
      <ActionForm action={resetRoomAction} closeOnSuccess={false}>
        <input type="hidden" name="roomNumber" value={roomNumber} />
        <Field
          label="Motivo"
          name="reason"
          required
          hint="Queda en la auditoría. Describe qué no te dejaba confirmar."
        >
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
