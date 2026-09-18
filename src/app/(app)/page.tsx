import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Inbox,
  Repeat,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { HandoverStatus, ShiftStatus } from '@prisma/client';
import { requirePageUser } from '@/server/auth/guard';
import { getDashboardData } from '@/server/services/dashboard';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import {
  ALERT_LEVEL_TONE,
  ALERT_TYPE_LABEL,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  ENTRY_TYPE_LABEL,
  FOLLOWUP_STATUS_LABEL,
  FOLLOWUP_STATUS_TONE,
  HANDOVER_LEVEL_LABEL,
  HANDOVER_LEVEL_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  isOverdue,
} from '@/domain/labels';
import { SHIFT_STATUS_LABEL, SHIFT_TYPE_LABEL, shiftTypeAt } from '@/domain/shift';
import {
  ROOM_STATE_ACTIONS,
  ROOM_STATE_LABELS,
  ROOM_STATE_TONE,
} from '@/domain/rooms';
import { formatDate, formatDateTime, formatTime, relativeTime } from '@/lib/format';
import { ShiftStepper } from '@/components/operational/shift-stepper';
import { OperationalBriefButton } from '@/components/operational/operational-brief';
import {
  PrepareHandoverForm,
  ReceiveHandoverForm,
  OpenShiftForm,
} from '@/components/operational/shift-actions';

