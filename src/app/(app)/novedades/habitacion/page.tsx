import Link from 'next/link';
import { EntryType } from '@prisma/client';
import {
  AlarmClock,
  ArrowRight,
  Banknote,
  BellRing,
  ClipboardCheck,
  DoorOpen,
  Receipt,
  RefreshCcw,
} from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { getFormOptions } from '@/server/services/options';
import { listAlarmCandidates } from '@/server/services/operational-alarms';
import { IntentDialog } from '@/components/operational/intent-dialog';
import { EntryForm } from '@/components/forms/entry-form';
import { TaskForm } from '@/components/forms/task-form';
import { OperationalAlarmCreateForm } from '@/components/operational/operational-alarm-form';
import { createEntryAction } from '@/server/actions/entries';
import { createTaskAction } from '@/server/actions/tasks';
import {
  getRoomMonitorDetail,
  getRoomMonitorOverview,
  type RoomMonitorTile,
} from '@/server/services/room-monitor';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState } from '@/components/ui/card';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Novedades / habitación' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ROOM_TONE: Record<
  RoomMonitorTile['attention'],
  { shell: string; dot: string; label: string }
> = {
  critical: {
    shell: 'border-red-300 bg-red-50/70 hover:bg-red-50',
    dot: 'bg-red-600',
    label: 'Crítica',
  },
  attention: {
    shell: 'border-amber-300 bg-amber-50/65 hover:bg-amber-50',
    dot: 'bg-amber-500',
    label: 'Atención',
  },
  active: {
    shell: 'border-cyan-300 bg-cyan-50/55 hover:bg-cyan-50',
    dot: 'bg-gold-500',
    label: 'Activa',
  },
  clear: {
    shell: 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
    dot: 'bg-slate-300',
    label: 'Sin pendientes',
  },
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function human(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function RoomTile({
  room,
  selected,
}: {
  room: RoomMonitorTile;
  selected: boolean;
}) {
  const tone = ROOM_TONE[room.attention];
  const metrics = [
    { label: 'Novedades', value: room.openEntries },
    { label: 'Tareas', value: room.openTasks },
    { label: 'Seguimientos', value: room.openFollowUps },
    { label: 'Alertas', value: room.activeAlarms },
    { label: 'Garantías', value: room.openGuarantees },
  ].filter((metric) => metric.value > 0);
  const activity = metrics.reduce((total, metric) => total + metric.value, 0);

  return (
    <Link
      href={`/novedades/habitacion?habitacion=${room.number}#detalle-habitacion`}
      aria-current={selected ? 'page' : undefined}
      className={`group flex h-full min-h-[8.5rem] flex-col rounded-lg border p-3 shadow-card transition-[border-color,background-color,transform] hover:-translate-y-0.5 ${
        selected ? 'ring-2 ring-gold-500 ring-offset-2' : ''
      } ${tone.shell}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Habitación
          </span>
          <span className="mt-0.5 block text-2xl font-semibold tracking-tight text-petrol-950">
            {room.number}
          </span>
        </div>
        <span
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`}
          title={tone.label}
        />
      </div>

      {room.criticalIncidents > 0 || room.overdueTasks > 0 ? (
        <p className="mt-2 text-[0.68rem] font-semibold leading-tight text-red-700">
          {room.criticalIncidents > 0 ? `${room.criticalIncidents} crítica(s)` : ''}
          {room.criticalIncidents > 0 && room.overdueTasks > 0 ? ' · ' : ''}
          {room.overdueTasks > 0 ? `${room.overdueTasks} vencida(s)` : ''}
        </p>
      ) : null}

      {activity === 0 ? (
        <p className="mt-auto pt-4 text-center text-xs font-medium text-slate-400">
          Sin contexto abierto
        </p>
      ) : (
        <div className="mt-auto grid grid-cols-2 gap-1.5 pt-3 text-[0.68rem]">
          {metrics.map((metric, index) => (
            <span
              key={metric.label}
              className={cn(
                'flex min-h-8 items-center justify-between gap-2 rounded-sm bg-white/80 px-2 py-1 leading-none text-petrol-800 ring-1 ring-black/5',
                metrics.length % 2 === 1 && index === metrics.length - 1 && 'col-span-2',
              )}
            >
              <span className="min-w-0 truncate">{metric.label}</span>
              <strong className="shrink-0 tabular font-semibold">{metric.value}</strong>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof DoorOpen;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-gold-600" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-petrol-950">{title}</h3>
      <span className="text-xs tabular text-slate-400">{count}</span>
    </div>
  );
}

export default async function RoomOperationsMonitor({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const requestedRoom = one(params.habitacion).trim();

  const overview = await getRoomMonitorOverview(user);
  const selectedTile =
    overview.rooms.find((room) => room.number === requestedRoom) ?? null;
  const [detail, formOptions, alarmCandidates] = await Promise.all([
    selectedTile ? getRoomMonitorDetail(selectedTile.number,user) : Promise.resolve(null),
    getFormOptions(user),
    listAlarmCandidates(),
  ]);

  const canViewCash = user.permissions.includes('cash.view');

  const floors = [4, 5, 6].map((floor) => ({
    floor,
    rooms: overview.rooms.filter((room) => room.floor === floor),
  }));

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="border-b border-slate-300 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-gold-600">
              <DoorOpen className="h-4 w-4" aria-hidden="true" />
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.09em]">
                Contexto operacional
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-petrol-950">
              Novedades / habitación
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Las 89 habitaciones como mapa de contexto: novedades, tareas, alertas,
              garantías y otros hechos operativos vinculados. No muestra ocupación,
              check-in, check-out ni estado PMS.
            </p>
          </div>

          <Link
            href="/libro?clase=entry"
            className="inline-flex items-center gap-1.5 rounded-sm bg-petrol-950 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-900"
          >
            Abrir Novedades
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          ['Habitaciones', overview.summary.total],
          ['Con actividad', overview.summary.withActivity],
          ['Críticas / vencidas', overview.summary.critical],
          ['Novedades abiertas', overview.summary.openEntries],
          ['Tareas abiertas', overview.summary.openTasks],
          ['Seguimientos', overview.summary.openFollowUps],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-slate-300 bg-white px-3 py-3 shadow-card">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.07em] text-slate-400">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular text-petrol-950">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 2xl:grid-cols-[1fr_31rem]">
        <div className="space-y-5">
          {floors.map(({ floor, rooms }) => (
            <section key={floor} aria-labelledby={`piso-${floor}`}>
              <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2">
                <div>
                  <h2 id={`piso-${floor}`} className="text-sm font-semibold text-petrol-950">
                    Piso {floor}
                  </h2>
                  <p className="text-xs text-slate-400">{rooms.length} habitaciones</p>
                </div>
                <span className="text-xs text-slate-400">
                  {rooms.filter((room) => room.attention !== 'clear').length} con actividad
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
                {rooms.map((room) => (
                  <RoomTile
                    key={room.id}
                    room={room}
                    selected={selectedTile?.id === room.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside id="detalle-habitacion" className={`${detail ? 'order-first scroll-mt-28' : 'order-last'} 2xl:order-last 2xl:sticky 2xl:top-28 2xl:self-start`}>
          {!detail ? (
            <Card>
              <div className="px-5 py-8">
                <EmptyState
                  message="Selecciona una habitación."
                  hint="Toca cualquier número para ver su contexto operativo. Una habitación sin actividad seguirá apareciendo: el mapa siempre muestra las 89."
                />
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              <Card>
                <div className="border-b border-slate-200 bg-[#f8fafc] px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Monitor operacional
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold text-petrol-950">
                        Habitación {detail.room.number}
                      </h2>
                    </div>
                    <Link
                      href="/novedades/habitacion"
                      className="text-xs font-medium text-slate-500 hover:text-petrol-800"
                    >
                      Cerrar
                    </Link>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 no-print">
                    <IntentDialog title={`Habitación ${detail.room.number} · Registrar / actuar`} choices={[
                      ...(user.permissions.includes('entry.create') ? [{id:'inform',label:'Informar algo',hint:'Deja el hecho y su contexto en el libro del turno.',form:<EntryForm action={createEntryAction} options={formOptions} defaultType={EntryType.NOVEDAD} lockType defaultRoomId={detail.room.id}/>}]:[]),
                      ...(user.permissions.includes('task.create') ? [{id:'attention',label:'Necesito atención / derivar',hint:'Indica qué debe hacerse y el área responsable. La habitación ya está vinculada.',form:<TaskForm action={createTaskAction} options={formOptions} defaultRoomId={detail.room.id} showOrigin={false}/>}]:[]),
                      {id:'reminder',label:'Recordarme después',hint:'Programa un aviso sin crear otro trabajo.',form:<OperationalAlarmCreateForm currentUserId={user.id} defaultRoomNumber={detail.room.number} candidates={alarmCandidates.map(candidate=>({id:candidate.id,name:candidate.name,username:candidate.username,roleName:candidate.role.name}))}/>},
                    ]} advanced={user.permissions.includes('entry.create') ? <EntryForm action={createEntryAction} options={formOptions} defaultRoomId={detail.room.id}/> : undefined}/>
                    {user.permissions.includes('cash.view') ? (
                      <Link
                        href={`/caja?seccion=garantias&habitacion=${detail.room.number}`}
                        className="rounded-sm bg-white px-2.5 py-1.5 text-xs font-semibold text-petrol-800 ring-1 ring-slate-300"
                      >
                        Abrir Caja
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-5 px-4 py-4">
                  <section>
                    <SectionTitle icon={ClipboardCheck} title="Novedades e incidencias" count={detail.entries.length} />
                    {detail.entries.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Sin registros vinculados.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {detail.entries.slice(0, 12).map((entry) => (
                          <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link href={`/libro/${entry.id}`} className="text-sm font-semibold text-petrol-950 hover:underline">
                                #{entry.humanId} · {entry.title}
                              </Link>
                              <Badge tone={entry.severity === 'CRITICA' || entry.priority === 'CRITICA' ? 'critico' : 'neutro'}>
                                {human(entry.status)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {human(entry.type)} · {formatDateTime(entry.occurredAt)}
                              {entry.owner ? ` · ${entry.owner.name}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <SectionTitle icon={ClipboardCheck} title="Tareas" count={detail.tasks.length} />
                    {detail.tasks.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Sin tareas vinculadas.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {detail.tasks.slice(0, 10).map((task) => (
                          <li key={task.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                            <Link href={`/tareas/${task.id}`} className="text-sm font-semibold text-petrol-950 hover:underline">
                              #{task.humanId} · {task.title}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {human(task.status)}
                              {task.assignee ? ` · ${task.assignee.name}` : ' · sin asignar'}
                              {task.dueAt ? ` · vence ${formatDateTime(task.dueAt)}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <SectionTitle icon={RefreshCcw} title="Seguimientos" count={detail.followUps.length} />
                    {detail.followUps.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Sin seguimientos vinculados.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {detail.followUps.slice(0, 10).map((followUp) => (
                          <li key={followUp.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                            <Link href="/seguimientos" className="text-sm font-semibold text-petrol-950 hover:underline">
                              #{followUp.humanId} · {followUp.nextAction ?? followUp.action}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {human(followUp.status)} · {followUp.owner.name}
                              {followUp.scheduledAt ? ` · ${formatDateTime(followUp.scheduledAt)}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <SectionTitle icon={AlarmClock} title="Alertas" count={detail.alarms.length} />
                    {detail.alarms.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Sin alertas vinculadas.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {detail.alarms.slice(0, 10).map((alarm) => (
                          <li key={alarm.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                            <div className="flex items-center gap-2">
                              <BellRing className="h-3.5 w-3.5 text-gold-600" aria-hidden="true" />
                              <span className="text-sm font-semibold text-petrol-950">{alarm.title}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {human(alarm.status)} · {formatDateTime(alarm.dueAt)} · {alarm.createdBy.name}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <SectionTitle icon={Banknote} title="Garantías" count={detail.guarantees.length} />
                    {detail.guarantees.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Sin garantías vinculadas.</p>
                    ) : !canViewCash ? (
                      <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
                        Hay {detail.guarantees.length} garantía(s) vinculada(s). El detalle financiero requiere acceso a Caja.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {detail.guarantees.slice(0, 10).map((guarantee) => (
                          <li key={guarantee.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                            <p className="text-sm font-semibold text-petrol-950">
                              #{guarantee.humanId} · {guarantee.currency} {Number(guarantee.amount).toLocaleString('es-CL')}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {human(guarantee.state)}
                              {guarantee.guestName ? ` · ${guarantee.guestName}` : ''}
                              {guarantee.reference ? ` · ${guarantee.reference}` : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {detail.fines.length > 0 ? (
                    <section>
                      <SectionTitle
                        icon={Receipt}
                        title="Otros registros"
                        count={detail.fines.length}
                      />
                      <ul className="mt-2 space-y-2">
                        {detail.fines.slice(0, 6).map((fine) => (
                          <li key={fine.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                            <p className="text-sm font-semibold text-petrol-950">
                              Multa #{fine.humanId} · {human(fine.kind)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {human(fine.status)} · {fine.reservationCode} · {fine.guestName}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {detail.passes.length > 0 ? (
                    <section>
                      <SectionTitle
                        icon={Receipt}
                        title="Folios de Caja · últimos 30 días"
                        count={detail.passes.length}
                      />
                      <ul className="mt-2 space-y-2">
                        {detail.passes.slice(0, 10).map((pass) => {
                          const serviceDay = pass.serviceDate.toISOString().slice(0, 10);
                          return (
                            <li key={pass.id} className="rounded-md border border-slate-200 bg-white p-2.5">
                              <Link
                                href={`/caja?q=${pass.humanId}&desde=${serviceDay}&hasta=${serviceDay}`}
                                className="text-sm font-semibold text-petrol-950 hover:underline"
                              >
                                {pass.serviceType === 'ESTACIONAMIENTO' ? 'Estacionamiento' : 'Gimnasio'} #{pass.humanId}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatCalendarDate(pass.serviceDate)} · {pass.guestName}
                                {pass.reservationCode ? ` · reserva ${pass.reservationCode}` : ''}
                                {pass.status === 'ANULADO' ? ' · anulado' : ''}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-[0.68rem] leading-5 text-slate-400">
                        Reflejo histórico únicamente: el registro sigue viviendo en Caja y no se duplica como Novedad.
                      </p>
                    </section>
                  ) : null}
                </div>
              </Card>

              <p className="px-1 text-xs leading-5 text-slate-400">
                La habitación es sólo una llave de contexto. AROH no deduce ocupación ni estado de estadía desde esta pantalla.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
