'use client';

import { GuaranteeStatus, ReservationStatus } from '@prisma/client';
import { ActionForm, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { GUARANTEE_STATUS_LABEL, RESERVATION_STATUS_LABEL } from '@/domain/labels';
import { saveGuestAction, saveReservationAction } from '@/server/actions/references';
import type { Option } from '@/server/services/options';

const STATUS_OPTIONS = Object.values(ReservationStatus).map((status) => ({
  value: status,
  label: RESERVATION_STATUS_LABEL[status],
}));

const GUARANTEE_OPTIONS = Object.values(GuaranteeStatus).map((status) => ({
  value: status,
  label: GUARANTEE_STATUS_LABEL[status],
}));

type GuestDefaults = {
  id?: string;
  fullName?: string;
  roomNumber?: string | null;
  documentId?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  vip?: boolean;
  notes?: string | null;
};

export function GuestDialog({
  defaults,
  trigger,
  title,
}: {
  defaults?: GuestDefaults;
  trigger: string;
  title: string;
}) {
  return (
    <Dialog title={title} triggerVariant="secondary" triggerSize="sm" trigger={trigger}>
      <ActionForm action={saveGuestAction} closeOnSuccess>
        {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
        <Field label="Nombre del huésped" name="fullName" required>
          <Input name="fullName" required defaultValue={defaults?.fullName ?? ''} maxLength={150} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Habitación" name="roomNumber">
            <Input name="roomNumber" defaultValue={defaults?.roomNumber ?? ''} />
          </Field>
          <Field label="Documento" name="documentId">
            <Input name="documentId" defaultValue={defaults?.documentId ?? ''} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo" name="email">
            <Input name="email" type="email" defaultValue={defaults?.email ?? ''} />
          </Field>
          <Field label="Teléfono" name="phone">
            <Input name="phone" defaultValue={defaults?.phone ?? ''} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Idioma" name="language">
            <Input name="language" defaultValue={defaults?.language ?? ''} />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox name="vip" label="Huésped VIP" defaultChecked={defaults?.vip} />
          </div>
        </div>
        <Field label="Notas" name="notes" hint="Preferencias, alergias, antecedentes relevantes.">
          <Textarea name="notes" rows={3} defaultValue={defaults?.notes ?? ''} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar huésped</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

type ReservationDefaults = {
  id?: string;
  code?: string;
  guestId?: string | null;
  roomNumber?: string | null;
  checkIn?: string;
  checkOut?: string;
  channel?: string | null;
  status?: ReservationStatus;
  guaranteeStatus?: GuaranteeStatus;
  balanceDue?: string;
  requiresAction?: boolean;
  actionNote?: string | null;
  notes?: string | null;
};

export function ReservationDialog({
  defaults,
  guests,
  trigger,
  title,
}: {
  defaults?: ReservationDefaults;
  guests: Option[];
  trigger: string;
  title: string;
}) {
  return (
    <Dialog title={title} triggerVariant="secondary" triggerSize="sm" trigger={trigger}>
      <ActionForm action={saveReservationAction} closeOnSuccess>
        {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código de reserva" name="code" required>
            <Input name="code" required defaultValue={defaults?.code ?? ''} placeholder="RES-10241" />
          </Field>
          <Field label="Huésped" name="guestId">
            <Select
              name="guestId"
              placeholder="Sin asociar"
              defaultValue={defaults?.guestId ?? ''}
              options={guests}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Habitación" name="roomNumber">
            <Input name="roomNumber" defaultValue={defaults?.roomNumber ?? ''} />
          </Field>
          <Field label="Llegada" name="checkIn">
            <Input type="datetime-local" name="checkIn" defaultValue={defaults?.checkIn ?? ''} />
          </Field>
          <Field label="Salida" name="checkOut">
            <Input type="datetime-local" name="checkOut" defaultValue={defaults?.checkOut ?? ''} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Canal" name="channel">
            <Input name="channel" defaultValue={defaults?.channel ?? ''} placeholder="Directo" />
          </Field>
          <Field label="Estado" name="status" required>
            <Select
              name="status"
              defaultValue={defaults?.status ?? ReservationStatus.PENDIENTE}
              options={STATUS_OPTIONS}
            />
          </Field>
          <Field label="Garantía" name="guaranteeStatus" required>
            <Select
              name="guaranteeStatus"
              defaultValue={defaults?.guaranteeStatus ?? GuaranteeStatus.NO_REQUIERE}
              options={GUARANTEE_OPTIONS}
            />
          </Field>
        </div>
        <Field
          label="Saldo pendiente"
          name="balanceDue"
          hint="Si es mayor que cero se genera alerta de cobro pendiente."
        >
          <Input type="number" step="1" min="0" name="balanceDue" defaultValue={defaults?.balanceDue ?? ''} />
        </Field>
        <Checkbox
          name="requiresAction"
          label="Requiere acción de recepción"
          defaultChecked={defaults?.requiresAction}
        />
        <Field label="Qué acción se requiere" name="actionNote">
          <Input name="actionNote" defaultValue={defaults?.actionNote ?? ''} />
        </Field>
        <Field label="Notas" name="notes">
          <Textarea name="notes" rows={2} defaultValue={defaults?.notes ?? ''} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar reserva</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
