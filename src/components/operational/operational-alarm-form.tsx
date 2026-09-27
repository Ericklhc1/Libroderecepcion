'use client';

import { useMemo, useState } from 'react';
import { AlarmClock, BellRing, TimerReset } from 'lucide-react';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { createOperationalAlarmAction } from '@/server/actions/operational-alarms';

type Candidate = {
  id: string;
  name: string;
  username: string;
  roleName: string;
};

export function OperationalAlarmCreateForm({
  candidates,
  currentUserId,
}: {
  candidates: Candidate[];
  currentUserId: string;
}) {
  const [kind, setKind] = useState<'TIMER' | 'RECORDATORIO'>('TIMER');
  const [scope, setScope] = useState<'INDIVIDUAL' | 'GRUPO' | 'GLOBAL'>('INDIVIDUAL');
  const [selected, setSelected] = useState<string[]>([currentUserId]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <ActionForm action={createOperationalAlarmAction} refreshOnSuccess resetOnSuccess>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo" name="kind" required>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as typeof kind)}
            className="input-base"
          >
            <option value="TIMER">Timer · cuenta regresiva</option>
            <option value="RECORDATORIO">Recordatorio · fecha y hora</option>
          </select>
        </Field>

        <Field label="Destinatarios" name="scope" required>
          <select
            id="scope"
            name="scope"
            value={scope}
            onChange={(event) => {
              const next = event.currentTarget.value as typeof scope;
              setScope(next);
              if (next === 'INDIVIDUAL' && selected.length !== 1) {
                setSelected([currentUserId]);
              }
            }}
            className="input-base"
          >
            <option value="INDIVIDUAL">Individual</option>
            <option value="GRUPO">Grupo</option>
            <option value="GLOBAL">Global · todos los usuarios activos</option>
          </select>
        </Field>
      </div>

      <Field label="Alarma" name="title" required hint="Escribe una instrucción corta y accionable.">
        <Input name="title" required minLength={2} maxLength={160} placeholder="Ej.: volver a llamar a mantenimiento" />
      </Field>

      <Field label="Detalle" name="note" hint="Opcional. Aparece junto a la alarma.">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>

      {kind === 'TIMER' ? (
        <Field
          label="Duración"
          name="timerMinutes"
          required
          hint="El timer pertenece al turno donde nace y se cancela automáticamente cuando ese turno termina."
        >
          <div className="relative max-w-xs">
            <Input name="timerMinutes" type="number" inputMode="numeric" min={1} max={1440} defaultValue={15} required className="pr-16" />
            <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-500">min</span>
          </div>
        </Field>
      ) : (
        <Field
          label="Fecha y hora"
          name="dueAtLocal"
          required
          hint="Hora de Santiago. El recordatorio continúa aunque cambie el turno."
        >
          <Input name="dueAtLocal" type="datetime-local" required />
        </Field>
      )}

      {scope !== 'GLOBAL' ? (
        <fieldset className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <legend className="px-1 text-sm font-semibold text-petrol-900">
            {scope === 'INDIVIDUAL' ? 'Persona' : 'Personas'}
          </legend>
          <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
            {candidates.map((person) => {
              const checked = selectedSet.has(person.id);
              return (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200"
                >
                  <input
                    type={scope === 'INDIVIDUAL' ? 'radio' : 'checkbox'}
                    name="recipientIds"
                    value={person.id}
                    checked={checked}
                    onChange={() => {
                      if (scope === 'INDIVIDUAL') {
                        setSelected([person.id]);
                      } else {
                        setSelected((current) =>
                          current.includes(person.id)
                            ? current.filter((id) => id !== person.id)
                            : [...current, person.id],
                        );
                      }
                    }}
                    className="mt-1 h-4 w-4"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-petrol-900">{person.name}</span>
                    <span className="block text-xs text-slate-500">@{person.username} · {person.roleName}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div className="rounded-xl bg-gold-50 px-3 py-3 text-sm text-petrol-900 ring-1 ring-gold-200">
          La alarma se asignará a todos los usuarios activos. Cada persona la detiene o pospone para sí misma.
        </div>
      )}

      <SubmitButton variant="gold" pendingLabel="Programando…">
        {kind === 'TIMER' ? (
          <span className="inline-flex items-center gap-2"><TimerReset className="h-4 w-4" /> INICIAR TIMER</span>
        ) : (
          <span className="inline-flex items-center gap-2"><BellRing className="h-4 w-4" /> PROGRAMAR RECORDATORIO</span>
        )}
      </SubmitButton>
    </ActionForm>
  );
}

export function AlarmKindIcon({ kind }: { kind: string }) {
  return kind === 'TIMER'
    ? <TimerReset className="h-4 w-4" aria-hidden="true" />
    : <AlarmClock className="h-4 w-4" aria-hidden="true" />;
}
