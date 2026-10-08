import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import { maintenanceBlocksBackground } from '@/server/services/system-maintenance';
import {visibleHandover} from './handover-snapshot';
import {taskFollowUpReadWhere,followUpReadSql,taskFollowUpReadSql} from './followup-access';
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
import { Prisma } from '@prisma/client';
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
  // Nine distinct keys per source leave room for eight displayed groups and overflow.
  // Only twenty original links per duplicate group travel to the dashboard.
  const taskCandidates=async()=>{const rows=await prisma.$queryRaw<Array<{id:string;humanId:number;title:string;priority:Priority;displayGroupTotal:number;sourceTotal:number}>>(Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT t.id,t."humanId",t.title,t.priority,t."dueAt"
      FROM "Task" t WHERE t."deletedAt" IS NULL AND t.status IN (${Prisma.join(TASK_OPEN_STATUSES.map(status=>Prisma.sql`${status}::"TaskStatus"`))}) AND t."dueAt"<${now} AND (${taskFollowUpReadSql(user)})
    ), keys AS (
      SELECT title,COUNT(*)::integer AS total,MAX(CASE priority WHEN 'CRITICA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END) AS score,MIN("dueAt") AS due
      FROM eligible GROUP BY title ORDER BY score DESC,due ASC,title ASC LIMIT 9
    ), ranked AS (
      SELECT e.*,k.total AS "displayGroupTotal",k.score,k.due,ROW_NUMBER() OVER(PARTITION BY e.title ORDER BY e.priority DESC,e."dueAt" ASC,e.id ASC) AS position
      FROM eligible e JOIN keys k ON k.title=e.title
    ) SELECT r.id,r."humanId",r.title,r.priority,r."displayGroupTotal",totals.total AS "sourceTotal" FROM (SELECT COUNT(*)::integer AS total FROM eligible) totals LEFT JOIN ranked r ON r.position<=20 ORDER BY r.score DESC,r.due ASC,r.title ASC,r.position ASC
  `);return {items:rows.filter(row=>row.id!==null),total:rows[0]?.sourceTotal??0};};
  const followCandidates=async()=>{const rows=await prisma.$queryRaw<Array<{id:string;humanId:number;action:string;status:FollowUpStatus;displayGroupTotal:number;sourceTotal:number}>>(Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT f.id,f."humanId",f.action,f.status,f."scheduledAt"
      FROM "FollowUp" f WHERE f."deletedAt" IS NULL AND f.status IN ('PENDIENTE','VENCIDO') AND (${followUpReadSql(user)})
    ), keys AS (
      SELECT action,status,COUNT(*)::integer AS total,MIN("scheduledAt") AS due
      FROM eligible GROUP BY action,status ORDER BY status DESC,due ASC,action ASC LIMIT 9
    ), ranked AS (
      SELECT e.*,k.total AS "displayGroupTotal",k.due,ROW_NUMBER() OVER(PARTITION BY e.action,e.status ORDER BY e."scheduledAt" ASC,e.id ASC) AS position
      FROM eligible e JOIN keys k ON k.action=e.action AND k.status=e.status
    ) SELECT r.id,r."humanId",r.action,r.status,r."displayGroupTotal",totals.total AS "sourceTotal" FROM (SELECT COUNT(*)::integer AS total FROM eligible) totals LEFT JOIN ranked r ON r.position<=20 ORDER BY r.status DESC,r.due ASC,r.action ASC,r.position ASC
  `);return {items:rows.filter(row=>row.id!==null),total:rows[0]?.sourceTotal??0};};
  const entryCandidates=async()=> (await Promise.all([
    readEntries(prisma,user).findMany({where:{AND:[entryWhere,{dueAt:{lt:now}}]},select:{id:true,humanId:true,title:true,priority:true,dueAt:true},orderBy:[{priority:'desc'},{dueAt:'asc'},{id:'asc'}],take:9}),
    readEntries(prisma,user).findMany({where:{AND:[entryWhere,{OR:[{dueAt:null},{dueAt:{gte:now}}]}]},select:{id:true,humanId:true,title:true,priority:true,dueAt:true},orderBy:[{priority:'desc'},{id:'asc'}],take:9}),
  ])).flat();
  const [
    incoming,
    criticalEntries,
    taskCandidateData,
    myTasks,
    followCandidateData,
    blockingOutgoing,
    entryTotal,
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
    readEntries(prisma,user).count({where:entryWhere}),
  ]);

  const overdueTasks=taskCandidateData.items;const followUps=followCandidateData.items;

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
    myShift ? getShiftMetrics(myShift.id,user) : null,
    readEntries(prisma,user).count({
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
    readEntries(prisma,user).count({
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
    attentionTotal:entryTotal+taskCandidateData.total+followCandidateData.total,
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
