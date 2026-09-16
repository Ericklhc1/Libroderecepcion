import Link from 'next/link';
import { ShiftStatus } from '@prisma/client';
import { CalendarClock, Inbox, Send, Users } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import {
  getIncomingHandover,
  getMyOpenShift,
  getNextShift,
  getShiftBriefing,
  getStartableShifts,
} from '@/server/services/shifts';
import { getShiftMetrics } from '@/server/services/metrics';
import { getShiftReportsState } from '@/server/services/pms-import';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { ShiftStepper } from '@/components/operational/shift-stepper';
import { ShiftReports } from '@/components/operational/shift-reports';
import {
  CancelPreparationForm,
  CloseShiftForm,
  PrepareHandoverForm,
  ReceiveHandoverForm,
  StartShiftForm,
} from '@/components/operational/shift-actions';
import {
  ALERT_LEVEL_TONE,
  ALERT_TYPE_LABEL,
  ASSIGNMENT_ROLE_LABEL,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  ENTRY_TYPE_LABEL,
  FOLLOWUP_STATUS_LABEL,
  FOLLOWUP_STATUS_TONE,
  HANDOVER_LEVEL_LABEL,
  HANDOVER_LEVEL_TONE,
  HANDOVER_STATUS_LABEL,
  HANDOVER_STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
} from '@/domain/labels';
import { SHIFT_STATUS_LABEL, SHIFT_TYPE_LABEL } from '@/domain/shift';
import { formatDate, formatDateTime, formatTime, relativeTime } from '@/lib/format';

export const metadata = { title: 'Turno' };
export const dynamic = 'force-dynamic';

/*
  El inicio de turno aloja la carga de los tres informes del PMS: leer tres
  PDF y aplicarlos toma más que los diez segundos que la plataforma concede
  por omisión a una función.
*/
export const maxDuration = 60;

