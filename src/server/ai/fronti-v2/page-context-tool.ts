import { canReadReceptionHandover,visibleHandover } from '@/server/services/handover-snapshot';
import { assertClosureReviewer, legacyClosureAlertWhere, closureReviewState } from '@/server/services/closure-review';
import { outstandingAmount } from '@/domain/guarantees';
import { listAreaAttentions } from '@/server/services/subject-distribution';
import { getChangesSinceLastShift } from '@/server/services/shift-changes';
import {alertReadWhere} from '@/server/services/followup-access';
import 'server-only';
import { getMaintenanceState } from '@/server/services/system-maintenance';
import { formatDateTime } from '@/lib/format';
import { readScheduleContext } from './schedule-context';
import { getCoordinationBoard, coordinationMetrics, type CoordinationView } from '@/server/services/coordination';
import { getHkWorkday } from '@/server/services/housekeeping-work';
import { getManagementWorkday } from '@/server/services/management-workday';
import { listLostFound } from '@/server/services/lost-found';
import { HK_WORK_LABELS, isHkFocused } from '@/domain/housekeeping-work';

import { OperationalAlarmStatus } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { getDashboardData } from '@/server/services/dashboard';
import { getSubjectEntry } from '@/server/services/entries';
import { getTask } from '@/server/services/tasks';
import { getBookItems } from '@/server/services/book';
import {
  getReservationOperationalContext,
  getReservationOperationalContextByCode,
  reservationModuleSignals,
} from '@/server/services/reservation-context';
import { getRoomDetail } from '@/server/services/rooms';
import { getRoomMonitorDetail, getRoomMonitorOverview } from '@/server/services/room-monitor';
import { getLiveCashState } from '@/server/services/live-cash';
import { listStaffLoans } from '@/server/services/key-staff';
import { getKeyInventory } from '@/server/services/keys';
import { listMyOperationalAlarms } from '@/server/services/operational-alarms';
import { listGymPasses, listParkingPasses } from '@/server/services/gym-pass';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { getMetrics, defaultRange } from '@/server/services/metrics';
import { getManagementCockpit } from '@/server/services/management';
import { getManagementEvidence, getManagementKeyEvidence } from '@/server/services/management-evidence';
import {
  getOperationalHealth,
  operationalHealthRange,
  type OperationalHealthPeriod,
} from '@/server/services/operational-health';
import { getDiagnosticReport } from '@/server/services/diagnostics';
import { getMailConfigView } from '@/server/services/mail-settings';
import { getNotificationEmailPolicy } from '@/server/services/notification-email-policy';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import { getTeamPerformance } from '@/server/services/performance';
import {
  buildSupervisorReport,
  reportDateRange,
  type SupervisorReportType,
} from '@/server/services/supervisor-reports';
import {
  addHotelCalendarDays,
  hotelDateKey,
  hotelWallDateTime,
} from '@/domain/time';
import { executeFrontiV2ReadTool } from './read-tools';
import type { FrontiResolvedPageContext } from './page-context';

function has(user: CurrentUser, permission: string): boolean {
  return user.permissions.includes(permission as never);
}

function hasAny(user: CurrentUser, permissions: string[]): boolean {
  return permissions.some((permission) => has(user, permission));
}

function requireAny(user: CurrentUser, permissions: string[], message: string) {
  if (!hasAny(user, permissions) && !user.isSystemAdmin) throw new Error(message);
}

async function safeRead(
  user: CurrentUser,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    const response = await executeFrontiV2ReadTool(user, name, args);
    return response.handled ? response.result ?? null : null;
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'No disponible para esta cuenta.',
    };
  }
}

function compactReservationContext(
  reservation: NonNullable<Awaited<ReturnType<typeof getReservationOperationalContext>>>,
) {
  const signals = reservationModuleSignals(reservation);
  return {
    id: reservation.id,
    code: reservation.code,
    status: reservation.status,
    roomNumber: reservation.roomNumber,
    guest: reservation.guest?.fullName ?? null,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    channel: reservation.channel,
    guaranteeStatus: reservation.guaranteeStatus,
    balanceDue: reservation.balanceDue ? Number(reservation.balanceDue) : null,
    requiresAction: reservation.requiresAction,
    actionNote: reservation.actionNote,
    signals,
    guarantees: reservation.guarantees.slice(0, 12).map((item) => ({
      id: item.id,
      reference: item.reference,
      state: item.state,
      kind: item.kind,
      amount: Number(item.amount),
      appliedAmount: Number(item.appliedAmount ?? 0),
      penaltyAmount: Number(item.penaltyAmount ?? 0),
      currency: item.currency,
      dueAt: item.dueAt,
    })),
    activeStays: reservation.stays
      .filter((stay) => stay.stage !== 'FINALIZADO')
      .slice(0, 12)
      .map((stay) => ({
        id: stay.id,
        room: stay.room?.number ?? null,
        status: stay.status,
        stage: stay.stage,
        arrivalDate: stay.arrivalDate,
        departureDate: stay.departureDate,
        guestNames: stay.guestNames,
        keys: stay.keys.map((key) => ({ code: key.code, status: key.status })),
      })),
    recentEntries: reservation.entries.slice(0, 10).map((entry) => ({
      id: entry.id,
      ref: `#${entry.humanId}`,
      type: entry.type,
      title: entry.title,
      status: entry.status,
      priority: entry.priority,
      owner: entry.owner?.name ?? null,
    })),
    alerts: reservation.alerts.slice(0, 10).map((alert) => ({
      id: alert.id,
      title: alert.title,
      status: alert.status,
      level: alert.level,
      dueAt: alert.dueAt,
    })),
  };
}

