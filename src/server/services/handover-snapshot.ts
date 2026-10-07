import { isReceptionHandoverItem } from '@/domain/handover-print';
import { receptionHandoverEntryWhere, closureValidationAlertWhere } from './entry-visibility';
import type {CurrentUser} from '@/server/auth/current-user';
import {taskFollowUpReadWhere,followUpReadWhere,alertReadWhere} from './followup-access';
import 'server-only';
import {
  AlertLevel,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  HandoverLevel,
  ShiftStatus,
} from '@prisma/client';
import type { Prisma, Priority, Severity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import {
  ALERT_TYPE_LABEL,
  ENTRY_OPEN_STATUSES,
  ENTRY_TYPE_LABEL,
} from '@/domain/labels';
import { LIVE_ALERT_WHERE } from './alert-engine';

export type SnapshotItem = {
  section: string;
  level: HandoverLevel;
  title: string;
  detail: string | null;
  refType: string | null;
  refId: string | null;
};

/** Preserve historical evidence and controls; redact reserved content for the current reader. */
export async function visibleSnapshotItems<T extends Pick<SnapshotItem,'refType'|'refId'|'title'|'detail'>>(user: CurrentUser, items:T[], shared=false, db:Prisma.TransactionClient=prisma):Promise<T[]> {
  const ids=(kind:string)=>items.filter(i=>i.refType===kind&&i.refId).map(i=>i.refId!);
  const [tasks,followUps,alerts,entries]=await Promise.all([
    db.task.findMany({where:{id:{in:ids('task')},AND:[taskFollowUpReadWhere(user,shared)]},select:{id:true}}),
    db.followUp.findMany({where:{id:{in:ids('followup')},AND:[followUpReadWhere(user,true,shared)]},select:{id:true}}),
    db.alert.findMany({where:{id:{in:ids('alert')},AND:[alertReadWhere(user,shared),{OR:[{dedupeKey:null},{NOT:closureValidationAlertWhere}]}]},select:{id:true}}),
    db.operationalEntry.findMany({where:{id:{in:ids('entry')},...receptionHandoverEntryWhere},select:{id:true}}),
  ]);
  const allowed=new Map([['task',new Set(tasks.map(t=>t.id))],['followup',new Set(followUps.map(f=>f.id))],['alert',new Set(alerts.map(a=>a.id))]]);
  const receptionEntries=new Set(entries.map(e=>e.id));
  const closureAlerts=await db.alert.findMany({where:{id:{in:ids('alert')},...closureValidationAlertWhere},select:{id:true}});
  const [hiddenAlerts,hiddenFollowUps]=shared?await Promise.all([
    db.alert.findMany({where:{id:{in:ids('alert')},entryId:{not:null},entry:{NOT:receptionHandoverEntryWhere}},select:{id:true}}),
    db.followUp.findMany({where:{id:{in:ids('followup')},entryId:{not:null},entry:{NOT:receptionHandoverEntryWhere}},select:{id:true}}),
  ]):[[],[]];
  const excludedAlerts=new Set([...closureAlerts,...hiddenAlerts].map(a=>a.id));
  const excludedFollowUps=new Set(hiddenFollowUps.map(f=>f.id));
  return items.filter(item=>!shared || (isReceptionHandoverItem({...item,section:'section' in item ? String(item.section) : ''}) && !(item.refType==='entry'&&item.refId&&!receptionEntries.has(item.refId)) && !(item.refType==='alert'&&item.refId&&excludedAlerts.has(item.refId)) && !(item.refType==='followup'&&item.refId&&excludedFollowUps.has(item.refId)))).map(item=>item.refId&&allowed.has(item.refType??'')&&!allowed.get(item.refType!)!.has(item.refId)
    ? {...item,title:'Asunto reservado',detail:'Requiere revisión por una persona autorizada. La evidencia original se conserva.',refType:null,refId:null}
    : item);
}

/** Sanitizes both native items and the historic JSON photograph without rewriting either. */
export async function visibleHandover<T extends {items:SnapshotItem[];snapshot:Prisma.JsonValue|null}>(user:CurrentUser,handover:T):Promise<T>{
  const items=await visibleSnapshotItems(user,handover.items,true);
  let snapshot=handover.snapshot;
  if(snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)&&Array.isArray(snapshot.items)){
    const historical=snapshot.items.map(value=>{
      if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.title!=='string')return {title:'Asunto reservado',detail:'La evidencia original requiere revisión.',refType:null,refId:null};
      return {...value,title:value.title,detail:typeof value.detail==='string'?value.detail:null,refType:typeof value.refType==='string'?value.refType:null,refId:typeof value.refId==='string'?value.refId:null};
    });
    snapshot={...snapshot,items:await visibleSnapshotItems(user,historical,true)};
  }
  return {...handover,items,snapshot};
}

