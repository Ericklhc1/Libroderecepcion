import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EntryType } from '@prisma/client';
import { ArrowLeft, DoorOpen, KeyRound } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { getRoomDetail } from '@/server/services/rooms';
import { listAvailableKeys } from '@/server/services/keys';
import { getFormOptions } from '@/server/services/options';
import { NotFoundError } from '@/server/errors';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EntryForm } from '@/components/forms/entry-form';
import { createEntryAction } from '@/server/actions/entries';
import { StayActions } from '@/components/rooms/stay-actions';
import { RoomKeys } from '@/components/rooms/room-keys';
import {
  INCOMING_STATE_LABELS,
  INCOMING_STATE_TONE,
  ROOM_STATE_ACTIONS,
  ROOM_STATE_LABELS,
  ROOM_STATE_TONE,
  STAY_STAGE_LABELS,
  STAY_STATUS_LABELS,
  STAY_STATUS_TONE,
  primaryGuest,
  type StayFacts,
} from '@/domain/rooms';
import {
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  ENTRY_OPEN_STATUSES,
  SEVERITY_LABEL,
  SEVERITY_TONE,
} from '@/domain/labels';
import { formatDate, formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  return { title: `Habitación ${numero}` };
}

/** Una capa de la habitación: saliente, actual o entrante. */
function Layer({
  title,
  stay,
  badge,
  children,
}: {
  title: string;
  stay: StayFacts | null;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        {stay ? <Badge tone={STAY_STATUS_TONE[stay.status]}>{STAY_STATUS_LABELS[stay.status]}</Badge> : null}
      </div>
      {stay ? (
        <>
          <p className="mt-1.5 text-sm font-semibold text-petrol-900">{primaryGuest(stay)}</p>
          {stay.guestNames.length > 1 ? (
            <p className="text-xs text-slate-500">
              Acompañan: {stay.guestNames.slice(1).join(', ')}
            </p>
          ) : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-slate-500">Reserva</dt>
            <dd className="tabular text-petrol-900">{stay.reservationId}</dd>
            <dt className="text-slate-500">Canal</dt>
            <dd className="text-petrol-900">{stay.channel ?? '—'}</dd>
            <dt className="text-slate-500">Llegada</dt>
            <dd className="tabular text-petrol-900">
              {stay.arrivalDate ? formatDate(stay.arrivalDate) : '—'}
            </dd>
            <dt className="text-slate-500">Salida</dt>
            <dd className="tabular text-petrol-900">
              {stay.departureDate ? formatDate(stay.departureDate) : '—'}
            </dd>
            <dt className="text-slate-500">Etapa</dt>
            <dd className="text-petrol-900">{STAY_STAGE_LABELS[stay.stage]}</dd>
          </dl>
          {badge ? <div className="mt-2">{badge}</div> : null}
          {children}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-400">Nadie.</p>
      )}
    </div>
  );
}

export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const user = await requirePagePermission('room.view');
  const { numero } = await params;

  let room;
  try {
    room = await getRoomDetail(numero);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [availableKeys, options, entries] = await Promise.all([
    listAvailableKeys(),
    getFormOptions(),
    prisma.operationalEntry.findMany({
      where: { roomId: room.id, deletedAt: null },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: {
        id: true,
        seq: true,
        type: true,
        title: true,
        status: true,
        severity: true,
        occurredAt: true,
        _count: { select: { tasks: true, followUps: true } },
      },
    }),
  ]);

  const { snapshot } = room;
  const canManage = hasPermission(user, 'room.manage');
  const canKeys = hasPermission(user, 'key.assign');
  const openEntries = entries.filter((entry) => ENTRY_OPEN_STATUSES.includes(entry.status));

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Link
          href="/habitaciones"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Habitaciones
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tabular text-petrol-900">
              Habitación {room.number}
            </h1>
            <Badge tone={ROOM_STATE_TONE[snapshot.state]}>
              {ROOM_STATE_LABELS[snapshot.state]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Piso {room.floor ?? '—'} · {ROOM_STATE_ACTIONS[snapshot.state]}
          </p>
        </div>
        <Dialog
          title="Nueva incidencia en esta habitación"
          description="Queda con la habitación como contexto, junto al huésped y la reserva del momento."
          triggerVariant="secondary"
          trigger={
            <>
              <DoorOpen className="h-4 w-4" aria-hidden="true" />
              Registrar incidencia
            </>
          }
        >
          <EntryForm
            action={createEntryAction}
            options={options}
            defaultType={EntryType.INCIDENCIA}
            lockType
            defaultRoomId={room.id}
          />
        </Dialog>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <Layer title="Saliente" stay={snapshot.outgoing}>
          {snapshot.outgoing && canManage ? (
            <StayActions
              kind="checkout"
              stayId={snapshot.outgoing.id}
              guest={primaryGuest(snapshot.outgoing)}
              roomNumber={room.number}
            />
          ) : null}
        </Layer>

        <Layer title="Actual" stay={snapshot.current} />

        <Layer
          title="Entrante"
          stay={snapshot.incoming}
          badge={
            snapshot.incomingState ? (
              <Badge tone={INCOMING_STATE_TONE[snapshot.incomingState]}>
                {INCOMING_STATE_LABELS[snapshot.incomingState]}
              </Badge>
            ) : null
          }
        >
          {snapshot.incoming && canManage ? (
            snapshot.incomingState === 'EN_COLA' ? (
              <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 ring-1 ring-amber-200">
                No recibe llave ni pasa a in house hasta que se confirme la salida anterior.
              </p>
            ) : (
              <StayActions
                kind="checkin"
                stayId={snapshot.incoming.id}
                guest={primaryGuest(snapshot.incoming)}
                roomNumber={room.number}
                availableKeys={availableKeys}
              />
            )
          ) : null}
        </Layer>
      </div>

      <RoomKeys
        roomId={room.id}
        roomNumber={room.number}
        keys={room.keys.map((key) => ({
          ...key,
          assignedLabel: key.assignedAt
            ? `desde ${formatDateTime(key.assignedAt)}${key.assignedBy ? ` · ${key.assignedBy}` : ''}`
            : null,
        }))}
        canAssign={canKeys}
        canStock={hasPermission(user, 'key.stock')}
        availableKeys={availableKeys}
      />

      <Card>
        <CardHeader
          title="Incidencias y registros de la habitación"
          count={entries.length}
          href={`/libro?hab=${room.number}`}
          hrefLabel="Ver en el libro"
        />
        {entries.length ? (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li key={entry.id} className="px-4 py-3">
                <Link href={`/libro/${entry.id}`} className="group block">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold tabular text-slate-400">#{entry.seq}</span>
                    <span className="text-sm font-medium text-petrol-900 group-hover:underline">
                      {entry.title}
                    </span>
                    <Badge tone={ENTRY_STATUS_TONE[entry.status]}>
                      {ENTRY_STATUS_LABEL[entry.status]}
                    </Badge>
                    {entry.severity ? (
                      <Badge tone={SEVERITY_TONE[entry.severity]}>
                        {SEVERITY_LABEL[entry.severity]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(entry.occurredAt)}
                    {entry._count.tasks ? ` · ${entry._count.tasks} tarea(s)` : ''}
                    {entry._count.followUps ? ` · ${entry._count.followUps} seguimiento(s)` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            message="Sin incidencias registradas en esta habitación."
            hint="Las incidencias exigen habitación o área, así que siempre aparecerán aquí."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Historial de estadías" count={room.history.length} />
        {room.history.length ? (
          <ul className="divide-y divide-slate-100">
            {room.history.map((stay) => (
              <li key={stay.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={STAY_STATUS_TONE[stay.status]}>{STAY_STATUS_LABELS[stay.status]}</Badge>
                <span className="font-medium text-petrol-900">{primaryGuest(stay)}</span>
                <span className="tabular text-slate-400">{stay.reservationId}</span>
                <span className="text-slate-500">{STAY_STAGE_LABELS[stay.stage]}</span>
                <span className="ml-auto tabular text-xs text-slate-400">
                  {stay.arrivalDate ? formatDate(stay.arrivalDate) : '—'} →{' '}
                  {stay.departureDate ? formatDate(stay.departureDate) : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="Sin estadías informadas todavía." />
        )}
      </Card>

      {openEntries.length ? (
        <p className="text-xs text-slate-500">
          <KeyRound className="mr-1 inline h-3 w-3" aria-hidden="true" />
          {openEntries.length} incidencia(s) abierta(s) en esta habitación.
        </p>
      ) : null}
    </div>
  );
}
