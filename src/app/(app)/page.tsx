import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  Inbox,
  Send,
} from 'lucide-react';
import { ShiftStatus } from '@prisma/client';
import { requirePageUser } from '@/server/auth/guard';
import { getDashboardData } from '@/server/services/dashboard';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import {
  HANDOVER_LEVEL_LABEL,
  HANDOVER_LEVEL_TONE,
} from '@/domain/labels';
import { SHIFT_STATUS_LABEL, SHIFT_TYPE_LABEL, shiftTypeAt } from '@/domain/shift';
import { formatDate, formatDateTime, formatTime } from '@/lib/format';
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
  const immediate = data.attention.filter((item) => item.tone === 'critico').length;
  const myOverdue = data.myTasks.filter(
    (task) => task.dueAt && task.dueAt < data.now,
  ).length;
  const canViewRooms = user.permissions.includes('room.view');

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
                      ? 'Hay otro turno en curso. Puedes abrir el tuyo: durante el relevo los turnos se solapan.'
                      : data.incoming
                        ? 'Hay un cierre esperando en la bandeja: abre tu turno para revisarlo y recibir la caja.'
                        : 'Abre tu turno para empezar.'}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {!shift && user.roleOperational ? (
              <OpenShiftForm suggestedType={shiftTypeAt()} />
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/libro" className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-petrol-500">
          <StatTile
            label="Atención ahora"
            value={data.attention.length}
            hint={immediate > 0 ? `${immediate} prioridad(es) inmediata(s)` : 'Sin críticos'}
            tone={immediate > 0 ? 'alert' : data.attention.length === 0 ? 'good' : 'neutral'}
          />
        </Link>

        <Link
          href="/libro?clase=task"
          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-petrol-500"
        >
          <StatTile
            label="Mis tareas"
            value={data.myTasks.length}
            hint={myOverdue > 0 ? `${myOverdue} vencida(s)` : 'Ninguna vencida'}
            tone={myOverdue > 0 ? 'alert' : data.myTasks.length === 0 ? 'good' : 'neutral'}
          />
        </Link>

        <Link
          href={canViewRooms ? '/habitaciones' : '/libro?clase=entry&tipo=INCIDENCIA'}
          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-petrol-500"
        >
          <StatTile
            label={canViewRooms ? 'Habitaciones por actuar' : 'Incidencias abiertas'}
            value={
              canViewRooms
                ? data.counters.roomsNeedingAction
                : data.counters.openIncidents
            }
            hint={
              canViewRooms
                ? 'Abrir tablero de habitaciones'
                : 'Abrir incidencias del Libro'
            }
            tone={
              (canViewRooms
                ? data.counters.roomsNeedingAction
                : data.counters.openIncidents) > 0
                ? 'alert'
                : 'good'
            }
          />
        </Link>

        <Link
          href="/turno"
          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-petrol-500"
        >
          <StatTile
            label="Registros de mi turno"
            value={data.shiftMetrics?.entries ?? 0}
            hint={
              data.shiftMetrics
                ? `${data.shiftMetrics.tasksCompleted}/${data.shiftMetrics.tasksCreated} tareas completadas`
                : 'Sin turno abierto'
            }
          />
        </Link>
      </div>

      <Card>
        <CardHeader
          title="Atención ahora"
          count={data.attention.length}
          action={<OperationalBriefButton />}
          href="/libro"
          hrefLabel="Abrir Libro"
        />
        {data.attention.length === 0 ? (
          <EmptyState
            message="No hay condiciones prioritarias activas."
            hint="Inicio queda limpio cuando no hay nada que exija acción. El historial completo sigue en el Libro."
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.attention.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={item.tone}>
                        {item.tone === 'critico'
                          ? 'Prioridad inmediata'
                          : item.tone === 'atencion'
                            ? 'Requiere atención'
                            : 'Pendiente'}
                      </Badge>
                      <span className="text-sm font-semibold text-petrol-900">
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
                    <p className="mt-0.5 text-xs font-medium text-petrol-700">
                      Siguiente acción: {item.action}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            {data.attention.length > 8 ? (
              <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                Se muestran las 8 prioridades más altas. El resto queda disponible en el Libro.
              </p>
            ) : null}
          </>
        )}
      </Card>

      <p className="flex items-center justify-center gap-2 pb-2 text-xs text-slate-400">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        Datos al {formatDateTime(data.now)}
      </p>
    </div>
  );
}
