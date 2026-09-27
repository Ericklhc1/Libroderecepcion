import { OperationalAlarmStatus } from '@prisma/client';
import { AlarmClock, Users } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import {
  listAlarmCandidates,
  listMyOperationalAlarms,
} from '@/server/services/operational-alarms';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  AlarmKindIcon,
  OperationalAlarmCreateForm,
} from '@/components/operational/operational-alarm-form';
import { cancelOperationalAlarmAction } from '@/server/actions/operational-alarms';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Timers y recordatorios' };
export const dynamic = 'force-dynamic';

export default async function AvisosPage() {
  const user = await requirePageUser();
  const [candidates, alarms] = await Promise.all([
    listAlarmCandidates(),
    listMyOperationalAlarms(user.id),
  ]);

  const active = alarms.filter((alarm) => alarm.status === OperationalAlarmStatus.ACTIVA);
  const history = alarms.filter((alarm) => alarm.status !== OperationalAlarmStatus.ACTIVA);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <AlarmClock className="h-5 w-5 text-gold-600" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-petrol-900">Timers y recordatorios</h1>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Los timers pertenecen al turno donde nacen y no se transfieren. Los recordatorios continúan hasta que cada destinatario los atienda.
        </p>
      </div>

      <Card>
        <CardHeader title="Nueva alarma" />
        <div className="px-4 py-4">
          <OperationalAlarmCreateForm
            currentUserId={user.id}
            candidates={candidates.map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
              username: candidate.username,
              roleName: candidate.role.name,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Activas" count={active.length} />
        {active.length === 0 ? (
          <div className="px-4 py-4"><EmptyState message="No tienes alarmas activas." /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {active.map((alarm) => {
              const myRecipient = alarm.recipients.find((recipient) => recipient.userId === user.id);
              const acknowledged = Boolean(myRecipient?.acknowledgedAt);
              return (
                <li key={alarm.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="mt-0.5 rounded-lg bg-gold-50 p-2 text-gold-700">
                      <AlarmKindIcon kind={alarm.kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-petrol-900">{alarm.title}</p>
                        <Badge tone={alarm.kind === 'TIMER' ? 'curso' : 'pendiente'}>
                          {alarm.kind === 'TIMER' ? 'Timer' : 'Recordatorio'}
                        </Badge>
                        {acknowledged ? <Badge tone="resuelto">Atendido por ti</Badge> : null}
                      </div>
                      {alarm.note ? <p className="mt-1 text-sm text-slate-600">{alarm.note}</p> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        Alarma: {formatDateTime(alarm.dueAt)} · creada por {alarm.createdBy.name}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        {alarm.recipients.length} destinatario(s) · {alarm.recipients.filter((recipient) => recipient.acknowledgedAt).length} confirmaron
                      </p>
                    </div>
                    {alarm.createdById === user.id || user.permissions.includes('shift.manage') || user.isSystemAdmin ? (
                      <ActionForm action={cancelOperationalAlarmAction} hideSuccess refreshOnSuccess className="space-y-0">
                        <input type="hidden" name="alarmId" value={alarm.id} />
                        <SubmitButton variant="ghost" size="sm" pendingLabel="Cancelando…">Cancelar</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {history.length > 0 ? (
        <Card>
          <CardHeader title="Historial reciente" count={history.length} />
          <ul className="divide-y divide-slate-100">
            {history.map((alarm) => (
              <li key={alarm.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <AlarmKindIcon kind={alarm.kind} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-petrol-900">{alarm.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{formatDateTime(alarm.dueAt)}</span>
                </span>
                <Badge tone="neutro">{alarm.status === 'CANCELADA' ? 'Cancelada' : 'Cerrada'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
