'use client';

import { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { addGuestToRoomAction } from '@/server/actions/room-occupancy';

type ReservationOption = {
  value: string;
  label: string;
};

export function AddGuestToRoomDialog({
  roomId,
  roomNumber,
  reservations,
}: {
  roomId: string;
  roomNumber: string;
  reservations: ReservationOption[];
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<'CHECK_IN' | 'IN_HOUSE' | 'CHECK_OUT'>('IN_HOUSE');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q
      ? reservations.filter((option) => option.label.toLowerCase().includes(q))
      : reservations;
    return source.slice(0, 12);
  }, [query, reservations]);

  const selectedLabel = reservations.find((option) => option.value === selected)?.label ?? null;

  return (
    <Dialog
      title={'Añadir huésped · habitación ' + roomNumber}
      description="Busca la reserva por ID PMS o nombre. El ID sigue siendo la identidad canónica; esta acción sólo corrige la ocupación física de la habitación."
      triggerVariant="secondary"
      trigger={
        <>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Añadir huésped
        </>
      }
    >
      <ActionForm action={addGuestToRoomAction} closeOnSuccess>
        <input type="hidden" name="roomId" value={roomId} />
        <input type="hidden" name="reservationRefId" value={selected} />

        <div>
          <label htmlFor={'guest-search-' + roomId} className="label-base">
            Buscar por ID o nombre
          </label>
          <div className="relative mt-1">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              id={'guest-search-' + roomId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Ej.: 7531826 o Matías"
              className="input-base pl-9"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {filtered.length > 0 ? (
            filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelected(option.value)}
                className={
                  'w-full rounded-md px-3 py-2 text-left text-sm transition ' +
                  (selected === option.value
                    ? 'bg-petrol-700 text-white'
                    : 'bg-white text-petrol-900 hover:bg-slate-50')
                }
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="px-2 py-3 text-sm text-slate-500">
              No hay coincidencias. Si la reserva todavía no existe, cárgala primero desde “Cargar nueva reserva”.
            </p>
          )}
        </div>

        {selectedLabel ? (
          <div className="rounded-lg bg-petrol-50 px-3 py-2 text-sm text-petrol-900 ring-1 ring-petrol-100">
            Seleccionada: <strong>{selectedLabel}</strong>
          </div>
        ) : null}

        <Field label="Estado en la habitación" name="status" required>
          <select
            name="status"
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as 'CHECK_IN' | 'IN_HOUSE' | 'CHECK_OUT')
            }
            className="input-base"
          >
            <option value="CHECK_IN">Check-in · por llegar</option>
            <option value="IN_HOUSE">Ocupada · In house</option>
            <option value="CHECK_OUT">Check-out · salida pendiente</option>
          </select>
        </Field>

        <Field
          label="Observación"
          name="note"
          hint="Opcional. La corrección queda registrada en el historial y auditoría."
        >
          <Input name="note" maxLength={300} placeholder="Motivo de la corrección manual" />
        </Field>

        <SubmitButton
          className="w-full"
          pendingLabel="Añadiendo…"
          disabled={!selected}
        >
          Añadir a habitación {roomNumber}
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
