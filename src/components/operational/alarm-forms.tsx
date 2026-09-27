'use client';

import { useState } from 'react';
import { AlarmKind, AlarmScope } from '@prisma/client';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  acknowledgeAlarmAction,
  cancelAlarmAction,
  createAlarmAction,
  snoozeAlarmAction,
} from '@/server/actions/alarms';

export type AlarmUserOption = {
  id: string;
  name: string;
  username: string;
  role: { name: string; operational: boolean };
};

export function AlarmCreateForm({ users }: { users: AlarmUserOption[] }) {
  const [kind, setKind] = useState<AlarmKind>(AlarmKind.TIMER);
  const [scope, setScope] = useState<AlarmScope>(AlarmScope.INDIVIDUAL);

  return (
    <ActionForm action={createAlarmAction} refreshOnSuccess className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo" name="kind">
          <select
            name="kind"
            className="input-base"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as AlarmKind)}
          >
            <option value={AlarmKind.TIMER}>Timer · cuenta regresiva</option>
            <option value={AlarmKind.REMINDER}>Reminder · fecha/hora</option>
          </select>
        </Field>
        <Field label="Destinatarios" name="scope">
          <select
            name="scope"
            className="input-base"
            value={scope}
            onChange={(event) => setScope(event.currentTarget.value as AlarmScope)}
          >
            <option value={AlarmScope.INDIVIDUAL}>Individual</option>
            <option value={AlarmScope.GRUPO}>Grupo</option>
            <option value={AlarmScope.GLOBAL}>Global · todo el equipo operativo</option>
          </select>
        </Field>
      </div>

      <Field label="Qué debe recordar" name="title" required>
        <Input name="title" required minLength={2} maxLength={160} placeholder="Ej.: volver a llamar a la habitación 507" />
      </Field>

      <Field label="Detalle" name="note">
        <Textarea name="note" rows={2} maxLength={500} placeholder="Contexto opcional" />
      </Field>

      {kind === AlarmKind.TIMER ? (
        <Field
          label="Duración"
          name="timerMinutes"
          hint="El timer se cancela automáticamente si termina el turno desde el que fue creado."
          required
        >
          <Input name="timerMinutes" type="number" min={1} max={1440} step={1} defaultValue={15} required />
        </Field>
      ) : (
        <Field
          label="Fecha y hora"
          name="reminderAt"
          hint="El reminder permanece vigente aunque cambie el turno."
          required
        >
          <Input name="reminderAt" type="datetime-local" required />
        </Field>
      )}

      {scope !== AlarmScope.GLOBAL ? (
        <fieldset className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <legend className="px-1 text-sm font-semibold text-petrol-900">
            {scope === AlarmScope.INDIVIDUAL ? 'Selecciona una persona' : 'Selecciona el grupo'}
          </legend>
          <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {users.map((person) => (
              <label key={person.id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                <input
                  type={scope === AlarmScope.INDIVIDUAL ? 'radio' : 'checkbox'}
                  name="userIds"
                  value={person.id}
                  required={scope === AlarmScope.INDIVIDUAL}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block font-medium text-petrol-900">{person.name}</span>
                  <span className="text-xs text-slate-500">@{person.username} · {person.role.name}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-petrol-800 ring-1 ring-gold-200">
          Se creará una alarma para todas las cuentas operativas activas. Cada persona la detiene o pospone de forma independiente.
        </p>
      )}

      <SubmitButton variant="gold" pendingLabel="Programando…">
        PROGRAMAR {kind === AlarmKind.TIMER ? 'TIMER' : 'REMINDER'}
      </SubmitButton>
    </ActionForm>
  );
}

export function AlarmRecipientActions({ recipientId }: { recipientId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionForm action={acknowledgeAlarmAction} hideSuccess refreshOnSuccess className="space-y-0">
        <input type="hidden" name="recipientId" value={recipientId} />
        <SubmitButton size="sm" pendingLabel="Deteniendo…">Detener</SubmitButton>
      </ActionForm>
      {[5, 10, 15].map((minutes) => (
        <ActionForm key={minutes} action={snoozeAlarmAction} hideSuccess refreshOnSuccess className="space-y-0">
          <input type="hidden" name="recipientId" value={recipientId} />
          <input type="hidden" name="minutes" value={minutes} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="…">+{minutes} min</SubmitButton>
        </ActionForm>
      ))}
    </div>
  );
}

export function CancelAlarmForm({ alarmId }: { alarmId: string }) {
  return (
    <ActionForm action={cancelAlarmAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="alarmId" value={alarmId} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Cancelando…">Cancelar</SubmitButton>
    </ActionForm>
  );
}
