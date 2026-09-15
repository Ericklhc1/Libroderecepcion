'use client';

import { AlertOctagon, Undo2, Wrench } from 'lucide-react';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  reinstateKeyAction,
  returnKeyAction,
  setKeyIncidentStatusAction,
} from '@/server/actions/rooms';
import type { KeyStatusValue } from '@/domain/rooms';

/**
 * Gestos del inventario sobre una llave concreta.
 *
 * Se muestran sólo los que tienen sentido para su estado: una llave disponible
 * no se puede recibir, y una extraviada sólo se puede reintegrar.
 */
export function KeyRowActions({
  keyId,
  code,
  status,
  canAssign,
  canStock,
}: {
  keyId: string;
  code: string;
  status: KeyStatusValue;
  canAssign: boolean;
  canStock: boolean;
}) {
  const held = ['ASIGNADA', 'COPIA_ADICIONAL', 'PENDIENTE_DEVOLUCION'].includes(status);
  const parked = ['EXTRAVIADA', 'FUERA_DE_SERVICIO'].includes(status);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {canAssign && held ? (
        <Dialog
          title={`Recibir la llave ${code}`}
          description="Vuelve al inventario y queda disponible."
          triggerVariant="ghost"
          triggerSize="sm"
          trigger={
            <>
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Recibir
            </>
          }
        >
          <ActionForm action={returnKeyAction} closeOnSuccess>
            <input type="hidden" name="keyId" value={keyId} />
            <Field label="Nota" name="note">
              <Input name="note" maxLength={300} placeholder="Opcional" />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Recibiendo…">
              Confirmar recepción
            </SubmitButton>
          </ActionForm>
        </Dialog>
      ) : null}

      {canStock && !parked ? (
        <>
          <Dialog
            title={`Marcar ${code} como extraviada`}
            description="Sale del stock y queda registrada como pérdida."
            triggerVariant="ghost"
            triggerSize="sm"
            trigger={
              <>
                <AlertOctagon className="h-4 w-4" aria-hidden="true" />
                Extraviada
              </>
            }
          >
            <ActionForm action={setKeyIncidentStatusAction} closeOnSuccess>
              <input type="hidden" name="keyId" value={keyId} />
              <input type="hidden" name="status" value="EXTRAVIADA" />
              <Field label="Motivo" name="reason" required>
                <Textarea name="reason" required maxLength={300} placeholder="Qué pasó" />
              </Field>
              <SubmitButton className="w-full" variant="danger" pendingLabel="Marcando…">
                Marcar extraviada
              </SubmitButton>
            </ActionForm>
          </Dialog>

          <Dialog
            title={`Marcar ${code} fuera de servicio`}
            description="Para llaves dañadas o desmagnetizadas."
            triggerVariant="ghost"
            triggerSize="sm"
            trigger={
              <>
                <Wrench className="h-4 w-4" aria-hidden="true" />
                Fuera de servicio
              </>
            }
          >
            <ActionForm action={setKeyIncidentStatusAction} closeOnSuccess>
              <input type="hidden" name="keyId" value={keyId} />
              <input type="hidden" name="status" value="FUERA_DE_SERVICIO" />
              <Field label="Motivo" name="reason" required>
                <Textarea name="reason" required maxLength={300} placeholder="Qué le pasa" />
              </Field>
              <SubmitButton className="w-full" pendingLabel="Marcando…">
                Marcar fuera de servicio
              </SubmitButton>
            </ActionForm>
          </Dialog>
        </>
      ) : null}

      {canStock && parked ? (
        <Dialog
          title={`Reintegrar ${code}`}
          description="Vuelve al stock disponible."
          triggerVariant="ghost"
          triggerSize="sm"
          trigger={
            <>
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Reintegrar
            </>
          }
        >
          <ActionForm action={reinstateKeyAction} closeOnSuccess>
            <input type="hidden" name="keyId" value={keyId} />
            <Field label="Nota" name="note">
              <Input name="note" maxLength={300} placeholder="Ej: apareció en housekeeping" />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Reintegrando…">
              Reintegrar al stock
            </SubmitButton>
          </ActionForm>
        </Dialog>
      ) : null}
    </div>
  );
}
