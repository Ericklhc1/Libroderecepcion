import 'server-only';
import {
  AlertStatus,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  HandoverStatus,
  Priority,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import type { CurrentUser } from '@/server/auth/current-user';
import { LIVE_ALERT_WHERE, runAlertEngine } from './alert-engine';
import {
  getCurrentShift,
  getMyOpenShift,
  getPendingHandover,
  getShiftsAwaitingReceipt,
  operationalDate,
} from './shifts';
import { getShiftMetrics } from './metrics';
import { listRoomsWithState } from './rooms';
import type { RoomState } from '@/domain/rooms';
import { getSettingNumber } from './settings';

let lastEngineRun = 0;
const ENGINE_THROTTLE_MS = 60_000;

/**
 * Mantiene las alertas al día sin un proceso programado externo.
 *
 * El motor son 18 consultas. Ejecutarlo dentro del render dejaba esas 18
 * esperas delante de la primera pantalla que ve el recepcionista, y con la
 * base en otra región eso se siente. `after()` corre el motor **después** de
 * enviar la respuesta: la pantalla sale con los datos que ya hay y el motor
 * deja las alertas listas para la siguiente carga.
 *
 * El límite de una vez por minuto por instancia se mantiene: evita que cada
 * navegación lo dispare.
 */
export function refreshAlertsInBackground(): void {
  const now = Date.now();
  if (now - lastEngineRun < ENGINE_THROTTLE_MS) return;
  lastEngineRun = now;
  try {
    after(async () => {
      try {
        await runAlertEngine();
      } catch (error) {
        console.error('[alertas] el motor falló', error);
      }
    });
  } catch (error) {
    /*
      `after` sólo existe dentro de una petición: si a este servicio lo llama
      un script o una prueba, lanza. El motor es frescura, no corrección, así
      que no puede tumbar la pantalla. Se deja el turno libre para que la
      siguiente petición real lo vuelva a intentar.
    */
    lastEngineRun = 0;
    console.warn('[alertas] el motor no se pudo programar en segundo plano', error);
  }
}

export async function getDashboardData(user: CurrentUser) {
  refreshAlertsInBackground();

  const now = new Date();
  const myShift = await getMyOpenShift(user.id);

  const [
    awaitingReceipt,
    incoming,
    criticalEntries,
    overdueTasks,
    myTasks,
    openIncidents,
    alerts,
    followUps,
    latestEntries,
    lastReceivedHandover,
  ] = await Promise.all([
    /*
      Ya no se ofrece «una lista de franjas tomables»: con un solo turno a la
      vez la pregunta es otra —¿hay uno abierto, y hay un cierre esperando?—.
    */
    getShiftsAwaitingReceipt(),
    getPendingHandover(myShift?.id ?? null),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        OR: [
          { priority: { in: [Priority.CRITICA, Priority.ALTA] } },
          { dueAt: { lt: now } },
        ],
      },
      include: {
        owner: { select: { id: true, name: true } },
        department: { select: { name: true } },
        guest: { select: { fullName: true, roomNumber: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      take: 8,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES }, dueAt: { lt: now } },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 8,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
      include: {
        entry: { select: { id: true, seq: true } },
        _count: { select: { checklist: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 8,
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
      include: {
        owner: { select: { id: true, name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
      take: 6,
    }),
    prisma.alert.findMany({
      where: LIVE_ALERT_WHERE(now),
      include: {
        entry: { select: { id: true, seq: true } },
        task: { select: { id: true } },
        reservation: { select: { code: true } },
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
      },
      include: {
        owner: { select: { id: true, name: true } },
        entry: { select: { id: true, seq: true, title: true } },
      },
      orderBy: [{ scheduledAt: 'asc' }],
      take: 6,
    }),
    prisma.operationalEntry.findMany({
      where: { deletedAt: null },
      include: {
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 6,
    }),
    // Última entrega que recibió el turno en curso (o el usuario).
    prisma.shiftHandover.findFirst({
      where: {
        status: HandoverStatus.RECIBIDA,
        ...(myShift ? { toShiftId: myShift.id } : { receivedById: user.id }),
      },
      include: {
        issuedBy: { select: { name: true } },
        receivedBy: { select: { name: true } },
        fromShift: { select: { type: true, date: true } },
        items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
      },
      orderBy: { receivedAt: 'desc' },
    }),
  ]);

  /*
    Los contadores y el resumen del turno no dependen entre sí. Encadenarlos
    con `await` sucesivos costaba viajes a la base uno detrás de otro, que es
    lo que se percibía como demora al abrir Inicio tras cada acción.
  */
  const [
    nextShift,
    shiftMetrics,
    allRooms,
    openEntries,
    openTasks,
    liveAlerts,
    criticalAlerts,
    usdRateCLP,
  ] = await Promise.all([
    // El «turno siguiente» ya no se deduce por adyacencia: es el que esté
    // en curso, que puede ser el propio o ninguno.
    getCurrentShift(),
    myShift ? getShiftMetrics(myShift.id) : null,
    // Sólo a quien puede ver el tablero: el panel no salta el permiso.
    user.permissions.includes('room.view') ? listRoomsWithState() : [],
    prisma.operationalEntry.count({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
    }),
    prisma.alert.count({ where: LIVE_ALERT_WHERE(now) }),
    prisma.alert.count({ where: { ...LIVE_ALERT_WHERE(now), level: 'CRITICA' } }),
    getSettingNumber('reception.usdRateCLP', 0),
  ]);

  /*
    Habitaciones que piden una acción concreta del turno. El estado ya lo
    calcula el tablero: acá sólo se filtra, no se vuelve a derivar.
  */
  const ATTENTION_STATES: RoomState[] = [
    'CHECK_OUT_PENDIENTE',
    'PENDIENTE_LIBERACION',
    'CHECK_IN_EN_COLA',
    'CHECK_IN_LISTO',
  ];
  const roomsNeedingAction = allRooms
    .filter(
      (room) =>
        ATTENTION_STATES.includes(room.snapshot.state) ||
        room.openIncidents > 0 ||
        room.snapshot.keysOut.length > 0,
    )
    // El orden es el de urgencia: primero lo que bloquea una entrada.
    .sort(
      (a, b) =>
        ATTENTION_STATES.indexOf(a.snapshot.state) - ATTENTION_STATES.indexOf(b.snapshot.state),
    )
    .slice(0, 8);

  /*
    Ocupación de recepción, no estadística comercial: una habitación sigue
    contando como ocupada mientras haya alguien dentro O una salida todavía
    sin confirmar. Así el porcentaje representa lo que el mesón debe operar,
    no una proyección abstracta.
  */
  const occupiedRooms = allRooms.filter(
    (room) => room.snapshot.current !== null || room.snapshot.outgoing !== null,
  ).length;
  const pendingCheckOuts = allRooms.filter((room) => room.snapshot.outgoing !== null).length;
  const occupancyPercent =
    allRooms.length > 0 ? Math.round((occupiedRooms / allRooms.length) * 1000) / 10 : null;

  /*
    La entrega anterior es el punto de partida del turno actual. Sus métricas
    se guardan como elementos de la misma entrega —no como otra tabla— para que
    «inicio» y «cierre» hablen de la misma fotografía operativa.
  */
  const receivedOccupancy =
    lastReceivedHandover?.items.find(
      (item) => item.refType === 'metric' && item.refId === 'occupancy',
    )?.title ?? null;
  const receivedUsdRate =
    lastReceivedHandover?.items.find(
      (item) => item.refType === 'metric' && item.refId === 'usd-rate',
    )?.title ?? null;

  const counters = {
    openEntries,
    openTasks,
    liveAlerts,
    criticalAlerts,
    roomsNeedingAction: roomsNeedingAction.length,
  };

  return {
    now,
    myShift,
    awaitingReceipt,
    incoming,
    nextShift,
    shiftMetrics,
    criticalEntries,
    overdueTasks,
    myTasks,
    openIncidents,
    alerts,
    followUps,
    latestEntries,
    lastReceivedHandover,
    roomsNeedingAction,
    operational: {
      occupiedRooms,
      totalRooms: allRooms.length,
      occupancyPercent,
      pendingCheckOuts,
      usdRateCLP,
      receivedOccupancy,
      receivedUsdRate,
    },
    counters,
    today: operationalDate(now),
  };
}

export const DASHBOARD_ENUMS = {
  EntryStatus,
  TaskStatus,
  AlertStatus,
  ShiftStatus,
};
