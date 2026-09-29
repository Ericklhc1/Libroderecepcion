import 'server-only';

import { GuaranteeStatus, OperationalAlarmStatus, ReservationStatus } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { getDashboardData } from '@/server/services/dashboard';
import { getEntry } from '@/server/services/entries';
import { getTask } from '@/server/services/tasks';
import { getBookItems } from '@/server/services/book';
import { getReservationCenterSnapshot } from '@/server/services/reservation-center';
import {
  getReservationOperationalContext,
  getReservationOperationalContextByCode,
  reservationModuleSignals,
} from '@/server/services/reservation-context';
import { getRoomDetail } from '@/server/services/rooms';
import { getLiveCashState } from '@/server/services/live-cash';
import { getKeyInventory } from '@/server/services/keys';
import { listMyOperationalAlarms } from '@/server/services/operational-alarms';
import { listGymPasses, listParkingPasses } from '@/server/services/gym-pass';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { getMetrics, defaultRange } from '@/server/services/metrics';
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

function reservationNeedsAttention(reservation: {
  requiresAction: boolean;
  guaranteeStatus: GuaranteeStatus;
  balanceDue: { toString(): string } | null;
}): boolean {
  return (
    reservation.requiresAction ||
    reservation.guaranteeStatus === GuaranteeStatus.PENDIENTE ||
    reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA ||
    Number(reservation.balanceDue ?? 0) > 0
  );
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

async function bookSnapshot(page: FrontiResolvedPageContext) {
  const result = await getBookItems({
    q: page.filters.q || undefined,
    onlyOpen: page.moduleKey !== 'historial',
    page: 1,
    pageSize: 30,
  });
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

async function reservationCenterSnapshot(
  user: CurrentUser,
  page: FrontiResolvedPageContext,
) {
  requireAny(
    user,
    ['reservation.center.view'],
    'No tienes permiso para consultar la Central de Reservas.',
  );
  const snapshot = await getReservationCenterSnapshot();
  const view = page.filters.vista ?? '';
  const q = (page.filters.q ?? '').toLocaleLowerCase('es-CL');

  const rows = snapshot.reservations.filter((reservation) => {
    const text = [
      reservation.code,
      reservation.guest?.fullName,
      reservation.roomNumber,
      reservation.channel,
      reservation.actionNote,
      reservation.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('es-CL');
    if (q && !text.includes(q)) return false;
    if (view === 'accion' && !reservationNeedsAttention(reservation)) return false;
    if (
      view === '24h' &&
      !(
        reservation.checkIn &&
        reservation.checkIn >= snapshot.now &&
        reservation.checkIn <= snapshot.horizons.in24Hours
      )
    ) return false;
    if (
      view === '72h' &&
      !(
        reservation.checkIn &&
        reservation.checkIn >= snapshot.now &&
        reservation.checkIn <= snapshot.horizons.in72Hours
      )
    ) return false;
    if (view === 'recientes' && reservation.updatedAt < snapshot.horizons.oneDayAgo) return false;
    return true;
  });

  return {
    generatedAt: snapshot.now,
    view: view || 'bandeja',
    query: q || null,
    counts: {
      visible: rows.length,
      attention: snapshot.reservations.filter(reservationNeedsAttention).length,
      next24: snapshot.reservations.filter(
        (reservation) =>
          reservation.checkIn &&
          reservation.checkIn >= snapshot.now &&
          reservation.checkIn <= snapshot.horizons.in24Hours &&
          [ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA].includes(reservation.status),
      ).length,
      next72: snapshot.reservations.filter(
        (reservation) =>
          reservation.checkIn &&
          reservation.checkIn >= snapshot.now &&
          reservation.checkIn <= snapshot.horizons.in72Hours &&
          [ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA].includes(reservation.status),
      ).length,
    },
    reservations: rows.slice(0, 30).map((reservation) => ({
      id: reservation.id,
      code: reservation.code,
      guest: reservation.guest?.fullName ?? null,
      vip: reservation.guest?.vip ?? false,
      roomNumber: reservation.roomNumber,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      status: reservation.status,
      guaranteeStatus: reservation.guaranteeStatus,
      balanceDue: reservation.balanceDue ? Number(reservation.balanceDue) : null,
      requiresAction: reservation.requiresAction,
      actionNote: reservation.actionNote,
      updatedAt: reservation.updatedAt,
    })),
    related: {
      tasks: snapshot.tasks.slice(0, 20),
      alerts: snapshot.alerts.slice(0, 20),
      followUps: snapshot.followUps.slice(0, 20),
    },
  };
}

async function detailSnapshot(
  user: CurrentUser,
  page: FrontiResolvedPageContext,
): Promise<unknown> {
  if (!page.entityType || !page.entityId) return null;

  if (page.entityType === 'OperationalEntry') {
    const entry = await getEntry(page.entityId).catch(() => null);
    if (!entry) return { found: false };
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
      room: entry.room?.number ?? null,
      owner: entry.owner?.name ?? null,
      department: entry.department?.name ?? null,
      requiresFollowUp: entry.requiresFollowUp,
      resolution: entry.resolution,
      rootCause: entry.rootCause,
    };
  }

  if (page.entityType === 'Task') {
    const task = await getTask(page.entityId).catch(() => null);
    if (!task) return { found: false };
    return {
      found: true,
      id: task.id,
      ref: `#${task.humanId}`,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      assignee: task.assignee?.name ?? null,
      department: task.department?.name ?? null,
      room: task.room?.number ?? null,
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
    requireAny(
      user,
      ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'],
      'No tienes permiso para consultar entregas de turno.',
    );
    const handover = await prisma.shiftHandover.findUnique({
      where: { id: page.entityId },
      select: {
        id: true,
        status: true,
        issuedAt: true,
        receivedAt: true,
        issuedBy: { select: { name: true } },
        receivedBy: { select: { name: true } },
        fromShift: { select: { id: true, type: true, date: true, status: true } },
        toShift: { select: { id: true, type: true, date: true, status: true } },
        items: {
          select: { id: true, level: true, text: true, order: true },
          orderBy: [{ level: 'asc' }, { order: 'asc' }],
        },
      },
    });
    return handover ?? { found: false };
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
    const reports = await Promise.all(types.map((type) => buildSupervisorReport(type, range)));
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
  requireAny(
    user,
    ['system.configure', 'user.manage', 'role.manage', 'audit.view', 'shift.manage'],
    'No tienes permisos administrativos para consultar esta pantalla.',
  );

  switch (page.sectionKey) {
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

  const detail = await detailSnapshot(user, page);
  if (detail) return { ...base, snapshot: detail };

  switch (page.moduleKey) {
    case 'inicio':
      return { ...base, snapshot: await getDashboardData(user) };
    case 'buscar':
    case 'historial':
      return { ...base, snapshot: await bookSnapshot(page) };
    case 'novedades':
      return {
        ...base,
        snapshot: await safeRead(user, 'consultar_novedades', {
          limit: 30,
          onlyOpen: page.sectionKey !== 'historial',
        }),
      };
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
    case 'alertas':
      return {
        ...base,
        snapshot: await safeRead(user, 'consultar_alertas', { limit: 30 }),
      };
    case 'notificaciones':
      return {
        ...base,
        snapshot: await getNotificationFeedForUser(user.id, 40),
      };
    case 'central-reservas':
      return { ...base, snapshot: await reservationCenterSnapshot(user, page) };
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
    case 'indicadores': {
      requireAny(user, ['metrics.view'], 'No tienes permiso para consultar Indicadores.');
      const requested = Number(page.filters.dias ?? 30);
      const days = [7, 30, 90].includes(requested) ? requested : 30;
      return { ...base, snapshot: await getMetrics(defaultRange(days)) };
    }
    case 'supervision':
      return {
        ...base,
        snapshot: await supervisionSectionSnapshot(user, page),
      };
    case 'auditorias':
      return { ...base, snapshot: null };
    case 'administracion':
      return { ...base, snapshot: await adminSnapshot(user, page) };
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
