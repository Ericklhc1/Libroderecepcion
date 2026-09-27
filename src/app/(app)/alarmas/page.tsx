import { AlarmKind, AlarmStatus } from '@prisma/client';
import { AlarmClock, BellRing, Clock3 } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { listAlarmAssignableUsers, listAlarmsForUser } from '@/server/services/alarms';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import {
  AlarmCreateForm,
  AlarmRecipientActions,
  CancelAlarmForm,
} from '@/components/operational/alarm-forms';

export const metadata = { title: 'Timers y reminders' };
export const dynamic = 'force-dynamic';

export default async function AlarmsPage() {
  const user = await requirePageUser();
  const [alarms, users] = await Promise.all([
    listAlarmsForUser(user.id),
    listAlarmAssignableUsers(),
  ]);

  const active = alarms.filter((alarm) => alarm.status === AlarmStatus.ACTIVA);
  const history = alarms.filter((alarm) => alarm.status !== AlarmStatus.ACTIVA);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 data-tour="route-title" className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <AlarmClock className="h-5 w-5 text-petrol-600" aria-hidden="true" />
          Timers y reminders
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Los timers pertenecen al turno donde nacen y se cancelan al cerrarlo. Los reminders sobreviven al relevo.
        </p>
      </header>

      <Card>
        <CardHeader title="Programar aviso" />
        <div className="px-4 py-4">
          <AlarmCreateForm users={users} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Activos" count={active.length} />
        {active.length === 0 ? (
          <EmptyState message="No hay timers ni reminders activos para ti." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {active.map((alarm) => {
              const mine = alarm.recipients.find((row) => row.userId === user.id);
              const acknowledgements = alarm.recipients.filter((row) => row.acknowledgedAt).length;
              const pending = alarm.recipients.filter((row) => !row.acknowledgedAt && !row.cancelledAt).length;
              return (
                <li key={alarm.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-50 text-petrol-800 ring-1 ring-gold-200">
                      {alarm.kind === AlarmKind.TIMER ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : <BellRing className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={alarm.kind === AlarmKind.TIMER ? 'curso' : 'pendiente'}>
                          {alarm.kind === AlarmKind.TIMER ? 'Timer' : 'Reminder'}
                        </Badge>
                        <Chip>{alarm.scope.toLocaleLowerCase('es-CL')}</Chip>
                      </div>
                      <p className="mt-1 font-semibold text-petrol-900">{alarm.title}</p>
                      {alarm.note ? <p className="mt-0.5 text-sm text-slate-600">{alarm.note}</p> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        Suena {formatDateTime(alarm.dueAt)} · creado por {alarm.createdBy.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {acknowledgements} confirmado(s) · {pending} pendiente(s) · {alarm.recipients.length} destinatario(s)
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {alarm.recipients.map((row) => row.user.name).join(', ')}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
                        {mine && !mine.acknowledgedAt && !mine.cancelledAt ? (
                          <AlarmRecipientActions recipientId={mine.id} />
                        ) : null}
                        {alarm.createdById === user.id || user.permissions.includes('supervision.center.view') ? (
                          <CancelAlarmForm alarmId={alarm.id} />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Historial reciente" count={history.length} />
        {history.length === 0 ? (
          <EmptyState message="Sin historial de alarmas todavía." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.slice(0, 30).map((alarm) => (
              <li key={alarm.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Badge tone={alarm.status === AlarmStatus.COMPLETADA ? 'resuelto' : 'neutro'}>
                  {alarm.status === AlarmStatus.COMPLETADA ? 'Completada' : 'Cancelada'}
                </Badge>
                <span className="font-medium text-petrol-900">{alarm.title}</span>
                <span className="ml-auto text-xs text-slate-500">{formatDateTime(alarm.dueAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
