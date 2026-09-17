'use client';

import { AlertLevel, AlertType } from '@prisma/client';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ALERT_LEVEL_LABEL, ALERT_TYPE_LABEL } from '@/domain/labels';
import {
  acknowledgeAlertAction,
  createAlertAction,
  resolveAlertAction,
  runAlertEngineAction,
  snoozeAlertAction,
} from '@/server/actions/alerts';
import type { FormOptions } from '@/server/services/options';

export function AcknowledgeAlertForm({ alertId }: { alertId: string }) {
  return (
    <ActionForm action={acknowledgeAlertAction} hideSuccess className="space-y-0">
      <input type="hidden" name="id" value={alertId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Marcando…">
        Marcar vista
      </SubmitButton>
    </ActionForm>
  );
}

export function SnoozeAlertForm({ alertId }: { alertId: string }) {
  return (
    <ActionForm action={snoozeAlertAction} hideSuccess className="flex items-end gap-1">
      <input type="hidden" name="id" value={alertId} />
      <label className="sr-only" htmlFor={`snooze-${alertId}`}>
        Posponer minutos
      </label>
      <select
        id={`snooze-${alertId}`}
        name="snoozeMinutes"
        defaultValue="60"
        className="input-base w-auto py-1.5 text-xs"
      >
        <option value="30">30 min</option>
        <option value="60">1 h</option>
        <option value="180">3 h</option>
        <option value="480">8 h</option>
      </select>
      <SubmitButton variant="ghost" size="sm" pendingLabel="Posponiendo…">
        Posponer
      </SubmitButton>
    </ActionForm>
  );
}

/** Acción directa del centro de notificaciones: el caso operativo más frecuente. */
export function Snooze30AlertForm({ alertId }: { alertId: string }) {
  return (
    <ActionForm action={snoozeAlertAction} hideSuccess className="space-y-0">
      <input type="hidden" name="id" value={alertId} />
      <input type="hidden" name="snoozeMinutes" value="30" />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Posponiendo…">
        Posponer 30 min
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Resolver sin abrir otro modal. Se reserva para alertas cuyo propio texto ya
 * define exactamente qué se está resolviendo (p. ej. un check-out pendiente).
 */
export function ResolveAlertQuickForm({ alertId, label = 'Resuelto' }: { alertId: string; label?: string }) {
  return (
    <ActionForm action={resolveAlertAction} hideSuccess className="space-y-0">
      <input type="hidden" name="id" value={alertId} />
      <SubmitButton variant="gold" size="sm" pendingLabel="Resolviendo…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function ResolveAlertDialog({ alertId, auto }: { alertId: string; auto: boolean }) {
  return (
    <Dialog
      title="Resolver alerta"
      description={
        auto
          ? 'Es una alerta automática: si la condición que la originó sigue vigente, volverá a aparecer.'
          : 'La alerta quedará resuelta con tu nota.'
      }
      triggerVariant="gold"
      triggerSize="sm"
      width="sm"
      trigger="Resolver"
    >
      <ActionForm action={resolveAlertAction} closeOnSuccess>
        <input type="hidden" name="id" value={alertId} />
        <Field label="Nota de resolución" name="note" hint="Qué se hizo para resolverla.">
          <Textarea name="note" rows={3} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Resolviendo…">Resolver alerta</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

const TYPE_OPTIONS = Object.values(AlertType).map((type) => ({
  value: type,
  label: ALERT_TYPE_LABEL[type],
}));
const LEVEL_OPTIONS = Object.values(AlertLevel).map((level) => ({
  value: level,
  label: ALERT_LEVEL_LABEL[level],
}));

export function CreateAlertDialog({ options }: { options: FormOptions }) {
  return (
    <Dialog
      title="Nueva alerta manual"
      description="Para lo que el motor automático no puede detectar por sí solo."
      triggerVariant="secondary"
      triggerSize="sm"
      trigger="Nueva alerta"
    >
      <ActionForm action={createAlertAction} closeOnSuccess resetOnSuccess>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" name="type" required>
            <Select name="type" defaultValue={AlertType.OTRO} options={TYPE_OPTIONS} />
          </Field>
          <Field label="Nivel" name="level" required>
            <Select name="level" defaultValue={AlertLevel.ATENCION} options={LEVEL_OPTIONS} />
          </Field>
        </div>
        <Field label="Título" name="title" required>
          <Input name="title" required maxLength={200} />
        </Field>
        <Field label="Mensaje" name="message">
          <Textarea name="message" rows={3} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vencimiento" name="dueAt">
            <Input type="datetime-local" name="dueAt" />
          </Field>
          <Field label="Área" name="departmentId">
            <Select name="departmentId" placeholder="Sin área" options={options.departments} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Huésped" name="guestId">
            <Select name="guestId" placeholder="Ninguno" options={options.guests} />
          </Field>
          <Field label="Reserva" name="reservationId">
            <Select name="reservationId" placeholder="Ninguna" options={options.reservations} />
          </Field>
        </div>
        <Field label="Registro relacionado" name="entryId">
          <Select name="entryId" placeholder="Ninguno" options={options.openEntries} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Creando…">Crear alerta</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Ejecuta el motor de alertas al instante. */
export function RunEngineForm() {
  return (
    <ActionForm
      action={async () => runAlertEngineAction()}
      className="space-y-0"
    >
      <SubmitButton variant="secondary" size="sm" pendingLabel="Evaluando…">
        Revisar alertas ahora
      </SubmitButton>
    </ActionForm>
  );
}
