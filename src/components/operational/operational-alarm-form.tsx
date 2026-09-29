'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, BellRing, TimerReset } from 'lucide-react';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  createOperationalAlarmAction,
  updateOperationalAlarmAction,
} from '@/server/actions/operational-alarms';

type Candidate = {
  id: string;
  name: string;
  username: string;
  roleName: string;
};

type Source = {
  entity: string;
  id: string;
  link: string;
} | null;

export function OperationalAlarmCreateForm({
  candidates,
  currentUserId,
  source = null,
}: {
  candidates: Candidate[];
  currentUserId: string;
  source?: Source;
}) {
  const [kind, setKind] = useState<'TIMER' | 'RECORDATORIO'>('RECORDATORIO');
  const [scope, setScope] = useState<'INDIVIDUAL' | 'GRUPO' | 'GLOBAL'>('INDIVIDUAL');
  const [selected, setSelected] = useState<string[]>([currentUserId]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <ActionForm action={createOperationalAlarmAction} refreshOnSuccess resetOnSuccess>
      {source ? (
        <>
          <input type="hidden" name="sourceEntity" value={source.entity} />
          <input type="hidden" name="sourceId" value={source.id} />
          <input type="hidden" name="sourceLink" value={source.link} />
        </>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo" name="kind" required>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as typeof kind)}
            className="input-base"
          >
            <option value="RECORDATORIO">Alerta programada · fecha y hora</option>
            <option value="TIMER">Timer · cuenta regresiva</option>
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

      <Field label="Alerta" name="title" required hint="Una llamada de atención; no crea otra novedad ni otra tarea.">
        <Input
          name="title"
          required
          minLength={2}
          maxLength={160}
          placeholder="Ej.: confirmar solución con el huésped"
        />
      </Field>

      <Field label="Detalle" name="note" hint="Opcional. Contexto breve para quien recibe la alerta.">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>

      {kind === 'TIMER' ? (
        <Field
          label="Duración"
          name="timerMinutes"
          required
          hint="El timer pertenece al turno donde nace y se cancela cuando ese turno termina."
        >
          <div className="relative max-w-xs">
            <Input
              name="timerMinutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              defaultValue={15}
              required
              className="pr-16"
            />
            <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-500">min</span>
          </div>
        </Field>
      ) : (
        <Field
          label="Fecha y hora"
          name="dueAtLocal"
          required
          hint="Hora de Santiago. Al vencer, genera una notificación que abre el objeto original."
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
                    <span className="block text-xs text-slate-500">
                      @{person.username} · {person.roleName}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div className="rounded-xl bg-gold-50 px-3 py-3 text-sm text-petrol-900 ring-1 ring-gold-200">
          La alerta se asignará a todos los usuarios activos. Cada persona puede atenderla o posponerla para sí misma.
        </div>
      )}

      <SubmitButton variant="gold" pendingLabel="Programando…">
        {kind === 'TIMER' ? (
          <span className="inline-flex items-center gap-2">
            <TimerReset className="h-4 w-4" /> INICIAR TIMER
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <BellRing className="h-4 w-4" /> PROGRAMAR ALERTA
          </span>
        )}
      </SubmitButton>
    </ActionForm>
  );
}

export function OperationalAlertEditDialog({
  alert,
}: {
  alert: {
    id: string;
    title: string;
    note: string | null;
    dueAtLocal: string;
  };
}) {
  return (
    <Dialog
      title="Editar alerta"
      description="Actualiza el texto o la fecha. No modifica la novedad o tarea de origen."
      trigger="Editar"
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
    >
      <ActionForm action={updateOperationalAlarmAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="alarmId" value={alert.id} />
        <Field label="Alerta" name="title" required>
          <Input name="title" defaultValue={alert.title} maxLength={160} required />
        </Field>
        <Field label="Detalle" name="note">
          <Textarea name="note" defaultValue={alert.note ?? ''} rows={3} maxLength={500} />
        </Field>
        <Field label="Fecha y hora" name="dueAtLocal" required>
          <Input name="dueAtLocal" type="datetime-local" defaultValue={alert.dueAtLocal} required />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function OperationalAlertRecipientActions({
  recipientId,
  sourceLink,
}: {
  recipientId: string;
  sourceLink?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const act = async (action: 'acknowledge' | 'snooze', minutes?: 5 | 10 | 15) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/alarms/action', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          recipientId,
          ...(action === 'snooze' ? { minutes } : {}),
        }),
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {sourceLink ? (
        <button
          type="button"
          onClick={() => router.push(sourceLink)}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          Abrir origen
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void act('snooze', 10)}
        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
      >
        +10 min
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act('acknowledge')}
        className="rounded-lg bg-petrol-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-petrol-800 disabled:opacity-50"
      >
        Atendida
      </button>
    </div>
  );
}

export function LinkedAlertPrompt({
  alerts,
}: {
  alerts: Array<{
    id: string;
    recipientId: string;
    title: string;
    note: string | null;
    dueAt: string;
  }>;
}) {
  const due = alerts[0] ?? null;
  if (!due) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-petrol-950/60 p-4 no-print">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="linked-alert-title"
        className="w-full max-w-lg rounded-3xl bg-white shadow-2xl ring-1 ring-gold-200"
      >
        <div className="border-b border-gold-100 bg-gold-50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-700">
            Alerta vinculada
          </p>
          <h2 id="linked-alert-title" className="mt-1 text-xl font-semibold text-petrol-900">
            {due.title}
          </h2>
        </div>
        <div className="space-y-4 px-5 py-5">
          {due.note ? <p className="text-sm leading-6 text-slate-700">{due.note}</p> : null}
          <p className="text-xs text-slate-500">
            Esta alerta llama tu atención sobre este registro. Atenderla no cambia el estado de la novedad ni de sus tareas.
          </p>
          <OperationalAlertRecipientActions recipientId={due.recipientId} />
        </div>
      </section>
    </div>
  );
}

export function AlarmKindIcon({ kind }: { kind: string }) {
  return kind === 'TIMER'
    ? <TimerReset className="h-4 w-4" aria-hidden="true" />
    : <AlarmClock className="h-4 w-4" aria-hidden="true" />;
}