async function bookSnapshot(page: FrontiResolvedPageContext,user:CurrentUser) {
  const result = await getBookItems({
    q: page.filters.q || undefined,
    onlyOpen: page.moduleKey !== 'historial',
    page: 1,
    pageSize: 30,
  },user);
  return {
    query: page.filters.q || null,
    hasMore: result.hasMore,
    items: result.items.slice(0, 30).map((item) => ({
      kind: item.kind,
      id: item.id,
      ref: item.ref,
      title: item.title,
      status: item.statusLabel,
      priority: item.priorityLabel,
      owner: item.ownerName,
      dueAt: item.dueAt,
      overdue: item.overdue,
      href: item.href,
    })),
  };
}

async function detailSnapshot(
  user: CurrentUser,
  page: FrontiResolvedPageContext,
): Promise<unknown> {
  if (!page.entityType || !page.entityId) return null;

  if (page.entityType === 'OperationalEntry') {
    const entry = await getSubjectEntry(user, page.entityId).catch(() => null);
    if (!entry) return { found: false };
    const room = entry.roomId
      ? await prisma.room.findUnique({
          where: { id: entry.roomId },
          select: { number: true },
        })
      : null;
    return {
      found: true,
      type: entry.type,
      id: entry.id,
      ref: `#${entry.humanId}`,
      title: entry.title,
      description: entry.description,
      status: entry.status,
      priority: entry.priority,
      severity: entry.severity,
      dueAt: entry.dueAt,
      room: room?.number ?? null,
      owner: entry.owner?.name ?? null,
      department: entry.department?.name ?? null,
      requiresFollowUp: entry.requiresFollowUp,
      resolution: entry.resolution,
      rootCause: entry.rootCause,
    };
  }

  if (page.entityType === 'Task') {
    const task = await getTask(page.entityId,user).catch(() => null);
    if (!task) return { found: false };
    const room = task.roomId
      ? await prisma.room.findUnique({
          where: { id: task.roomId },
          select: { number: true },
        })
      : null;
    return {
      found: true,
      id: task.id,
      ref: `#${task.humanId}`,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      startsAt: task.startsAt,
      dueAt: task.dueAt,
      assignee: task.assignee?.name ?? null,
      department: task.department?.name ?? null,
      room: room?.number ?? null,
      blockedReason: task.blockedReason,
      checklist: task.checklist.map((item) => ({ text: item.text, done: item.done })),
    };
  }

  if (page.entityType === 'ReservationReference') {
    requireAny(user, ['guest.view', 'guest.manage'], 'No tienes permiso para consultar reservas.');
    const reservation = await getReservationOperationalContext(page.entityId);
    return reservation ? compactReservationContext(reservation) : { found: false };
  }

  if (page.entityType === 'ReservationCode') {
    requireAny(
      user,
      ['room.view', 'guest.view', 'guest.manage'],
      'No tienes permiso para consultar reservas.',
    );
    const reservation = await getReservationOperationalContextByCode(page.entityId);
    return reservation ? compactReservationContext(reservation) : { found: false };
  }

  if (page.entityType === 'RoomNumber') {
    requireAny(user, ['room.view'], 'No tienes permiso para consultar habitaciones.');
    const room = await getRoomDetail(page.entityId).catch(() => null);
    if (!room) return { found: false };
    return {
      found: true,
      room: room.number,
      state: room.snapshot.state,
      outgoing: room.snapshot.outgoing
        ? {
            reservationId: room.snapshot.outgoing.reservationId,
            guests: room.snapshot.outgoing.guestNames,
          }
        : null,
      current: room.snapshot.current
        ? {
            reservationId: room.snapshot.current.reservationId,
            guests: room.snapshot.current.guestNames,
          }
        : null,
      incoming: room.snapshot.incoming
        ? {
            reservationId: room.snapshot.incoming.reservationId,
            guests: room.snapshot.incoming.guestNames,
          }
        : null,
      incomingState: room.snapshot.incomingState,
      keysOut: room.snapshot.keysOut.map((key) => ({ code: key.code, status: key.status })),
      openIncidents: room.openIncidents,
    };
  }

  if (page.entityType === 'KeyStaffLoan') {
    requireAny(user, ['key.assign','key.inventory','key.stock'], 'No tienes permiso para consultar entregas de llaves.');
    return await prisma.keyStaffLoan.findUnique({where:{id:page.entityId},select:{humanId:true,departmentName:true,collaboratorName:true,authorizedByName:true,createdByName:true,createdAt:true,notes:true,items:{select:{keyCode:true,destinationName:true,destinationKind:true,returnedAt:true,returnNote:true}}}}) ?? {found:false};
  }

  if (page.entityType === 'KeyInventoryCount') {
    requireAny(user, ['key.assign', 'key.inventory', 'key.stock'], 'No tienes permiso para consultar inventarios de llaves.');
    const count = await prisma.keyInventoryCount.findUnique({ where: { id: page.entityId }, select: { id: true, humanId: true, floor: true, countedAt: true, notes: true, areasSnapshot: true, staffCustodySnapshot: true, countedBy: { select: { name: true } }, items: { select: { roomNumberSnapshot: true, room: { select: { number: true } }, expected: true, found: true, accountedElsewhere: true, outOfService: true, notes: true } } } });
    return count ? { ...count, items: count.items.map(({ room, ...item }) => ({ ...item, roomNumber: item.roomNumberSnapshot ?? room.number })) } : { found: false };
  }

  if (page.entityType === 'Guarantee') {
    requireAny(user,['cash.view'],'No tienes permiso para consultar garantías.');
    const guarantee=await prisma.guarantee.findFirst({where:{id:page.entityId,deletedAt:null,...(user.isSystemAdmin?{}:{isDemo:false})},select:{id:true,humanId:true,kind:true,state:true,currency:true,amount:true,appliedAmount:true,penaltyAmount:true,returnedAmount:true,guestName:true,roomNumber:true,reference:true,dueAt:true,notes:true,createdAt:true,settlements:{select:{kind:true,currency:true,amount:true,reason:true,createdAt:true,createdBy:{select:{name:true}}},orderBy:{createdAt:'desc'}}}});
    if(!guarantee)return {found:false};
    const amounts={amount:Number(guarantee.amount),appliedAmount:Number(guarantee.appliedAmount??0),penaltyAmount:Number(guarantee.penaltyAmount??0),returnedAmount:Number(guarantee.returnedAmount??0)};
    return {found:true,...guarantee,...amounts,outstandingAmount:outstandingAmount(amounts),settlements:guarantee.settlements.map(s=>({...s,amount:Number(s.amount)}))};
  }
  if (page.entityType === 'Shift') {
    assertClosureReviewer(user);
    const shift=await prisma.shift.findFirst({where:{id:page.entityId,...(user.isSystemAdmin?{}:{isDemo:false})},select:{id:true,humanId:true,date:true,type:true,status:true,actualEnd:true,archivedAt:true,closureReviewRequestedAt:true,closureReviewDecision:true,closureReviewNote:true,closureReviewedAt:true,handoverOut:{select:{id:true,status:true,issuedAt:true,receivedAt:true,issuedBy:{select:{name:true}},receivedBy:{select:{name:true}}}}}});
    if(!shift)return {found:false};
    const legacy=await prisma.alert.findFirst({where:legacyClosureAlertWhere(shift.id),select:{status:true}});
    return {found:true,...shift,pending:closureReviewState(shift,legacy).pending,href:`/supervision/cierres/${shift.id}`,handoverHref:shift.handoverOut?`/turno/entrega/${shift.handoverOut.id}`:null};
  }

  if (page.entityType === 'CashAudit') {
    requireAny(user, ['cash.view'], 'No tienes permiso para consultar arqueos.');
    const audit = await prisma.cashAudit.findUnique({
      where: { id: page.entityId },
      select: {
        id: true,
        createdAt: true,
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        denominationSnapshot: true,
        guaranteeSnapshot: true,
        countedBy: { select: { name: true } },
      },
    });
    return audit
      ? {
          ...audit,
          expectedAmount: Number(audit.expectedAmount),
          countedAmount: Number(audit.countedAmount),
          difference: Number(audit.difference),
        }
      : { found: false };
  }

  if (page.entityType === 'ShiftHandover') {
    if(!canReadReceptionHandover(user))throw new Error('No tienes permiso para consultar entregas de turno.');
    const handover = await prisma.shiftHandover.findFirst({
      where: { id: page.entityId, ...(user.isSystemAdmin?{}:{fromShift:{isDemo:false}}) },
      select: {
        id: true,
        status: true,
        issuedAt: true,
        receivedAt: true,
        snapshot: true,
        receiverBriefingReviewedAt:true,receiverCustodyReviewedAt:true,receiverFinalReviewAt:true,receiverUrgentAcknowledgedAt:true,
        issuedBy: { select: { name: true } },
        receivedBy: { select: { name: true } },
        fromShift: { select: { id: true, type: true, date: true, status: true } },
        toShift: { select: { id: true, type: true, date: true, status: true } },
        elements: {
          select: { id: true, declared: true, confirmed: true, missingReason: true, missingReportedById: true, missingApprovedAt: true, missingApprovalNote: true, updatedAt: true, elementType: { select: { name: true } } },
        },
        items: {
          select: { id: true, level: true, title: true, detail: true, order: true, section:true, refType:true, refId:true },
          orderBy: [{ level: 'asc' }, { order: 'asc' }],
        },
      },
    });
    return handover ? { ...await visibleHandover(user,handover), elements: handover.elements.map(element => ({ ...element, elementId: element.id, revision: element.updatedAt.toISOString() })) } : { found: false };
  }

  if (page.entityType === 'ChecklistRun') {
    const canReserved = user.isSystemAdmin || has(user, 'supervision.audit.reserved');
    const delivered = canReserved
      ? true
      : Boolean(
          await prisma.notification.findFirst({
            where: {
              userId: user.id,
              entity: 'ChecklistRun',
              entityId: page.entityId,
            },
            select: { id: true },
          }),
        );
    if (!delivered) throw new Error('No tienes permiso para consultar este resultado de auditoría.');
    const run = await prisma.checklistRun.findFirst({
      where: { id: page.entityId, deletedAt: null, finishedAt: { not: null } },
      select: {
        id: true,
        humanId: true,
        templateName: true,
        status: true,
        disclosure: true,
        resultSummary: true,
        severity: true,
        startedAt: true,
        finishedAt: true,
        runBy: { select: { name: true } },
        items: {
          select: {
            id: true,
            text: true,
            critical: true,
            result: true,
            observation: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    return run ?? { found: false };
  }

  return null;
}

function performanceRange(page: FrontiResolvedPageContext) {
  const now = new Date();
  const fallback = hotelWallDateTime(hotelDateKey(addHotelCalendarDays(now, -30)), 0);
  const parseKey = (value: string | undefined, endOfDay = false) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const start = hotelWallDateTime(value, 0);
    return endOfDay
      ? new Date(addHotelCalendarDays(start, 1).getTime() - 1)
      : start;
  };
  return {
    from: parseKey(page.filters.desde) ?? fallback,
    to: parseKey(page.filters.hasta, true) ?? now,
  };
}

async function supervisionSectionSnapshot(
  user: CurrentUser,
  page: FrontiResolvedPageContext,
): Promise<unknown> {
  if (page.sectionKey === 'salud') {
    requireAny(
      user,
      ['supervision.center.view'],
      'No tienes permiso para consultar Salud operativa.',
    );
    const period: OperationalHealthPeriod =
      page.filters.periodo === '7d' || page.filters.periodo === '30d'
        ? page.filters.periodo
        : 'today';
    return getOperationalHealth(operationalHealthRange(period));
  }

  if (page.sectionKey === 'rendimiento') {
    requireAny(
      user,
      ['supervision.performance.view'],
      'No tienes permiso para consultar Rendimiento operativo.',
    );
    const range = performanceRange(page);
    const selected = page.filters.usuario ?? '';
    const query = (page.filters.q ?? '').toLocaleLowerCase('es-CL');
    const rows = await getTeamPerformance(user, range);
    return {
      range,
      selectedUserId: selected || null,
      query: query || null,
      rows: rows
        .filter(
          (row) =>
            (!selected || row.user.id === selected) &&
            (!query ||
              [row.user.name, row.user.role.name, ...row.indicators.map((item) => item.label)]
                .join(' ')
                .toLocaleLowerCase('es-CL')
                .includes(query)),
        )
        .map((row) => ({
          user: row.user,
          context: row.context,
          indicators: row.indicators.map((indicator) => ({
            key: indicator.key,
            label: indicator.label,
            numerator: indicator.numerator,
            denominator: indicator.denominator,
            value: indicator.value,
            formula: indicator.formula,
            source: indicator.source,
            kind: indicator.kind,
          })),
          observations: row.observations.slice(0, 10),
        })),
      note:
        'Indicadores explicables sin nota global ni ranking. Conserva fórmula, base de casos y contexto.',
    };
  }

  if (page.sectionKey === 'informes') {
    requireAny(
      user,
      ['supervision.view'],
      'No tienes permiso para consultar Informes de Supervisión.',
    );
    const range = reportDateRange(page.filters.desde, page.filters.hasta);
    const requested = page.filters.reporte;
    const types: SupervisorReportType[] =
      requested === 'estado' || requested === 'gimnasio' || requested === 'multas'
        ? [requested]
        : ['estado', 'gimnasio', 'multas'];
    const reports = await Promise.all(types.map((type) => buildSupervisorReport(user, type, range)));
    return {
      range,
      reports: reports.map((report) => ({
        type: report.type,
        title: report.title,
        total: report.total,
        summary: report.summary,
        sampleLines: report.lines.slice(0, 15),
      })),
    };
  }

  if (page.sectionKey === 'auditorias') {
    requireAny(
      user,
      ['supervision.audit.reserved'],
      'No tienes permiso para consultar Auditorías reservadas.',
    );
    const recent = await prisma.checklistRun.findMany({
      where: { deletedAt: null, mode: 'AUDITORIA_SORPRESA' },
      select: {
        id: true,
        humanId: true,
        templateName: true,
        status: true,
        resultSummary: true,
        severity: true,
        disclosure: true,
        startedAt: true,
        finishedAt: true,
        runBy: { select: { name: true } },
        _count: { select: { items: true, findings: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return {
      supervision: await safeRead(user, 'consultar_supervision', {}),
      recentAudits: recent,
    };
  }

  requireAny(
    user,
    ['supervision.view', 'supervision.center.view'],
    'No tienes permiso para consultar Supervisión.',
  );
  return safeRead(user, 'consultar_supervision', {});
}

async function adminSnapshot(user: CurrentUser, page: FrontiResolvedPageContext) {
  if (page.sectionKey === 'housekeeping') {
    const board = await getHkWorkday(user,{ date:page.filters.fecha||undefined,departmentId:page.filters.area||undefined,view:page.filters.vista||undefined });
    return {
      pilot:false, scope:'Trabajo diario de Housekeeping, limitado al cargo, área y asignaciones del usuario.', date:board.date,
      counts:board.counts,
      requests:board.requests.slice(0,20).map(r=>({humanId:r.humanId,title:r.sourceEntry?.title??r.title,location:r.location,status:HK_WORK_LABELS[r.status]??r.status,responsible:r.assignedTo?.name??'Por asignar',estimatedMinutes:r.effortMinutes,requiresInspection:r.requiresInspection,dueAt:r.dueAt?formatDateTime(r.dueAt):null,blockReason:r.blockReason,result:r.resolution,inspectedBy:r.inspectedBy?.name??null,maintenance:r.maintenanceEntry?{humanId:r.maintenanceEntry.humanId,status:r.maintenanceEntry.status,result:r.maintenanceEntry.resolution,archived:!!r.maintenanceEntry.deletedAt}:null})),
      team:board.workload.map(p=>({name:p.name,available:p.available,tasks:p.tasks,estimatedMinutes:p.estimatedMinutes,scheduled:p.scheduled.map(s=>({code:s.code,start:s.startAt?formatDateTime(s.startAt):null,end:s.endAt?formatDateTime(s.endAt):null}))})),
      suggestions:board.suggestions.map(s=>({humanId:s.humanId,responsible:s.name,reason:s.reason})),
      guidance:'Las sugerencias de distribución usan disponibilidad declarada y carga estimada. No son asignaciones ni prueban asistencia. La confirmación se realiza en el módulo. Terminado puede requerir inspección de otra persona. Fronti no aprueba, cambia estados, modifica PMS ni consulta reservas privadas de llaves.',
    };
  }
  requireAny(
    user,
    ['system.configure', 'user.manage', 'role.manage', 'audit.view', 'shift.manage'],
    'No tienes permisos administrativos para consultar esta pantalla.',
  );

  switch (page.sectionKey) {
    case 'limpieza': {
      if (!user.isSystemAdmin) throw new Error('Sólo SysAdmin puede consultar la limpieza individual.');
      return { note: 'Limpieza individual con eliminación lógica, confirmación escrita y motivo obligatorio. Conserva auditoría y datos originales. Personas de turnos se retiran desde Historial de turnos. Fronti no elimina datos ni confirma estas acciones.' };
    }
    case 'mantenimiento': {
      if (!user.isSystemAdmin) throw new Error('Sólo el Administrador de sistema puede consultar este control.');
      const state = await getMaintenanceState();
      return { enabled: state.enabled, message: state.message, startedAt: state.startedAt,
        note: 'Control temporal de disponibilidad. Fronti sólo explica el estado; activar o desactivar exige la confirmación explícita del Administrador de sistema en esta pantalla. No se modifican permisos ni datos hoteleros.' };
    }
    case 'usuarios':
      return safeRead(user, 'consultar_usuarios', { includeInactive: true });
    case 'auditoria':
      return safeRead(user, 'consultar_auditoria', {
        limit: 30,
        entity: page.filters.entidad || null,
      });
    case 'turnos':
      return safeRead(user, 'consultar_turnos', {});
    case 'roles': {
      if (!has(user, 'role.manage') && !user.isSystemAdmin) {
        throw new Error('No tienes permiso para consultar roles y permisos.');
      }
      return {
        roles: await prisma.role.findMany({
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            level: true,
            operational: true,
            _count: { select: { users: true, permissions: true } },
            permissions: {
              select: {
                requiresApproval: true,
                permission: { select: { key: true, name: true, category: true } },
              },
              orderBy: { permission: { key: 'asc' } },
            },
          },
          orderBy: { level: 'desc' },
        }),
      };
    }
    case 'areas': {
      if (!has(user, 'system.configure') && !user.isSystemAdmin) {
        throw new Error('No tienes permiso para consultar áreas.');
      }
      return {
        areas: await prisma.department.findMany({
          select: {
            id: true,
            key: true,
            name: true,
            order: true,
            active: true,
            _count: { select: { entries: true, tasks: true, users: true } },
          },
          orderBy: { order: 'asc' },
        }),
      };
    }
    case 'correo': {
      if (!has(user, 'system.configure') && !user.isSystemAdmin) {
        throw new Error('No tienes permiso para consultar correo.');
      }
      const [mail, policy] = await Promise.all([
        getMailConfigView(),
        getNotificationEmailPolicy(),
      ]);
      return {
        mail: {
          source: mail.source,
          canSend: mail.canSend,
          envIsShadowed: mail.envIsShadowed,
          lastTestAt: mail.lastTestAt,
          lastTestOk: mail.lastTestOk,
          lastTestTo: mail.lastTestTo,
          lastTestDetail: mail.lastTestDetail,
          updatedAt: mail.updatedAt,
          updatedByName: mail.updatedByName,
        },
        notificationEmailPolicy: policy,
        note: 'No se exponen contraseñas, claves ni secretos SMTP.',
      };
    }
    case 'diagnostico': {
      if (!has(user, 'system.configure') && !user.isSystemAdmin) {
        throw new Error('No tienes permiso para consultar diagnóstico.');
      }
      const report = await getDiagnosticReport();
      return {
        duplicateAlerts: report.duplicateAlerts.slice(0, 20),
        unlinkedStayCount: report.unlinkedStayCount,
        reservationRoomMismatches: report.reservationRoomMismatches.slice(0, 20),
        duplicateActiveStays: report.duplicateActiveStays.slice(0, 20),
        runtimeErrors: report.runtimeErrors.slice(0, 20),
      };
    }
    case 'fronti': {
      if (!has(user, 'system.configure') && !user.isSystemAdmin) {
        throw new Error('No tienes permiso para consultar la configuración de Fronti.');
      }
      const config = await getFrontiConfig();
      return {
        enabled: config.enabled,
        displayName: config.displayName,
        provider: config.provider,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        memoryRetentionDays: config.memoryRetentionDays,
        shiftMemoryHours: config.shiftMemoryHours,
        modelHistoryLimit: config.modelHistoryLimit,
        sessionActivityMinutes: config.sessionActivityMinutes,
        tools: config.tools,
        note: 'Las credenciales de proveedores no forman parte de este contexto.',
      };
    }
    case 'parametros':
    case 'inicio':
      return safeRead(user, 'consultar_configuracion_operativa', {
        category: page.filters.categoria || null,
      });
    case 'eliminados':
      return {
        audit: await safeRead(user, 'consultar_auditoria', { limit: 25, entity: null }),
        note:
          'La papelera conserva trazabilidad. Fronti sólo lee contexto; no restaura ni elimina desde esta herramienta.',
      };
    case 'puesta-en-cero':
      return {
        destructiveArea: true,
        note:
          'Esta pantalla es administrativa y destructiva. Fronti puede explicar el alcance, pero nunca ejecuta una puesta en cero desde contexto.',
      };
    default:
      return null;
  }
}

export async function executeFrontiPageContextTool(
  user: CurrentUser,
  page: FrontiResolvedPageContext | null,
): Promise<unknown> {
  if (!page) {
    return {
      available: false,
      reason: 'No se recibió contexto de pantalla.',
    };
  }

  const base = {
    page: {
      pathname: page.pathname,
      moduleKey: page.moduleKey,
      moduleLabel: page.moduleLabel,
      sectionKey: page.sectionKey,
      sectionLabel: page.sectionLabel,
      filters: page.filters,
      entityType: page.entityType,
      entityId: page.entityId,
      label: page.label,
    },
  };

  if (isHkFocused(user)) {
    if(page.moduleKey === 'inicio') return { ...base, snapshot: await adminSnapshot(user,{...page,sectionKey:'housekeeping'}) };
    if(page.sectionKey !== 'housekeeping' && !['coordinacion','cambios-turno','equipo','notificaciones','perfil','fronti-procedimientos'].includes(page.moduleKey)) throw new Error('Tu acceso operativo está limitado a Housekeeping y a tus datos personales.');
  }
  const detail = await detailSnapshot(user, page);
  if (detail) return { ...base, snapshot: detail };

  switch (page.moduleKey) {
    case 'fronti-procedimientos': {
      const rows = await prisma.frontiExecution.findMany({ where: { userId: user.id }, select: { id:true,status:true,createdAt:true,expiresAt:true,steps:{select:{action:true,status:true}} }, orderBy:{createdAt:'desc'},take:26 });
      return {...base,snapshot:{scope:'Sólo tus procedimientos',complete:rows.length<=25,rows:rows.slice(0,25),note:'El historial no autoriza nuevas acciones.'}};
    }
    case 'automatizaciones': {
      if (!user.permissions.includes('system.configure')) throw new Error('No tienes permiso para consultar políticas.');
      const rows=await prisma.operationalAutomation.findMany({where:{ownerId:user.id},select:{id:true,name:true,kind:true,enabled:true,version:true,expiresAt:true,revokedAt:true},orderBy:{createdAt:'desc'},take:51});
      return {...base,snapshot:{scope:'Políticas propias',complete:rows.length<=50,rows:rows.slice(0,50),note:'Simula antes de habilitar. Los horarios no acreditan presencia.'}};
    }
    case 'cambios-turno': return {...base,snapshot:await getChangesSinceLastShift(user,Number(page.filters.pagina)||1),guidance:'Corte desde fin real de participación; no inventar asistencia ni atribuir una causa al cambio. Cada registro conserva fuente y responsable.'};
    case 'coordinacion': {
      if(page.sectionKey==='areas')return {...base,snapshot:await listAreaAttentions(user,{departmentId:page.filters.area,id:page.filters.atencion,page:Number(page.filters.pagina)||1}),guidance:'Conocimiento, publicación, ejecución y validación son eventos distintos. Esta consulta no habilita ninguna distribución ni decisión.'};
      const coordinationViews:CoordinationView[]=['all','reception','unassigned','unreceived','blocked','clarification','carryover'];
      const view=coordinationViews.includes(page.filters.vista as CoordinationView)?page.filters.vista as CoordinationView:'all';
      const board=await getCoordinationBoard(user,{departmentId:page.filters.area,mine:page.filters.mios==='1',history:page.filters.historial==='1',page:Number(page.filters.pagina)||1,view});
      return {...base,snapshot:{...board,metrics:coordinationMetrics(board.rows),metricsScope:'página visible',note:'Lectura del mismo alcance que Coordinación. Recibir no resuelve ni acredita asistencia.'}};
    }
    case 'inicio':
      return { ...base, snapshot: await getDashboardData(user) };
    case 'jornada':
      return { ...base, snapshot: await getManagementWorkday(user), guidance: 'La jornada de jefatura no abre Caja ni turno de Recepción y no acredita asistencia. Sólo registra el ejercicio de funciones dentro del alcance vigente del usuario.' };
    case 'buscar':
    case 'historial':
      return { ...base, snapshot: await bookSnapshot(page,user) };
    case 'novedades':
      return {
        ...base,
        snapshot: await safeRead(user, 'consultar_novedades', {
          limit: 30,
          onlyOpen: page.sectionKey !== 'historial',
        }),
      };
    case 'custodia': {
      requireAny(user, ['custody.view','custody.manage'], 'No tienes permiso para consultar objetos olvidados.');
      const items=await listLostFound(user,{status:page.filters.estado,q:page.filters.q});
      return { ...base, snapshot: { items: items.slice(0,50).map(i=>({ref:'#'+i.humanId,item:i.item,status:i.status,foundLocation:i.foundLocation,custodyLocation:i.custodyLocation,custodian:i.custodian?.name??null,foundAt:i.foundAt,closedAt:i.closedAt})) } };
    }
        case 'novedades-habitacion': {
      if (page.sectionKey === 'redireccion') {
        return {
          ...base,
          snapshot: {
            legacy: true,
            redirectTo: '/novedades/habitacion',
            note: 'Central de Reservas fue retirada. AROH organiza contexto operativo por habitación; FNSrooms continúa como PMS.',
          },
        };
      }
      const overview = await getRoomMonitorOverview(user);
      const roomNumber = page.filters.habitacion ?? '';
      const selected = roomNumber
        ? await getRoomMonitorDetail(roomNumber,user).catch(() => null)
        : null;
      return {
        ...base,
        snapshot: {
          summary: overview.summary,
          rooms: overview.rooms.map((room) => ({
            number: room.number,
            floor: room.floor,
            attention: room.attention,
            openEntries: room.openEntries,
            criticalIncidents: room.criticalIncidents,
            openTasks: room.openTasks,
            overdueTasks: room.overdueTasks,
            activeAlarms: room.activeAlarms,
            openGuarantees: room.openGuarantees,
            lastActivityAt: room.lastActivityAt,
          })),
          selectedRoom: selected,
          note: 'La habitación es contexto operativo. Este monitor no representa ocupación, check-in, check-out ni estado PMS.',
        },
      };
    }
    case 'tareas':
      return {
        ...base,
        snapshot: await safeRead(user, 'consultar_tareas', {
          scope: page.filters.scope === 'mias' ? 'mias' : 'abiertas',
          limit: 30,
        }),
      };
    case 'seguimientos':
      return {
        ...base,
        snapshot: await safeRead(user, 'consultar_seguimientos', {
          limit: 30,
          onlyOpen: page.filters.estado !== 'cerrados',
        }),
      };
    case 'senales-internas': {
      requireAny(
        user,
        ['alert.manage', 'cash.approve', 'shift.manage', 'supervision.view'],
        'No tienes permiso para consultar señales internas.',
      );
      const rows = await prisma.alert.findMany({
        where: { deletedAt: null, status: { not: 'RESUELTA' }, AND:[alertReadWhere(user)] },
        select: {
          id: true,
          humanId: true,
          title: true,
          message: true,
          status: true,
          level: true,
          dedupeKey: true,
          entryId: true,
          handoverId: true,
          createdAt: true,
        },
        orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
        take: 30,
      });
      return {
        ...base,
        snapshot: {
          semantics:
            'Señales internas de compatibilidad para autorizaciones y validaciones. No son Alertas programables del usuario.',
          items: rows,
        },
      };
    }
    case 'notificaciones':
      return {
        ...base,
        snapshot: await getNotificationFeedForUser(user.id, 40),
      };
    case 'reservas':
    case 'habitaciones':
      return {
        ...base,
        snapshot: {
          note:
            'Esta ruta no contiene una entidad concreta en la URL. Usa la búsqueda/filtros visibles o abre un detalle para obtener contexto de objeto.',
        },
      };
    case 'caja': {
      requireAny(user, ['cash.view'], 'No tienes permiso para consultar Caja.');
      const state = await getLiveCashState(15);
      const serviceSection =
        page.sectionKey === 'gimnasio' || page.pathname === '/caja/gimnasio'
          ? 'GIMNASIO'
          : page.sectionKey === 'estacionamiento'
            ? 'ESTACIONAMIENTO'
            : null;
      const services =
        serviceSection === 'GIMNASIO'
          ? await listGymPasses({ limit: 60 })
          : serviceSection === 'ESTACIONAMIENTO'
            ? await listParkingPasses({ limit: 60 })
            : null;
      return {
        ...base,
        snapshot: {
          currencies: state.currencies,
          movements: state.movements.slice(0, 15),
          cashGuarantees: state.cashGuarantees.slice(0, 30),
          audits: state.audits.slice(0, 12),
          service: services
            ? {
                type: serviceSection,
                total: services.total,
                emitted: services.emitted,
                voided: services.voided,
                rows: services.rows.slice(0, 30),
              }
            : null,
        },
      };
    }
    case 'turno':
      return {
        ...base,
        snapshot: await safeRead(user, 'consultar_turnos', {}),
      };
    case 'llaves': {
      requireAny(user, ['key.assign', 'key.inventory', 'key.stock'], 'No tienes permiso para consultar llaves.');
      if (page.sectionKey === 'personal') {
        const [loans,areas] = await Promise.all([listStaffLoans(user),prisma.keyArea.findMany({where:{active:true},select:{name:true,keys:{select:{code:true,status:true}}}})]);
        return {...base,snapshot:{areas,deliveries:loans.map(l=>({humanId:l.humanId,department:l.departmentName,collaborator:l.collaboratorName,authorizedBy:l.authorizedByName,createdBy:l.createdByName,items:l.items.filter(i=>!i.returnedAt).map(i=>({keyCode:i.keyCode,destination:i.destinationName}))})),privateStock:'La reserva privada se consulta exclusivamente en el panel de su propietario.'}};
      }
      const inventory = await getKeyInventory();
      const floor = page.filters.piso;
      return {
        ...base,
        snapshot: {
          floor: floor || 'todos',
          stock: inventory.stock,
          keys: inventory.keys
            .filter((key) => {
              if (!floor || floor === 'todos') return true;
              return key.roomNumber?.startsWith(floor) ?? false;
            })
            .slice(0, 120),
        },
      };
    }
    case 'avisos': {
      const alarms = await listMyOperationalAlarms(user.id, 60);
      return {
        ...base,
        snapshot: {
          active: alarms
            .filter((alarm) => alarm.status === OperationalAlarmStatus.ACTIVA)
            .map((alarm) => ({
              id: alarm.id,
              kind: alarm.kind,
              scope: alarm.scope,
              title: alarm.title,
              note: alarm.note,
              dueAt: alarm.dueAt,
              sourceEntity: alarm.sourceEntity,
              sourceId: alarm.sourceId,
              sourceLink: alarm.sourceLink,
              createdBy: alarm.createdBy.name,
              recipients: alarm.recipients.map((recipient) => ({
                name: recipient.user.name,
                acknowledgedAt: recipient.acknowledgedAt,
                snoozedUntil: recipient.snoozedUntil,
              })),
            })),
          history: alarms
            .filter((alarm) => alarm.status !== OperationalAlarmStatus.ACTIVA)
            .slice(0, 20)
            .map((alarm) => ({
              id: alarm.id,
              kind: alarm.kind,
              title: alarm.title,
              dueAt: alarm.dueAt,
              status: alarm.status,
            })),
        },
      };
    }
    case 'gerencia': {
      requireAny(user, ['management.dashboard.view'], 'No tienes permiso para consultar Gerencia.');
      const days = Number(page.filters.dias ?? 30);
      const snapshot = page.sectionKey === 'evidencia'
        ? page.filters.tipo === 'keys-risk'
          ? await getManagementKeyEvidence(user, { floor: page.filters.piso ? Number(page.filters.piso) : undefined, countId: page.filters.conteo })
          : await getManagementEvidence(user, { kind: page.filters.tipo ?? '', days, page: Number(page.filters.pagina ?? 1) })
        : await getManagementCockpit(user, days);
      return { ...base, snapshot, guidance: 'Hechos: reproducir moneda, signo, unidad, período y denominador exactos; enlazar su evidencia. El importe absoluto agregado no es una diferencia neta ni el signo de un arqueo. Hipótesis: no se acredita causa por una cifra; no atribuir ajustes ni responsabilidades sin un registro explícito. Recomendación: separar la acción propuesta del hecho. Esta lectura no ejecuta acciones ni genera inferencias automáticas.' };
    }
    case 'indicadores': {
      requireAny(user, ['metrics.view'], 'No tienes permiso para consultar Indicadores.');
      const requested = Number(page.filters.dias ?? 30);
      const days = [7, 30, 90].includes(requested) ? requested : 30;
      return { ...base, snapshot: await getMetrics(defaultRange(days)) };
    }
    case 'supervision':
      if(page.sectionKey==='documentos-locales'){
        requireAny(user,['supervision.center.view'],'No tienes acceso a Supervisión.');
        requireAny(user,['supervision.audit.create'],'No tienes permiso para preparar esta revisión.');
        return {...base,snapshot:{localOnly:true,originalAvailableOnServer:false,sharedPersistence:false,documentInferenceEnabled:false,scannedVisionEnabled:false},guidance:'El original y los borradores existen sólo en el navegador. No has recibido ni analizado ese documento. No inventes datos ni una aprobación persistida; la exportación local es una propuesta de revisión.'};
      }
      return {
        ...base,
        snapshot: await supervisionSectionSnapshot(user, page),
      };
    case 'auditorias':
      return { ...base, snapshot: null };
    case 'administracion':
      return { ...base, snapshot: await adminSnapshot(user, page) };
    case 'equipo':
      return { ...base, snapshot: { ...await readScheduleContext(user, { area: page.filters.area, planId: page.filters.malla, section: page.sectionKey }), section: page.sectionLabel } };
    case 'perfil':
      return {
        ...base,
        snapshot: {
          id: user.id,
          name: user.name,
          roleKey: user.roleKey,
          roleName: user.roleName,
          departmentId: user.departmentId,
          frontiAccessEnabled: user.frontiAccessEnabled || user.isSystemAdmin,
        },
      };
    default:
      return {
        ...base,
        snapshot: {
          available: false,
          reason: 'La pantalla todavía no tiene un lector especializado, pero su ruta, sección, filtros y entidad siguen disponibles como contexto.',
        },
      };
  }
}
