'use client';

import { KeyRound, Plus, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { ActionForm, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  KEY_STATUS_LABELS,
  KEY_STATUS_TONE,
  KEY_TYPE_LABELS,
  type KeyFacts,
  type KeyStatusValue,
} from '@/domain/rooms';
import { giveExtraCopyAction, returnKeyAction } from '@/server/actions/rooms';

/**
 * La fecha llega ya escrita desde el servidor. Si se formateara aquí, el
 * servidor y el navegador podrían resolver la zona horaria de forma distinta y
 * React avisaría de una discrepancia al hidratar.
 */
type KeyRow = KeyFacts & { assignedLabel: string | null };

/** Estados en los que la llave está en manos del huésped. */
const HELD: KeyStatusValue[] = ['ASIGNADA', 'COPIA_ADICIONAL', 'PENDIENTE_DEVOLUCION'];

/**
 * Llaves de la habitación.
 *
 * Muestra la principal y las copias con su estado, y deja a mano los dos gestos
 * de mesón: recibir una llave y entregar una copia adicional.
 */
export function RoomKeys({
  roomId,
  roomNumber,
  keys,
  canAssign,
  canStock,
  availableKeys,
}: {
  roomId: string;
  roomNumber: string;
  keys: KeyRow[];
  canAssign: boolean;
  canStock: boolean;
  availableKeys: Array<{ value: string; label: string }>;
}) {
  const copies = availableKeys.filter((key) => key.label.includes('copia'));

  return (
    <Card>
      <CardHeader
        title="Llaves de la habitación"
        count={keys.length}
        href="/llaves"
        hrefLabel="Inventario"
        action={
          canStock ? (
            <Dialog
              title={`Entregar una copia adicional a la ${roomNumber}`}
              description="La copia se descuenta del stock y vuelve sola cuando se confirme la salida."
              triggerVariant="secondary"
              triggerSize="sm"
              trigger={
                <>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Copia adicional
                </>
              }
            >
              <ActionForm action={giveExtraCopyAction} closeOnSuccess>
                <input type="hidden" name="roomId" value={roomId} />
                <Field label="Copia" name="keyId" hint="Si no eliges una, se toma la primera del stock.">
                  <Select name="keyId" placeholder="Primera copia disponible" options={copies} />
                </Field>
                <Field label="Motivo" name="note">
                  <Input name="note" maxLength={300} placeholder="Ej: segundo huésped" />
                </Field>
                <SubmitButton className="w-full" pendingLabel="Entregando…">
                  Entregar copia
                </SubmitButton>
              </ActionForm>
            </Dialog>
          ) : null
        }
      />

      {keys.length ? (
        <ul className="divide-y divide-slate-100">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="font-medium tabular text-petrol-900">{key.code}</span>
              <span className="text-xs text-slate-500">{KEY_TYPE_LABELS[key.type]}</span>
              <Badge tone={KEY_STATUS_TONE[key.status]}>{KEY_STATUS_LABELS[key.status]}</Badge>
              {key.assignedLabel ? (
                <span className="text-xs text-slate-400">{key.assignedLabel}</span>
              ) : null}
              {canAssign && HELD.includes(key.status) ? (
                <div className="ml-auto">
                  <ReturnKeyButton keyId={key.id} code={key.code} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          message="Esta habitación no tiene llaves registradas."
          hint="Agrégalas desde el inventario de llaves."
        />
      )}
    </Card>
  );
}

/** Recibir una llave es un gesto de un clic, con confirmación breve. */
function ReturnKeyButton({ keyId, code }: { keyId: string; code: string }) {
  return (
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
  );
}
