import {NoticeNavigation} from '@/components/operational/notice-navigation';
import Link from 'next/link';
import { OperationalAlarmStatus } from '@prisma/client';
import { AlarmClock, Link2, Users } from 'lucide-react';
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
  OperationalAlertEditDialog,
  OperationalAlertRecipientActions,
} from '@/components/operational/operational-alarm-form';
import { cancelOperationalAlarmAction } from '@/server/actions/operational-alarms';
import { formatDateTime, toDateTimeInput } from '@/lib/format';

export const metadata = { title: 'Avisos · Recordatorios' };
export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const user = await requirePageUser();
  const [candidates, alarms] = await Promise.all([
    listAlarmCandidates(),
    listMyOperationalAlarms(user.id),
  ]);

  const active = alarms.filter((alarm) => alarm.status === OperationalAlarmStatus.ACTIVA);
  const history = alarms.filter((alarm) => alarm.status !== OperationalAlarmStatus.ACTIVA);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <AlarmClock className="h-5 w-5 text-gold-600" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-petrol-900">Avisos · Recordatorios</h1>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Recuérdalo más tarde o avisa a alguien. El recordatorio abre el asunto original; no crea otro asunto ni cambia su estado.
        </p>
      </header>

      <NoticeNavigation current="reminders"/>
      <Card>
        <CardHeader title="Recordarme / avisar" />
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
          <div className="px-4 py-4">
            <EmptyState
              message="No tienes alertas activas."
              hint="Créala sólo cuando necesites llamar la atención en un momento concreto."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {active.map((alarm) => {
              const myRecipient = alarm.recipients.find((recipient) => recipient.userId === user.id);
              const acknowledged = Boolean(myRecipient?.acknowledgedAt);
              const canEdit =
                alarm.createdById === user.id ||
                user.permissions.includes('shift.manage') ||
                user.isSystemAdmin;
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
                          {alarm.kind === 'TIMER' ? 'Timer' : 'Programada'}
                        </Badge>
                        {acknowledged ? <Badge tone="resuelto">Atendida por ti</Badge> : null}
                      </div>
                      {alarm.note ? <p className="mt-1 text-sm text-slate-600">{alarm.note}</p> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTime(alarm.dueAt)} · creada por {alarm.createdBy.name}
                        {alarm.repeatMinutes ? ` · repite cada ${alarm.repeatMinutes} min` : ''}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        {alarm.recipients.length} destinatario(s) · {alarm.recipients.filter((recipient) => recipient.acknowledgedAt).length} atendieron
                      </p>
                      {alarm.sourceLink ? (
                        <Link
                          href={alarm.sourceLink}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-petrol-600 hover:underline"
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Abrir objeto original
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5 no-print">
                      {myRecipient && !acknowledged ? (
                        <OperationalAlertRecipientActions
                          recipientId={myRecipient.id}
                          sourceLink={alarm.sourceLink}
                        />
                      ) : null}
                      {canEdit && alarm.kind !== 'TIMER' ? (
                        <OperationalAlertEditDialog
                          alert={{
                            id: alarm.id,
                            title: alarm.title,
                            note: alarm.note,
                            dueAtLocal: toDateTimeInput(alarm.dueAt),
                            repeatMinutes: alarm.repeatMinutes,
                          }}
                        />
                      ) : null}
                      {canEdit ? (
                        <ActionForm action={cancelOperationalAlarmAction} hideSuccess refreshOnSuccess className="space-y-0">
                          <input type="hidden" name="alarmId" value={alarm.id} />
                          <SubmitButton variant="ghost" size="sm" pendingLabel="Eliminando…">
                            Eliminar
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
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
                <Badge tone="neutro">{alarm.status === 'CANCELADA' ? 'Eliminada' : 'Atendida'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