export default async function ShiftPage() {
  const user = await requirePageUser();
  const shift = await getMyOpenShift(user.id);

  const [startable, reportsState, recentShifts] = await Promise.all([
    shift ? Promise.resolve([]) : getStartableShifts(),
    getShiftReportsState(),
    prisma.shift.findMany({
      where: { assignments: { some: { userId: user.id } } },
      include: {
        handoverOut: { select: { id: true, status: true, items: { select: { id: true } } } },
        assignments: { include: { user: { select: { name: true } } } },
      },
      orderBy: [{ date: 'desc' }, { type: 'desc' }],
      take: 8,
    }),
  ]);

  const [incoming, briefing, metrics, nextShift] = shift
    ? await Promise.all([
        getIncomingHandover(shift),
        getShiftBriefing(shift),
        getShiftMetrics(shift.id),
        getNextShift(shift),
      ])
    : [null, null, null, null];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Mi turno</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Inicio, recepción, operación, entrega y cierre.
          </p>
        </div>
        {user.permissions.includes('shift.manage') ? (
          <Link
            href="/admin/turnos"
            className="text-sm font-medium text-petrol-600 hover:underline"
          >
            Programar turnos
          </Link>
        ) : null}
      </header>

      {/*
        Los tres informes del PMS son el primer gesto del turno: de ellos sale
        el estado de las 89 habitaciones, la regla de cola y el inventario de
        llaves. Se muestra tanto antes de iniciar el turno como durante él,
        porque el PMS puede emitir informes nuevos a media jornada.
      */}
      <ShiftReports
        state={reportsState}
        canImport={user.permissions.includes('pms.import')}
      />

      {!shift ? (
        <Card>
          <CardHeader title="Tomar turno" />
          <div className="space-y-3 px-4 py-4">
            {/*
              Los turnos no se asignan de antemano: aquí aparece la franja que
              corresponde al reloj y, antes que ella, cualquier cierre que el
              turno anterior dejó esperando confirmación. Quien toma el turno
              es quien lo revisa y recibe.
            */}
            {startable.length === 0 ? (
              <EmptyState
                message={
                  user.roleOperational
                    ? 'No hay turnos por tomar en este momento.'
                    : 'El Administrador de sistema no participa en el ciclo de turnos.'
                }
                hint={
                  user.roleOperational
                    ? 'Ya tomaste el turno que corresponde, o el ciclo está al día.'
                    : 'Usa una cuenta operativa para operar turnos.'
                }
              />
            ) : (
              <ul className="space-y-3">
                {startable.map((option) => (
                  <li
                    key={option.key}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring-1 ${
                      option.pendingClosure
                        ? 'bg-gold-50 ring-gold-300'
                        : 'bg-slate-50 ring-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-petrol-900">
                        {SHIFT_TYPE_LABEL[option.type]} · {formatDate(option.date)}
                      </p>
                      <p className="text-xs text-slate-500">
                        Horario {formatTime(option.plannedStart)}–{formatTime(option.plannedEnd)}
                      </p>
                      {option.pendingClosure ? (
                        <p className="mt-1 text-xs font-medium text-orange-800">
                          Cierre por confirmar: {SHIFT_TYPE_LABEL[option.pendingClosure.fromType]}{' '}
                          del {formatDate(option.pendingClosure.fromDate)}, entregado por{' '}
                          {option.pendingClosure.issuedByName}
                          {option.pendingClosure.issuedAt
                            ? ` a las ${formatTime(option.pendingClosure.issuedAt)}`
                            : ''}
                          .
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">
                          Sin cierre anterior pendiente.
                        </p>
                      )}
                    </div>
                    <StartShiftForm
                      slot={option.key}
                      label={option.pendingClosure ? 'Tomar y revisar cierre' : 'Tomar turno'}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-petrol-900">
                    {SHIFT_TYPE_LABEL[shift.type]} · {formatDate(shift.date)}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <Badge
                      tone={
                        shift.status === ShiftStatus.ACTIVO
                          ? 'curso'
                          : shift.status === ShiftStatus.INICIADO
                            ? 'pendiente'
                            : 'atencion'
                      }
                    >
                      {SHIFT_STATUS_LABEL[shift.status]}
                    </Badge>
                    <span>
                      {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
                    </span>
                    {shift.actualStart ? (
                      <span>Iniciado {formatDateTime(shift.actualStart)}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    {shift.assignments
                      .map((a) => `${a.user.name} (${ASSIGNMENT_ROLE_LABEL[a.role]})`)
                      .join(' · ')}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  {shift.status === ShiftStatus.ACTIVO ? (
                    <>
                      <PrepareHandoverForm shiftId={shift.id} />
                      {!nextShift ? <CloseShiftForm shiftId={shift.id} /> : null}
                    </>
                  ) : null}
                  {shift.status === ShiftStatus.PREPARANDO_ENTREGA && shift.handoverOut ? (
                    <>
                      <Link
                        href={`/turno/entrega/${shift.handoverOut.id}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                      >
                        <Send className="h-4 w-4" aria-hidden="true" />
                        Revisar y enviar la entrega
                      </Link>
                      <CancelPreparationForm shiftId={shift.id} />
                    </>
                  ) : null}
                  {shift.status === ShiftStatus.RECIBIDO ? (
                    <CloseShiftForm shiftId={shift.id} />
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                <ShiftStepper status={shift.status} />
              </div>

              {shift.status === ShiftStatus.ENTREGA_ENVIADA ? (
                <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">
                  Entrega enviada{shift.handoverOut?.issuedAt ? ` ${relativeTime(shift.handoverOut.issuedAt)}` : ''}.
                  El turno se cierra cuando el turno siguiente confirme la recepción.
                </p>
              ) : null}
            </div>

            {shift.status === ShiftStatus.INICIADO ? (
              <div className="border-t border-slate-200 bg-gold-50/60 px-4 py-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-petrol-900">
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  Confirmar recepción
                </h3>
                {incoming ? (
                  <p className="mt-1 text-sm text-slate-700">
                    Entrega de {incoming.issuedBy.name} · turno{' '}
                    {SHIFT_TYPE_LABEL[incoming.fromShift.type]} ·{' '}
                    <Link
                      href={`/turno/entrega/${incoming.id}`}
                      className="font-medium text-petrol-700 hover:underline"
                    >
                      ver los {incoming.items.length} puntos
                    </Link>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-700">
                    No hay entrega pendiente para este turno.
                  </p>
                )}
                <div className="mt-3 max-w-lg">
                  <ReceiveHandoverForm
                    shiftId={shift.id}
                    handoverId={incoming?.id}
                    hasHandover={Boolean(incoming)}
                  />
                </div>
              </div>
            ) : null}
          </Card>

          {metrics ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Registros del turno" value={metrics.entries} />
              <StatTile label="Incidencias del turno" value={metrics.incidents} />
              <StatTile label="Tareas creadas" value={metrics.tasksCreated} />
              <StatTile
                label="Tareas completadas"
                value={metrics.tasksCompleted}
                tone={metrics.tasksCompleted > 0 ? 'good' : 'neutral'}
              />
            </div>
          ) : null}

          {briefing ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Pendientes heredados"
                  count={briefing.openEntries.length}
                  href="/libro?estado=abiertos"
                />
                {briefing.openEntries.length === 0 ? (
                  <EmptyState message="Sin registros abiertos." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {briefing.openEntries.slice(0, 8).map((entry) => (
                      <li key={entry.id}>
                        <Link
                          href={`/libro/${entry.id}`}
                          className="block px-4 py-2.5 hover:bg-slate-50"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip>{ENTRY_TYPE_LABEL[entry.type]}</Chip>
                            <Badge tone={ENTRY_STATUS_TONE[entry.status]}>
                              {ENTRY_STATUS_LABEL[entry.status]}
                            </Badge>
                            <Badge tone={PRIORITY_TONE[entry.priority]} withSymbol={false}>
                              {PRIORITY_LABEL[entry.priority]}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm font-medium text-petrol-900">{entry.title}</p>
                          <p className="text-xs text-slate-500">
                            {entry.owner?.name ?? 'Sin responsable'}
                            {entry.guest ? ` · ${entry.guest.fullName}` : ''}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Tareas vencidas"
                  count={briefing.overdueTasks.length}
                  href="/libro?clase=task&estado=abiertos"
                />
                {briefing.overdueTasks.length === 0 ? (
                  <EmptyState message="Sin tareas vencidas." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {briefing.overdueTasks.slice(0, 8).map((task) => (
                      <li key={task.id}>
                        <Link
                          href={`/tareas/${task.id}`}
                          className="block px-4 py-2.5 hover:bg-slate-50"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="critico">Vencida</Badge>
                            <Badge tone={TASK_STATUS_TONE[task.status]}>
                              {TASK_STATUS_LABEL[task.status]}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm font-medium text-petrol-900">{task.title}</p>
                          <p className="text-xs text-slate-500">
                            {task.assignee?.name ?? 'Sin asignar'} · venció{' '}
                            {relativeTime(task.dueAt)}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="Alertas activas" count={briefing.alerts.length} href="/libro?clase=alert" />
                {briefing.alerts.length === 0 ? (
                  <EmptyState message="Sin alertas activas." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {briefing.alerts.slice(0, 8).map((alert) => (
                      <li key={alert.id} className="px-4 py-2.5">
                        <Badge tone={ALERT_LEVEL_TONE[alert.level]}>
                          {ALERT_TYPE_LABEL[alert.type]}
                        </Badge>
                        <p className="mt-1 text-sm font-medium text-petrol-900">{alert.title}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Seguimientos"
                  count={briefing.followUps.length}
                  href="/libro?clase=followup"
                />
                {briefing.followUps.length === 0 ? (
                  <EmptyState message="Sin seguimientos pendientes." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {briefing.followUps.slice(0, 8).map((followUp) => (
                      <li key={followUp.id} className="px-4 py-2.5">
                        <Badge tone={FOLLOWUP_STATUS_TONE[followUp.status]}>
                          {FOLLOWUP_STATUS_LABEL[followUp.status]}
                        </Badge>
                        <p className="mt-1 text-sm font-medium text-petrol-900">
                          {followUp.action}
                        </p>
                        <p className="text-xs text-slate-500">
                          {followUp.owner.name}
                          {followUp.scheduledAt
                            ? ` · ${relativeTime(followUp.scheduledAt)}`
                            : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader title="Huéspedes VIP" count={briefing.vipGuests.length} />
                {briefing.vipGuests.length === 0 ? (
                  <EmptyState message="Sin huéspedes VIP registrados." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {briefing.vipGuests.map((guest) => (
                      <li key={guest.id} className="px-4 py-2.5">
                        <p className="text-sm font-medium text-petrol-900">
                          {guest.fullName}
                          {guest.roomNumber ? ` · hab. ${guest.roomNumber}` : ''}
                        </p>
                        {guest.notes ? (
                          <p className="text-xs text-slate-500">{guest.notes}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Reservas que requieren acción"
                  count={briefing.reservations.length}
                  href="/huespedes"
                />
                {briefing.reservations.length === 0 ? (
                  <EmptyState message="Sin reservas pendientes de acción." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {briefing.reservations.slice(0, 8).map((reservation) => (
                      <li key={reservation.id} className="px-4 py-2.5">
                        <p className="text-sm font-medium text-petrol-900">
                          {reservation.code}
                          {reservation.guest ? ` · ${reservation.guest.fullName}` : ''}
                          {reservation.roomNumber ? ` · hab. ${reservation.roomNumber}` : ''}
                        </p>
                        <p className="text-xs text-slate-500">
                          {reservation.actionNote ??
                            `Estado ${reservation.status} · garantía ${reservation.guaranteeStatus}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          ) : null}
        </>
      )}

      <Card>
        <CardHeader title="Mis turnos recientes" />
        {recentShifts.length === 0 ? (
          <EmptyState message="Aún no tienes turnos registrados." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentShifts.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-petrol-900">
                    {SHIFT_TYPE_LABEL[item.type]} · {formatDate(item.date)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {SHIFT_STATUS_LABEL[item.status]}
                    {item.actualStart ? ` · inicio ${formatTime(item.actualStart)}` : ''}
                    {item.actualEnd ? ` · cierre ${formatTime(item.actualEnd)}` : ''}
                  </p>
                </div>
                {item.handoverOut ? (
                  <Link
                    href={`/turno/entrega/${item.handoverOut.id}`}
                    className="flex items-center gap-2 text-xs font-medium text-petrol-600 hover:underline"
                  >
                    <Badge tone={HANDOVER_STATUS_TONE[item.handoverOut.status]}>
                      {HANDOVER_STATUS_LABEL[item.handoverOut.status]}
                    </Badge>
                    {item.handoverOut.items.length} puntos
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">Sin entrega</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Leyenda del semáforo: el color nunca va solo */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 text-xs text-slate-500 shadow-card">
        <span className="font-semibold">Semáforo</span>
        {(
          [
            ['critico', 'Crítico o vencido'],
            ['atencion', 'Requiere atención'],
            ['pendiente', 'Pendiente'],
            ['curso', 'En curso'],
            ['resuelto', 'Resuelto'],
            ['neutro', 'Cerrado o informativo'],
          ] as const
        ).map(([tone, label]) => (
          <Badge key={tone} tone={tone}>
            {label}
          </Badge>
        ))}
        <span className="text-slate-400">
          Cada estado incluye texto y símbolo además del color.
        </span>
      </div>

      <div className="pb-2">
        <Badge tone="neutro">{HANDOVER_LEVEL_LABEL.INFORMATIVO}</Badge>{' '}
        <span className="text-xs text-slate-400">
          Los puntos de una entrega se clasifican como{' '}
          <Badge tone={HANDOVER_LEVEL_TONE.URGENTE}>Urgente</Badge>{' '}
          <Badge tone={HANDOVER_LEVEL_TONE.IMPORTANTE}>Importante</Badge> o{' '}
          <Badge tone={HANDOVER_LEVEL_TONE.INFORMATIVO}>Informativo</Badge>.
        </span>
      </div>
    </div>
  );
}