const SECTIONS = {
  resueltos: 'Resuelto en este turno',
  novedades: 'Novedades activas',
  incidencias: 'Incidencias abiertas',
  alertas: 'Alertas activas',
  seguimientos: 'Seguimientos próximos',
} as const;

export const SNAPSHOT_SECTION_ORDER: string[] = Object.values(SECTIONS);

const PRIORITY_TO_LEVEL: Record<Priority, HandoverLevel> = {
  CRITICA: HandoverLevel.URGENTE,
  ALTA: HandoverLevel.IMPORTANTE,
  MEDIA: HandoverLevel.INFORMATIVO,
  BAJA: HandoverLevel.INFORMATIVO,
};

const SEVERITY_TO_LEVEL: Record<Severity, HandoverLevel> = {
  CRITICA: HandoverLevel.URGENTE,
  ALTA: HandoverLevel.URGENTE,
  MEDIA: HandoverLevel.IMPORTANTE,
  BAJA: HandoverLevel.INFORMATIVO,
};

function fmt(date: Date | null | undefined): string {
  if (!date) return 'sin fecha';
  return formatDateTime(date);
}

type SnapshotOptions = {
  shiftId?: string | null;
  /**
   * Compatibilidad con llamadas antiguas. Desde v1.4.0 la entrega no agrega
   * ocupación, dólar ni métricas derivadas de PMS.
   */
  includeMetrics?: boolean;
};

/**
 * Snapshot de entrega v1.4.0.
 *
 * La entrega resume únicamente la continuidad operacional del Libro:
 * Novedades/Incidencias visibles para Recepción, Seguimientos operativos y Alertas.
 * Las tareas y acciones de Supervisión permanecen en sus motores, fuera del relevo. Caja mantiene su
 * propio snapshot y flujo de custodia. PMS, habitaciones, reservas, huéspedes,
 * llaves, multas y ocupación no se consultan ni se proyectan aquí.
 */
