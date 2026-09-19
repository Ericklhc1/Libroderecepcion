import Link from 'next/link';
import { ShiftStatus } from '@prisma/client';
import { CalendarClock, Inbox, Send, Users } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import {
  getMyActiveShift,
  getMyPendingClosureShift,
  getShiftBriefing,
  getShiftDesk,
} from '@/server/services/shifts';
import { getShiftMetrics } from '@/server/services/metrics';
import { getShiftReportsState } from '@/server/services/pms-import';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import type { RawSearchParams } from '@/lib/search-params';
import { ShiftStepper } from '@/components/operational/shift-stepper';
import { ShiftReports } from '@/components/operational/shift-reports';
import {
  AddShiftMemberForm,
  CancelPreparationForm,
  CloseShiftForm,
  OpenShiftForm,
  PrepareHandoverForm,
  ReceiveHandoverForm,
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
import { SHIFT_STATUS_LABEL, SHIFT_TYPE_LABEL, SHIFT_WINDOW_LABEL } from '@/domain/shift';
import { formatCalendarDate, formatDate, formatDateTime, formatTime, relativeTime } from '@/lib/format';

export const metadata = { title: 'Turno' };
export const dynamic = 'force-dynamic';

/*
  El inicio de turno aloja la carga de los tres informes del PMS: leer tres
  PDF y aplicarlos toma más que los diez segundos que la plataforma concede
  por omisión a una función.
*/
export const maxDuration = 60;

export default async function ShiftPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const seccion = typeof params.seccion === 'string' ? params.seccion : '';
  const shift = await getMyActiveShift(user.id);

  const [desk, reportsState, recentShifts, pendingClosure] = await Promise.all([
    getShiftDesk(user),
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
    getMyPendingClosureShift(user.id),
  ]);

  const [briefing, metrics] = shift
    ? await Promise.all([getShiftBriefing(shift), getShiftMetrics(shift.id)])
    : [null, null];

  const incoming = desk.pending;
  const cashIncoming = desk.cashPending;

  /*
    Candidatos a sumarse al turno vigente: operativos, activos y que no estén
    ya dentro. Se consulta sólo si hay turno y quien mira puede sumar gente.
  */
  const canAddMembers =
    Boolean(shift) &&
    (desk.iAmIn || user.permissions.includes('shift.manage'));
  const memberCandidates = canAddMembers
    ? (
        await prisma.user.findMany({
          where: {
            deletedAt: null,
            active: true,
            role: { operational: true },
            assignments: {
              none: { activatedAt: { not: null }, leftAt: null },
            },
          },
          select: { id: true, name: true, username: true },
          orderBy: { name: 'asc' },
        })
      ).map((person) => ({ value: person.id, label: `${person.name} · @${person.username}` }))
    : [];

  const textMatches = (values: Array<string | number | null | undefined>) =>
    !q ||
    values
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
      .toLowerCase()
      .includes(q);

  const visibleBriefing = briefing
    ? {
        ...briefing,
        openEntries: visibleBriefing.openEntries.filter((entry) =>
          textMatches([entry.seq, entry.type, entry.status, entry.priority, entry.title, entry.owner?.name, entry.guest?.fullName]),
        ),
        overdueTasks: visibleBriefing.overdueTasks.filter((task) =>
          textMatches([task.seq, task.status, task.title, task.assignee?.name]),
        ),
        alerts: visibleBriefing.alerts.filter((alert) =>
          textMatches([alert.type, alert.level, alert.title]),
        ),
        followUps: visibleBriefing.followUps.filter((followUp) =>
          textMatches([followUp.status, followUp.action, followUp.owner.name]),
        ),
        vipGuests: visibleBriefing.vipGuests.filter((guest) =>
          textMatches([guest.fullName, guest.roomNumber, guest.notes]),
        ),
        reservations: visibleBriefing.reservations.filter((reservation) =>
          textMatches([
            reservation.code,
            reservation.status,
            reservation.guaranteeStatus,
            reservation.roomNumber,
            reservation.guest?.fullName,
            reservation.actionNote,
          ]),
        ),
      }
    : null;
  const visibleRecentShifts = recentShifts.filter((item) =>
    textMatches([
      item.type,
      item.status,
      formatDate(item.date),
      ...item.assignments.map((assignment) => assignment.user.name),
      item.handoverOut?.status,
    ]),
  );
  const showSection = (name: string) => !seccion || seccion === name;

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
            Crear y archivar turnos
          </Link>
        ) : null}
      </header>

      {pendingClosure && pendingClosure.id !== shift?.id ? (
        <Card>
          <CardHeader title="Turno anterior pendiente de cierre" />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-petrol-900">
                {SHIFT_TYPE_LABEL[pendingClosure.type]} · {formatDate(pendingClosure.date)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                La entrega ya fue enviada. Puedes cerrar este turno sin esperar a que el
                siguiente confirme la recepción.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingClosure.handoverOut ? (
                <Link
                  href={`/turno/entrega/${pendingClosure.handoverOut.id}`}
                  className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
                >
                  Ver entrega
                </Link>
              ) : null}
              <CloseShiftForm shiftId={pendingClosure.id} />
            </div>
          </div>
        </Card>
      ) : null}

      {/*
        Los tres informes del PMS son el primer gesto del turno: de ellos sale
        el estado de las 89 habitaciones, la regla de cola y el inventario de
        llaves.
      */}
      <ShiftReports
        state={reportsState}
        canImport={user.permissions.includes('pms.import')}
      />

      {!shift ? (
        <Card>
          <CardHeader title="Entrar al turno" />
          <div className="space-y-3 px-4 py-4">
            {!user.roleOperational ? (
              <EmptyState
                message="El Administrador de sistema no participa en el ciclo de turnos."
                hint="Usa una cuenta operativa para operar turnos."
              />
            ) : (
              <>
                {cashIncoming ? (
                  <div className="rounded-lg bg-gold-50 px-3 py-3 ring-1 ring-gold-300">
                    <p className="font-medium text-petrol-900">
                      El turno saliente ya declaró la Caja
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Abre tu turno propio. Después podrás recontar y recibir esa Caja sin
                      esperar a que el saliente termine su entrega operativa.
                    </p>
                  </div>
                ) : incoming ? (
                  <div className="rounded-lg bg-gold-50 px-3 py-3 ring-1 ring-gold-300">
                    <p className="font-medium text-petrol-900">Hay una entrega operativa pendiente</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Abre tu turno propio para revisarla. El turno saliente no bloquea tu apertura.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Abre tu turno para empezar. Otro turno puede seguir cerrando en paralelo.
                  </p>
                )}
                <OpenShiftForm suggestedType={desk.suggestedType} />
              </>
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
                    {SHIFT_TYPE_LABEL[shift.type]} · {formatCalendarDate(shift.date)}
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
                    <Chip>{SHIFT_WINDOW_LABEL[shift.type]}</Chip>
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    {shift.assignments
                      .map((a) => `${a.user.name} (${ASSIGNMENT_ROLE_LABEL[a.role]})`)
                      .join(' · ')}
                  </p>
                  {/*
                    Reforzar el mesón no pasa por Administración: lo hace quien
                    está en el turno, desde el turno.
                  */}
                  {memberCandidates.length > 0 ? (
                    <div className="mt-3 max-w-sm">
                      <AddShiftMemberForm shiftId={shift.id} candidates={memberCandidates} />
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  {shift.status === ShiftStatus.ACTIVO ? (
                    <>
                      <PrepareHandoverForm shiftId={shift.id} />
                      <p className="max-w-sm text-xs text-slate-500">
                        Prepara y envía la entrega. Después podrás cerrar tu turno sin esperar la confirmación del siguiente.
                      </p>
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
                    <p className="max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                      Estado histórico recibido. Requiere recuperación administrativa; no existe cierre manual en operación.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                <ShiftStepper status={shift.status} />
              </div>

              {shift.status === ShiftStatus.ENTREGA_ENVIADA ? (
                <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">
                  Entrega enviada{shift.handoverOut?.issuedAt ? ` ${relativeTime(shift.handoverOut.issuedAt)}` : ''}.
                  Tu participación operativa ya terminó. Puedes cerrar este turno sin esperar la confirmación del siguiente.
                </p>
              ) : null}
            </div>

            {shift.status === ShiftStatus.INICIADO ||
            (shift.status === ShiftStatus.ACTIVO && (cashIncoming || incoming)) ? (
              <div className="border-t border-slate-200 bg-gold-50/60 px-4 py-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-petrol-900">
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                  Confirmar recepción
                </h3>
                {cashIncoming ? (
                  <>
                    <p className="mt-1 text-sm text-slate-700">
                      La Caja del turno anterior ya está declarada. Recuéntala primero; no
                      necesitas esperar a que la entrega completa sea enviada.
                    </p>
                    <Link
                      href={`/turno/entrega/${cashIncoming.id}`}
                      className="mt-3 inline-flex rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                    >
                      Recontar y recibir Caja
                    </Link>
                  </>
                ) : incoming ? (
                  <>
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
                    <div className="mt-3 max-w-lg">
                      <ReceiveHandoverForm
                        shiftId={shift.id}
                        handoverId={incoming.id}
                        hasHandover
                      />
                    </div>
                  </>
                ) : shift.status === ShiftStatus.INICIADO ? (
                  <>
                    <p className="mt-1 text-sm text-slate-700">
                      No hay Caja ni entrega pendiente para este turno.
                    </p>
                    <div className="mt-3 max-w-lg">
                      <ReceiveHandoverForm shiftId={shift.id} hasHandover={false} />
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </Card>

          {metrics ? (
            <>
              <ListFilterBar
                searchValue={q}
                searchPlaceholder="Buscar en el resumen del turno…"
                clearHref="/turno"
              >
                <label className="min-w-[13rem]">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Sección</span>
                  <select name="seccion" defaultValue={seccion} className="input-base w-full">
                    <option value="">Todas</option>
                    <option value="pendientes">Pendientes heredados</option>
                    <option value="tareas">Tareas vencidas</option>
                    <option value="alertas">Alertas</option>
                    <option value="seguimientos">Seguimientos</option>
                    <option value="vip">Huéspedes VIP</option>
                    <option value="reservas">Reservas con acción</option>
                    <option value="historial">Mis turnos recientes</option>
                  </select>
                </label>
              </ListFilterBar>
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
            </>
          ) : null}

          {visibleBriefing ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {showSection('pendientes') ? <Card>
                <CardHeader
                  title="Pendientes heredados"
                  count={visibleBriefing.openEntries.length}
                  href="/libro?estado=abiertos"
                />
                {visibleBriefing.openEntries.length === 0 ? (
                  <EmptyState message="Sin registros abiertos." />
                ) : (
                  <CardScroll>
                    <CardScroll>
                    <CardScroll>
                    <CardScroll>
                    <CardScroll>
                    <CardScroll>
                    <ul className="divide-y divide-slate-100">
                    {visibleBriefing.openEntries.slice(0, 8).map((entry) => (
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
                  </CardScroll>
                )}
              </Card> : null}

              {showSection('tareas') ? <Card>
                <CardHeader
                  title="Tareas vencidas"
                  count={visibleBriefing.overdueTasks.length}
                  href="/libro?clase=task&estado=abiertos"
                />
                {visibleBriefing.overdueTasks.length === 0 ? (
                  <EmptyState message="Sin tareas vencidas." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {visibleBriefing.overdueTasks.slice(0, 8).map((task) => (
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
                  </CardScroll>
                )}
              </Card> : null}

              {showSection('alertas') ? <Card>
                <CardHeader title="Alertas activas" count={visibleBriefing.alerts.length} href="/libro?clase=alert" />
                {visibleBriefing.alerts.length === 0 ? (
                  <EmptyState message="Sin alertas activas." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {visibleBriefing.alerts.slice(0, 8).map((alert) => (
                      <li key={alert.id} className="px-4 py-2.5">
                        <Badge tone={ALERT_LEVEL_TONE[alert.level]}>
                          {ALERT_TYPE_LABEL[alert.type]}
                        </Badge>
                        <p className="mt-1 text-sm font-medium text-petrol-900">{alert.title}</p>
                      </li>
                    ))}
                    </ul>
                  </CardScroll>
                )}
              </Card> : null}

              {showSection('seguimientos') ? <Card>
                <CardHeader
                  title="Seguimientos"
                  count={visibleBriefing.followUps.length}
                  href="/libro?clase=followup"
                />
                {visibleBriefing.followUps.length === 0 ? (
                  <EmptyState message="Sin seguimientos pendientes." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {visibleBriefing.followUps.slice(0, 8).map((followUp) => (
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
                  </CardScroll>
                )}
              </Card> : null}

              {showSection('vip') ? <Card>
                <CardHeader title="Huéspedes VIP" count={visibleBriefing.vipGuests.length} />
                {visibleBriefing.vipGuests.length === 0 ? (
                  <EmptyState message="Sin huéspedes VIP registrados." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {visibleBriefing.vipGuests.map((guest) => (
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
                  </CardScroll>
                )}
              </Card> : null}

              {showSection('reservas') ? <Card>
                <CardHeader
                  title="Reservas que requieren acción"
                  count={visibleBriefing.reservations.length}
                  href="/huespedes"
                />
                {visibleBriefing.reservations.length === 0 ? (
                  <EmptyState message="Sin reservas pendientes de acción." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {visibleBriefing.reservations.slice(0, 8).map((reservation) => (
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
                  </CardScroll>
                )}
              </Card> : null}
            </div>
          ) : null}
        </>
      )}

      {showSection('historial') ? <Card>
        <CardHeader title="Mis turnos recientes" count={visibleRecentShifts.length} />
        {visibleRecentShifts.length === 0 ? (
          <EmptyState message="Aún no tienes turnos registrados." />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleRecentShifts.map((item) => (
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
          </CardScroll>
        )}
      </Card> : null}

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
