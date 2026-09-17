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
import {
  giveExtraCopyAction,
  handMainKeyAction,
  returnKeyAction,
} from '@/server/actions/rooms';

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
 * Los tres gestos del mesón: **entregar la llave**, recibirla y entregar una
 * copia adicional.
 *
 * El primero faltaba, y era un agujero real: la principal sólo se asignaba al
 * confirmar un check-in, así que una estadía que entra al sistema ya como
 * `IN_HOUSE` —como la trae el informe de in house— dejaba al mesón viendo al
 * huésped dentro, la llave «disponible» y **ningún botón**. Encima, el único
 * gesto de llaves que había exigía `key.stock`, que es del Supervisor: un
 * recepcionista no veía absolutamente nada.
 *
 * Recibir la llave es deliberadamente independiente del check-out. La salida
 * describe la ocupación de la habitación; este módulo describe el objeto
 * físico. Si el huésped salió sin devolverla, queda `PENDIENTE_DEVOLUCION`
 * hasta que alguien pulse «Recibir».
 */
export function RoomKeys({
  roomId,
  roomNumber,
  keys,
  canAssign,
  canStock,
  availableKeys,
  hasGuestInside,
}: {
  roomId: string;
  roomNumber: string;
  keys: KeyRow[];
  canAssign: boolean;
  canStock: boolean;
  availableKeys: Array<{ value: string; label: string }>;
  /** Si hay una estadía IN_HOUSE: es la condición para entregar la principal. */
  hasGuestInside: boolean;
}) {
  const copies = availableKeys.filter((key) => key.label.includes('copia'));

  /*
    Se ofrece entregar cuando hay alguien dentro y ninguna llave en sus manos.
    Si ya tiene una, lo que corresponde es una copia adicional, no otra
    principal; el servidor rechaza el caso igualmente.
  */
  const guestHoldsKey = keys.some((key) => HELD.includes(key.status));
  const canHandMainKey = canAssign && hasGuestInside && !guestHoldsKey;
  const principalAvailable = keys.some(
    (key) => key.type === 'PRINCIPAL' && key.status === 'DISPONIBLE',
  );

  return (
    <Card>
      <CardHeader
        title="Llaves de la habitación"
        count={keys.length}
        href="/llaves"
        hrefLabel="Inventario"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canHandMainKey ? (
              <Dialog
                title={`Entregar la llave de la ${roomNumber}`}
                description={
                  principalAvailable
                    ? 'La llave queda a nombre de la estadía. En la salida quedará pendiente hasta que recepción confirme su devolución.'
                    : 'La principal de esta habitación no está disponible. Puedes entregar una copia del stock.'
                }
                triggerVariant="gold"
                triggerSize="sm"
                trigger={
                  <>
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    Entregar la llave
                  </>
                }
              >
                <ActionForm action={handMainKeyAction} closeOnSuccess>
                  <input type="hidden" name="roomId" value={roomId} />
                  <Field
                    label="Llave"
                    name="keyId"
                    hint="Si no eliges ninguna, se toma la principal de la habitación."
                  >
                    <Select
                      name="keyId"
                      placeholder="Principal de la habitación"
                      options={availableKeys}
                    />
                  </Field>
                  <Field label="Nota" name="note">
                    <Input name="note" maxLength={300} placeholder="Opcional" />
                  </Field>
                  <SubmitButton className="w-full" pendingLabel="Entregando…">
                    Entregar la llave
                  </SubmitButton>
                </ActionForm>
              </Dialog>
            ) : null}
            {canStock ? (
            <Dialog
              title={`Entregar una copia adicional a la ${roomNumber}`}
              description="La copia se descuenta del stock. Al salir queda pendiente hasta que recepción la reciba físicamente."
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
            ) : null}
          </div>
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

      {/*
        Decirle al mesón por qué no hay nada que pulsar. Un botón ausente sin
        explicación es lo que hace pensar que el sistema está roto.
      */}
      {canAssign && hasGuestInside && guestHoldsKey ? (
        <p className="px-4 pb-3 text-xs text-slate-500">
          El huésped ya tiene su llave. Si necesita otra, entrega una copia adicional.
        </p>
      ) : null}
      {canAssign && !hasGuestInside ? (
        <p className="px-4 pb-3 text-xs text-slate-500">
          No hay nadie alojado en esta habitación. La llave se entrega al confirmar el check-in,
          o desde aquí cuando el huésped ya esté dentro.
        </p>
      ) : null}
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