export async function buildHandoverSnapshot(
  user: CurrentUser,
  now = new Date(),
  options: SnapshotOptions = {},
): Promise<SnapshotItem[]> {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const items: SnapshotItem[] = [];

  const currentShiftId =
    options.shiftId !== undefined
      ? options.shiftId
      : (
          await prisma.shift.findFirst({
            where: {
              archivedAt: null,
              status: {
                in: [
                  ShiftStatus.INICIADO,
                  ShiftStatus.ACTIVO,
                  ShiftStatus.PREPARANDO_ENTREGA,
                  ShiftStatus.ENTREGA_ENVIADA,
                  ShiftStatus.RECIBIDO,
                ],
              },
            },
            orderBy: { actualStart: 'desc' },
            select: { id: true },
          })
        )?.id ?? null;

  const [
    entries,
    alerts,
    followUps,
    resolvedEntries,
  ] = await Promise.all([
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES }, ...receptionHandoverEntryWhere },
      select: {
        id: true,
        humanId: true,
        type: true,
        title: true,
        description: true,
        priority: true,
        severity: true,
        dueAt: true,
        owner: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ priority: 'desc' }, { occurredAt: 'desc' }],
      take: 200,
    }),
    prisma.alert.findMany({
      where: {...LIVE_ALERT_WHERE(now),AND:[alertReadWhere(user,true),{OR:[{dedupeKey:null},{NOT:closureValidationAlertWhere}]}], taskId:null, OR:[{entryId:null},{entry:receptionHandoverEntryWhere}]} ,
      select: {
        id: true,
        type: true,
        level: true,
        title: true,
        message: true,
        auto: true,
        entryId: true,
        taskId: true,
        followUpId: true,
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
        AND:[followUpReadWhere(user,false,true), { OR: [{ scheduledAt: null }, { scheduledAt: { lte: soon } }] }],
        OR: [{ entryId: null }, { entry: receptionHandoverEntryWhere }],
      },
      select: {
        id: true,
        action: true,
        nextAction: true,
        scheduledAt: true,
        status: true,
        entryId: true,
        entry: { select: { humanId: true, title: true } },
        owner: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    }),
    currentShiftId
      ? prisma.operationalEntry.findMany({
          where: {
            ...receptionHandoverEntryWhere,
            shiftId: currentShiftId,
            deletedAt: null,
            status: { in: [EntryStatus.RESUELTO, EntryStatus.CERRADO] },
          },
          select: {
            id: true,
            humanId: true,
            type: true,
            title: true,
            resolution: true,
            closedAt: true,
            _count: { select: { tasks: {where:taskFollowUpReadWhere(user,true)}, followUps: {where:followUpReadWhere(user,false,true)} } },
          },
          orderBy: [{ closedAt: 'asc' }, { updatedAt: 'asc' }],
          take: 150,
        })
      : Promise.resolve([]),
  ]);

  for (const resolved of resolvedEntries) {
    items.push({
      section: SECTIONS.resueltos,
      level: HandoverLevel.INFORMATIVO,
      title: `#${resolved.humanId} ${resolved.title}`,
      detail: [
        ENTRY_TYPE_LABEL[resolved.type],
        resolved.resolution?.trim() || 'Resuelto durante el turno.',
        resolved._count.tasks > 0 ? `${resolved._count.tasks} tarea(s)` : null,
        resolved._count.followUps > 0
          ? `${resolved._count.followUps} seguimiento(s)`
          : null,
        resolved.closedAt ? `Cerrado ${fmt(resolved.closedAt)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      refType: 'entry',
      refId: resolved.id,
    });
  }

  for (const entry of entries) {
    const detail = [
      entry.description,
      entry.department ? `Área: ${entry.department.name}` : null,
      entry.owner ? `Responsable: ${entry.owner.name}` : 'Sin responsable asignado',
      entry.dueAt ? `Vence: ${fmt(entry.dueAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    items.push({
      section:
        entry.type === EntryType.INCIDENCIA
          ? SECTIONS.incidencias
          : SECTIONS.novedades,
      level:
        entry.type === EntryType.INCIDENCIA && entry.severity
          ? SEVERITY_TO_LEVEL[entry.severity]
          : PRIORITY_TO_LEVEL[entry.priority],
      title: `#${entry.humanId} ${entry.title}`,
      detail:
        entry.type === EntryType.NOVEDAD || entry.type === EntryType.INCIDENCIA
          ? detail
          : `${ENTRY_TYPE_LABEL[entry.type]} · ${detail}`,
      refType: 'entry',
      refId: entry.id,
    });
  }

  for (const followUp of followUps) {
    const overdue = followUp.status === FollowUpStatus.VENCIDO;
    items.push({
      section: SECTIONS.seguimientos,
      level: overdue ? HandoverLevel.URGENTE : HandoverLevel.IMPORTANTE,
      title: followUp.action,
      detail: [
        followUp.entry ? `Caso #${followUp.entry.humanId}: ${followUp.entry.title}` : null,
        followUp.nextAction ? `Próxima acción: ${followUp.nextAction}` : null,
        `Responsable: ${followUp.owner.name}`,
        followUp.scheduledAt
          ? `${overdue ? 'VENCIDO' : 'Programado'}: ${fmt(followUp.scheduledAt)}`
          : 'Sin fecha programada',
      ]
        .filter(Boolean)
        .join(' · '),
      refType: 'followup',
      refId: followUp.id,
    });
  }

  const listed = {
    entry: new Set(entries.map((entry) => entry.id)),
    followUp: new Set(followUps.map((followUp) => followUp.id)),
  };

  for (const alert of alerts) {
    const alreadyListed =
      alert.auto &&
      ((alert.entryId !== null && listed.entry.has(alert.entryId)) ||
        (alert.followUpId !== null && listed.followUp.has(alert.followUpId)));
    if (alreadyListed) continue;

    items.push({
      section: SECTIONS.alertas,
      level:
        alert.level === AlertLevel.CRITICA
          ? HandoverLevel.URGENTE
          : alert.level === AlertLevel.ATENCION
            ? HandoverLevel.IMPORTANTE
            : HandoverLevel.INFORMATIVO,
      title: `${ALERT_TYPE_LABEL[alert.type]}: ${alert.title}`,
      detail: alert.message,
      refType: 'alert',
      refId: alert.id,
    });
  }

  return items.filter(isReceptionHandoverItem);
}