export const metadata = { title: 'Inicio' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requirePageUser();
  const data = await getDashboardData(user);
  const shift = data.myShift;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* ------------------------------ Turno actual ------------------------------ */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">
              Turno actual
            </p>
            {shift ? (
              <>
                <h1 className="mt-1 text-xl font-semibold text-petrol-900">
                  {SHIFT_TYPE_LABEL[shift.type]} · {formatDate(shift.date)}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <Badge
                    tone={
                      shift.status === ShiftStatus.ACTIVO
                        ? 'curso'
                        : shift.status === ShiftStatus.INICIADO
                          ? 'pendiente'
                          : shift.status === ShiftStatus.ENTREGA_ENVIADA
                            ? 'atencion'
                            : 'neutro'
                    }
                  >
                    {SHIFT_STATUS_LABEL[shift.status]}
                  </Badge>
                  <span>
                    Horario {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
                  </span>
                  {shift.actualStart ? (
                    <span>Iniciado a las {formatTime(shift.actualStart)}</span>
                  ) : null}
                  <span>
                    {shift.assignments.map((a) => a.user.name).join(', ')}
                  </span>
                </div>
                <div className="mt-3">
                  <ShiftStepper status={shift.status} />
                </div>
              </>
            ) : (
              <>
                <h1 className="mt-1 text-xl font-semibold text-petrol-900">
                  No tienes un turno abierto
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  {!user.roleOperational
                    ? 'Tu rol está fuera de la operación de turnos. Puedes supervisar y administrar desde el menú.'
                    : data.nextShift
                      ? 'Hay un turno abierto: súmate a ése. No se abren turnos en paralelo.'
                      : data.incoming
                        ? 'Hay un cierre esperando en la bandeja: abre tu turno para revisarlo y recibir la caja.'
                        : 'Abre tu turno para empezar.'}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {!shift && user.roleOperational ? (
              <OpenShiftForm
                suggestedType={shiftTypeAt()}
                /* Si ya hay uno abierto, el único gesto posible es sumarse. */
                joining={Boolean(data.nextShift)}
              />
            ) : null}

            {shift && shift.status === ShiftStatus.ACTIVO ? (
              <>
                <PrepareHandoverForm shiftId={shift.id} />
              </>
            ) : null}

            {shift && shift.status === ShiftStatus.PREPARANDO_ENTREGA && shift.handoverOut ? (
              <Link
                href={`/turno/entrega/${shift.handoverOut.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Continuar la entrega
              </Link>
            ) : null}

            {shift && shift.status === ShiftStatus.ENTREGA_ENVIADA ? (
              <p className="max-w-xs rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-sky-200">
                Entrega enviada. Tu turno se cierra cuando el turno siguiente confirme la recepción.
              </p>
            ) : null}

            <Link
              href="/turno"
              className="inline-flex items-center gap-1 text-xs font-medium text-petrol-600 hover:underline"
            >
              Ver detalle del turno
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Recepción pendiente: lo primero que debe hacer al entrar */}
        {shift && shift.status === ShiftStatus.INICIADO ? (
          <div className="border-t border-slate-200 bg-gold-50/60 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-petrol-900">
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  {data.incoming
                    ? 'Recibe la entrega del turno anterior'
                    : 'Sin entrega pendiente de recibir'}
                </h2>
                {data.incoming ? (
                  <>
                    <p className="mt-1 text-sm text-slate-700">
                      Enviada por {data.incoming.issuedBy.name} el{' '}
                      {formatDateTime(data.incoming.issuedAt)} · turno{' '}
                      {SHIFT_TYPE_LABEL[data.incoming.fromShift.type]}
                    </p>
                    {data.incoming.notes ? (
                      <p className="mt-2 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                        {data.incoming.notes}
                      </p>
                    ) : null}
                    <ul className="mt-3 space-y-1.5">
                      {data.incoming.items.slice(0, 6).map((item) => (
                        <li key={item.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                          <Badge tone={HANDOVER_LEVEL_TONE[item.level]}>
                            {HANDOVER_LEVEL_LABEL[item.level]}
                          </Badge>
                          <span className="font-medium text-petrol-900">{item.title}</span>
                          {item.detail ? (
                            <span className="text-slate-600">— {item.detail}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {data.incoming.items.length > 6 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        y {data.incoming.items.length - 6} punto(s) más ·{' '}
                        <Link
                          href={`/turno/entrega/${data.incoming.id}`}
                          className="font-medium text-petrol-700 hover:underline"
                        >
                          ver entrega completa
                        </Link>
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-700">
                    El turno anterior no dejó entrega registrada. Puedes activar tu turno y quedará
                    constancia en la auditoría.
                  </p>
                )}
              </div>
              <div className="w-full max-w-sm">
                <ReceiveHandoverForm
                  shiftId={shift.id}
                  handoverId={data.incoming?.id}
                  hasHandover={Boolean(data.incoming)}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------ Indicadores ------------------------------ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Alertas activas"
          value={data.counters.liveAlerts}
          hint={`${data.counters.criticalAlerts} crítica(s)`}
          tone={data.counters.criticalAlerts > 0 ? 'alert' : 'neutral'}
        />
        <StatTile
          label="Tareas vencidas"
          value={data.overdueTasks.length}
          hint={`${data.counters.openTasks} abiertas en total`}
          tone={data.overdueTasks.length > 0 ? 'alert' : 'good'}
        />
        <StatTile
          label="Incidencias abiertas"
          value={data.openIncidents.length}
          hint={`${data.counters.openEntries} registros abiertos`}
          tone={data.openIncidents.length > 0 ? 'alert' : 'good'}
        />
        <StatTile
          label="Registros de mi turno"
          value={data.shiftMetrics?.entries ?? 0}
          hint={
            data.shiftMetrics
              ? `${data.shiftMetrics.tasksCompleted}/${data.shiftMetrics.tasksCreated} tareas completadas`
              : 'Sin turno abierto'
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Inteligencia operativa"
          count={data.attention.length}
          action={<OperationalBriefButton />}
        />
        {data.attention.length === 0 ? (
          <EmptyState
            message="No hay condiciones prioritarias activas."
            hint="La bandeja se construye con reglas del Libro; Fronti sólo la interpreta."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.attention.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="block px-4 py-3 hover:bg-slate-50">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.tone}>{item.tone === 'critico' ? 'Prioridad inmediata' : item.tone === 'atencion' ? 'Requiere atención' : 'Pendiente'}</Badge>
                    <span className="text-sm font-semibold text-petrol-900">{item.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                  <p className="mt-0.5 text-xs font-medium text-petrol-700">
                    Siguiente acción: {item.action}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* --------------------------- Pendientes críticos --------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Pendientes críticos"
            count={data.criticalEntries.length}
            href="/libro?estado=abiertos&prioridad=CRITICA"
          />
          {data.criticalEntries.length === 0 ? (
            <EmptyState
              message="Nada crítico ni vencido en este momento."
              hint="Los registros de prioridad alta o crítica y los vencidos aparecen aquí."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.criticalEntries.map((entry) => {
                const overdue = isOverdue(entry.dueAt, true);
                return (
                  <li key={entry.id}>
                    <Link
                      href={`/libro/${entry.id}`}
                      className="block px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tabular text-slate-400">
                          #{entry.seq}
                        </span>
                        <Chip>{ENTRY_TYPE_LABEL[entry.type]}</Chip>
                        <Badge tone={PRIORITY_TONE[entry.priority]} withSymbol={false}>
                          {PRIORITY_LABEL[entry.priority]}
                        </Badge>
                        <Badge tone={ENTRY_STATUS_TONE[entry.status]}>
                          {ENTRY_STATUS_LABEL[entry.status]}
                        </Badge>
                        {overdue ? <Badge tone="critico">Vencido</Badge> : null}
                      </div>
                      <p className="mt-1 font-medium text-petrol-900">{entry.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {entry.owner ? `Resp.: ${entry.owner.name}` : 'Sin responsable'}
                        {entry.department ? ` · ${entry.department.name}` : ''}
                        {entry.guest
                          ? ` · ${entry.guest.fullName}${entry.guest.roomNumber ? ` (hab. ${entry.guest.roomNumber})` : ''}`
                          : ''}
                        {entry.dueAt ? ` · vence ${relativeTime(entry.dueAt)}` : ''}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ------------------------------- Tareas mías ------------------------------- */}
        <Card>
          <CardHeader title="Tareas para mí" count={data.myTasks.length} href="/libro?clase=task" />
          {data.myTasks.length === 0 ? (
            <EmptyState message="No tienes tareas abiertas asignadas." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.myTasks.map((task) => {
                const overdue = isOverdue(task.dueAt, true);
                return (
                  <li key={task.id}>
                    <Link href={`/tareas/${task.id}`} className="block px-4 py-3 hover:bg-slate-50">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={overdue ? 'critico' : TASK_STATUS_TONE[task.status]}>
                          {overdue ? 'Vencida' : TASK_STATUS_LABEL[task.status]}
                        </Badge>
                        <Badge tone={PRIORITY_TONE[task.priority]} withSymbol={false}>
                          {PRIORITY_LABEL[task.priority]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm font-medium text-petrol-900">{task.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {task.dueAt ? `Vence ${relativeTime(task.dueAt)}` : 'Sin fecha límite'}
                        {task._count.checklist > 0 ? ` · ${task._count.checklist} pasos` : ''}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ------------------------- Habitaciones con pendientes ------------------------- */}
        {user.permissions.includes('room.view') ? (
          <Card>
            <CardHeader
              title="Habitaciones que requieren acción"
              count={data.roomsNeedingAction.length}
              href="/habitaciones"
              hrefLabel="Ver el tablero"
            />
            {data.roomsNeedingAction.length === 0 ? (
              <EmptyState message="Ninguna habitación tiene pendientes." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.roomsNeedingAction.map((room) => (
                  <li key={room.number}>
                    <Link
                      href={`/habitaciones/${room.number}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 active:bg-slate-100"
                    >
                      <span className="w-10 shrink-0 text-base font-semibold tabular text-petrol-900">
                        {room.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Badge tone={ROOM_STATE_TONE[room.snapshot.state]}>
                          {ROOM_STATE_LABELS[room.snapshot.state]}
                        </Badge>
                        <span className="mt-1 block text-xs text-slate-600">
                          {ROOM_STATE_ACTIONS[room.snapshot.state]}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {room.snapshot.keysOut.length > 0
                            ? `${room.snapshot.keysOut.length} llave(s) fuera`
                            : 'Sin llaves fuera'}
                          {room.openIncidents > 0
                            ? ` · ${room.openIncidents} incidencia(s) abierta(s)`
                            : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {/* --------------------------------- Alertas --------------------------------- */}
        <Card>
          <CardHeader title="Alertas" count={data.alerts.length} href="/libro?clase=alert" />
          {data.alerts.length === 0 ? (
            <EmptyState message="Sin alertas activas." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ALERT_LEVEL_TONE[alert.level]}>
                      {ALERT_TYPE_LABEL[alert.type]}
                    </Badge>
                    {alert.auto ? <Chip>Automática</Chip> : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-petrol-900">{alert.title}</p>
                  {alert.message ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{alert.message}</p>
                  ) : null}
                  <Link
                    href="/libro?clase=alert"
                    className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline"
                  >
                    Gestionar
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ----------------------------- Incidencias -------------------------------- */}
        <Card>
          <CardHeader
            title="Incidencias abiertas"
            count={data.openIncidents.length}
            href="/libro?clase=entry&tipo=INCIDENCIA"
          />
          {data.openIncidents.length === 0 ? (
            <EmptyState message="Sin incidencias abiertas." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.openIncidents.map((incident) => (
                <li key={incident.id}>
                  <Link
                    href={`/libro/${incident.id}`}
                    className="block px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                      {incident.severity ? (
                        <Badge tone={SEVERITY_TONE[incident.severity]}>
                          Gravedad {SEVERITY_LABEL[incident.severity]}
                        </Badge>
                      ) : null}
                      <Badge tone={ENTRY_STATUS_TONE[incident.status]}>
                        {ENTRY_STATUS_LABEL[incident.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-medium text-petrol-900">{incident.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {incident.owner ? `Resp.: ${incident.owner.name}` : 'Sin responsable'}
                      {incident.department ? ` · ${incident.department.name}` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --------------------------- Próximos seguimientos ------------------------- */}
        <Card>
          <CardHeader
            title="Próximos seguimientos"
            count={data.followUps.length}
            href="/libro?clase=followup"
          />
          {data.followUps.length === 0 ? (
            <EmptyState message="Sin seguimientos pendientes." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.followUps.map((followUp) => (
                <li key={followUp.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Repeat className="h-3.5 w-3.5 text-petrol-600" aria-hidden="true" />
                    <Badge tone={FOLLOWUP_STATUS_TONE[followUp.status]}>
                      {FOLLOWUP_STATUS_LABEL[followUp.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-petrol-900">{followUp.action}</p>
                  {followUp.nextAction ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      Próxima acción: {followUp.nextAction}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {followUp.owner.name}
                    {followUp.scheduledAt
                      ? ` · programado ${relativeTime(followUp.scheduledAt)}`
                      : ' · sin fecha'}
                    {followUp.entry ? (
                      <>
                        {' · '}
                        <Link
                          href={`/libro/${followUp.entry.id}`}
                          className="font-medium text-petrol-600 hover:underline"
                        >
                          #{followUp.entry.seq}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ----------------------------- Últimas novedades -------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader title="Últimas novedades" href="/libro" />
          {data.latestEntries.length === 0 ? (
            <EmptyState message="El libro está vacío. Registra la primera novedad." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.latestEntries.map((entry) => (
                <li key={entry.id}>
                  <Link href={`/libro/${entry.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs tabular text-slate-400">
                        {formatDateTime(entry.occurredAt)}
                      </span>
                      <Chip>{ENTRY_TYPE_LABEL[entry.type]}</Chip>
                      <Badge tone={ENTRY_STATUS_TONE[entry.status]}>
                        {ENTRY_STATUS_LABEL[entry.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-medium text-petrol-900">{entry.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.createdBy.name}
                      {entry.department ? ` · ${entry.department.name}` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ------------------------ Entrega anterior / próxima ---------------------- */}
        <Card>
          <CardHeader title="Entregas de turno" href="/turno" hrefLabel="Ir al turno" />
          <div className="space-y-3 px-4 py-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                Entrega anterior
              </p>
              {data.lastReceivedHandover ? (
                <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <p className="text-sm text-petrol-900">
                    Turno {SHIFT_TYPE_LABEL[data.lastReceivedHandover.fromShift.type]} ·{' '}
                    {formatDate(data.lastReceivedHandover.fromShift.date)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    De {data.lastReceivedHandover.issuedBy.name}, recibida{' '}
                    {relativeTime(data.lastReceivedHandover.receivedAt)} ·{' '}
                    {data.lastReceivedHandover.items.length} puntos
                  </p>
                  <Link
                    href={`/turno/entrega/${data.lastReceivedHandover.id}`}
                    className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline"
                  >
                    Ver entrega recibida
                  </Link>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  Aún no has recibido ninguna entrega.
                </p>
              )}
            </div>

            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Próxima entrega
              </p>
              {shift?.handoverOut ? (
                <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <Badge
                    tone={
                      shift.handoverOut.status === HandoverStatus.ENVIADA ? 'curso' : 'pendiente'
                    }
                  >
                    {shift.handoverOut.status === HandoverStatus.ENVIADA
                      ? 'Enviada, esperando confirmación'
                      : 'En preparación'}
                  </Badge>
                  <p className="mt-1 text-xs text-slate-500">
                    {shift.handoverOut.items.length} puntos ·{' '}
                    {shift.handoverOut.status === HandoverStatus.ENVIADA
                      ? 'en la bandeja, a la espera de quien la reciba'
                      : 'todavía sin enviar'}
                  </p>
                  <Link
                    href={`/turno/entrega/${shift.handoverOut.id}`}
                    className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline"
                  >
                    Abrir entrega
                  </Link>
                </div>
              ) : shift ? (
                <p className="mt-1 text-sm text-slate-500">
                  Al terminar, tu cierre queda en la bandeja para que lo reciba quien entre.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Inicia tu turno para preparar la entrega.</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* --------------------------- Tareas vencidas globales --------------------- */}
      {data.overdueTasks.length > 0 ? (
        <Card>
          <CardHeader
            title="Tareas vencidas de la operación"
            count={data.overdueTasks.length}
            href="/libro?clase=task&estado=abiertos"
          />
          <ul className="divide-y divide-slate-100">
            {data.overdueTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tareas/${task.id}`}
                  className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-slate-50"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                  <span className="text-sm font-medium text-petrol-900">{task.title}</span>
                  <span className="text-xs text-slate-500">
                    {task.assignee ? task.assignee.name : 'sin asignar'} · venció{' '}
                    {relativeTime(task.dueAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          No hay tareas vencidas en la operación.
        </p>
      )}

      <p className="flex items-center justify-center gap-2 pb-2 text-xs text-slate-400">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        Datos al {formatDateTime(data.now)}
      </p>
    </div>
  );
}
