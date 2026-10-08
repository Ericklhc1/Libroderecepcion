import 'server-only';
import { maintenanceBlocksBackground } from '@/server/services/system-maintenance';
import {visibleHandover} from './handover-snapshot';
import {followUpReadWhere,taskFollowUpReadWhere} from './followup-access';
import {
  AlertLevel,
  AlertStatus,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  Priority,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { runAlertEngine } from './alert-engine';
import {
  getCurrentShift,
  getMyOpenShift,
  getPendingHandover,
  resolveOperationalBusinessDate,
} from './shifts';
import { getShiftMetrics } from './metrics';
import { isReceptionDeskRole } from '@/lib/permissions';
import { buildOperationalAttention } from '@/domain/operational-attention';
import { countMyActiveOperationalAlarms } from './operational-alarms';

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
        if (await maintenanceBlocksBackground()) return;
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
  const businessDate = myShift?.date ?? await resolveOperationalBusinessDate(now);
  const receptionEntriesOnly = isReceptionDeskRole(user.roleKey);

  const entryWhere:Prisma.OperationalEntryWhereInput={deletedAt:null,status:{in:ENTRY_OPEN_STATUSES},...(receptionEntriesOnly?{type:{in:[EntryType.NOVEDAD,EntryType.INCIDENCIA]}}:{}),OR:[{priority:{in:[Priority.CRITICA,Priority.ALTA]}},{dueAt:{lt:now}}]};
  const taskWhere:Prisma.TaskWhereInput={deletedAt:null,AND:[taskFollowUpReadWhere(user)],status:{in:TASK_OPEN_STATUSES},dueAt:{lt:now}};
  const followWhere:Prisma.FollowUpWhereInput={deletedAt:null,AND:[followUpReadWhere(user)],status:{in:[FollowUpStatus.PENDIENTE,FollowUpStatus.VENCIDO]}};
  // Nine distinct keys per source leave room for eight displayed groups and overflow.
  // Only twenty original links per duplicate group travel to the dashboard.
  const taskCandidates=async()=>{
    const titles:string[]=[];
    for(const priority of [Priority.CRITICA,Priority.ALTA,Priority.MEDIA,Priority.BAJA]){
      const groups=await prisma.task.groupBy({by:['title'],where:{AND:[taskWhere,{priority},{title:{notIn:titles}}]},_min:{dueAt:true},orderBy:[{_min:{dueAt:'asc'}},{title:'asc'}],take:9-titles.length});
      titles.push(...groups.map(group=>group.title));if(titles.length===9)break;
    }
    const counts=await prisma.task.groupBy({by:['title'],where:{AND:[taskWhere,{title:{in:titles}}]},_count:{_all:true}});
    const totals=new Map(counts.map(group=>[group.title,group._count._all]));
    return (await Promise.all(titles.map(async title=>(await prisma.task.findMany({where:{AND:[taskWhere,{title}]},select:{id:true,humanId:true,title:true,priority:true},orderBy:[{priority:'desc'},{dueAt:'asc'},{id:'asc'}],take:20})).map(row=>({...row,displayGroupTotal:totals.get(title)??0}))))).flat();
  };
  const followCandidates=async()=>{
    const groups=await prisma.followUp.groupBy({by:['action','status'],where:followWhere,_count:{_all:true},_min:{scheduledAt:true},orderBy:[{status:'desc'},{_min:{scheduledAt:'asc'}},{action:'asc'}],take:9});
    return (await Promise.all(groups.map(async group=>(await prisma.followUp.findMany({where:{AND:[followWhere,{action:group.action,status:group.status}]},select:{id:true,humanId:true,action:true,status:true},orderBy:[{scheduledAt:'asc'},{id:'asc'}],take:20})).map(row=>({...row,displayGroupTotal:group._count._all}))))).flat();
  };
  const entryCandidates=async()=> (await Promise.all([
    prisma.operationalEntry.findMany({where:{AND:[entryWhere,{dueAt:{lt:now}}]},select:{id:true,humanId:true,title:true,priority:true,dueAt:true},orderBy:[{priority:'desc'},{dueAt:'asc'},{id:'asc'}],take:9}),
    prisma.operationalEntry.findMany({where:{AND:[entryWhere,{OR:[{dueAt:null},{dueAt:{gte:now}}]}]},select:{id:true,humanId:true,title:true,priority:true,dueAt:true},orderBy:[{priority:'desc'},{id:'asc'}],take:9}),
  ])).flat();
  const [
    incoming,
    criticalEntries,
    overdueTasks,
    myTasks,
    followUps,
    blockingOutgoing,
    entryTotal,
    taskTotal,
    followTotal,
  ] = await Promise.all([
    getPendingHandover(myShift?.id ?? null),
    entryCandidates(),
    taskCandidates(),
    prisma.task.findMany({
      where: { deletedAt: null,AND:[taskFollowUpReadWhere(user)], assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
      select: { id: true, dueAt: true },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 8,
    }),
    followCandidates(),
    prisma.shift.findFirst({
      where: {
        archivedAt: null,
        status: {
          in: [
            ShiftStatus.INICIADO,
            ShiftStatus.ACTIVO,
            ShiftStatus.PREPARANDO_ENTREGA,
            ShiftStatus.ENTREGA_ENVIADA,
          ],
        },
        assignments: {
          some: {
            activatedAt: { not: null },
            leftAt: null,
          },
        },
      },
      select: { id: true, status: true },
      orderBy: { actualStart: 'asc' },
    }),
    prisma.operationalEntry.count({where:entryWhere}),
    prisma.task.count({where:taskWhere}),
    prisma.followUp.count({where:followWhere}),
  ]);

  /*
    Los contadores y el resumen del turno no dependen entre sí. Encadenarlos
    con `await` sucesivos costaba viajes a la base uno detrás de otro, que es
    lo que se percibía como demora al abrir Inicio tras cada acción.
  */
  const [
    nextShift,
    shiftMetrics,
    openEntries,
    openTasks,
    openIncidents,
    liveAlerts,
  ] = await Promise.all([
    // El «turno siguiente» ya no se deduce por adyacencia: es el que esté
    // en curso, que puede ser el propio o ninguno.
    getCurrentShift(),
    myShift ? getShiftMetrics(myShift.id) : null,
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        ...(receptionEntriesOnly
          ? {
              type: { in: [EntryType.NOVEDAD, EntryType.INCIDENCIA] },
            }
          : {}),
      },
    }),
    prisma.task.count({
      where: { deletedAt: null,AND:[taskFollowUpReadWhere(user)], status: { in: TASK_OPEN_STATUSES } },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
    }),
    countMyActiveOperationalAlarms(user.id),
  ]);

  const roomsNeedingAction: [] = [];
  // Compatibilidad del contrato del dashboard: las Alert legadas ya no se
  // proyectan en Inicio, pero el campo conserva su tipo para consumidores
  // existentes mientras migran a OperationalAlarm.
  const alerts: Array<{
    id: string;
    level: AlertLevel;
    title: string;
    message: string | null;
  }> = [];

  const counters = {
    openEntries,
    openTasks,
    openIncidents,
    liveAlerts,
    criticalAlerts: 0,
    roomsNeedingAction: roomsNeedingAction.length,
  };

  const attention = buildOperationalAttention({
    rooms: [],
    alerts: alerts.map((alert) => ({
      id: alert.id,
      level: alert.level,
      title: alert.title,
      message: alert.message,
    })),
    overdueTasks: overdueTasks.map((task) => ({
      id: task.id,
      humanId: task.humanId,
      title: task.title,
      priority: task.priority,
      displayGroupTotal:task.displayGroupTotal,
    })),
    criticalEntries: criticalEntries.map((entry) => ({
      id: entry.id,
      humanId: entry.humanId,
      title: entry.title,
      priority: entry.priority,
      overdue: Boolean(entry.dueAt && entry.dueAt < now),
    })),
    followUps: followUps.map((followUp) => ({
      id: followUp.id,
      humanId: followUp.humanId,
      action: followUp.action,
      status: followUp.status,
      displayGroupTotal:followUp.displayGroupTotal,
    })),
  }, 9*20*2+18);

  return {
    now,
    attentionTotal:entryTotal+taskTotal+followTotal,
    myShift,
    incoming: incoming ? await visibleHandover(user,incoming) : null,
    nextShift,
    shiftMetrics,
    criticalEntries,
    overdueTasks,
    myTasks,
    alerts,
    followUps,
    blockingOutgoing,
    roomsNeedingAction,
    attention,
    counters,
    today: businessDate,
  };
}

export const DASHBOARD_ENUMS = {
  EntryStatus,
  TaskStatus,
  AlertStatus,
  ShiftStatus,
};
