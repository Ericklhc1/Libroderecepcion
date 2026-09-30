import 'server-only';

import { GuaranteeStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addHotelCalendarDays, hotelDayStart } from '@/domain/time';
import { getMetrics, type MetricsRange } from '@/server/services/metrics';
import { getOperationalHealth } from '@/server/services/operational-health';
import { getSupervisionData, type SupervisionBlock } from '@/server/services/supervision';
import { getReservationCenterSnapshot } from '@/server/services/reservation-center';

export type ManagementPeriodDays = 7 | 30 | 90;

export function managementPeriodDays(value: number): ManagementPeriodDays {
  return value === 7 || value === 90 ? value : 30;
}

export function managementRange(days: ManagementPeriodDays, now = new Date()): MetricsRange {
  return {
    from: hotelDayStart(addHotelCalendarDays(now, -(days - 1))),
    to: now,
  };
}

function previousRange(current: MetricsRange, days: ManagementPeriodDays): MetricsRange {
  return {
    from: hotelDayStart(addHotelCalendarDays(current.from, -days)),
    to: new Date(current.from.getTime() - 1),
  };
}

function object(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function section(value: Prisma.JsonValue, key: string): Record<string, Prisma.JsonValue> {
  return object(object(value)[key] ?? null);
}

function numberValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function blockByKey(blocks: SupervisionBlock[], key: string): SupervisionBlock | undefined {
  return blocks.find((block) => block.key === key);
}

function blockCount(blocks: SupervisionBlock[], key: string): number {
  return blockByKey(blocks, key)?.rows.length ?? 0;
}

function percentagePointDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

function numberDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

type PmsRow = {
  id: string;
  businessDate: Date;
  reportKinds: string[];
  metrics: Prisma.JsonValue;
  warnings: string[];
  updatedAt: Date;
};

function pmsSnapshot(row: PmsRow | undefined) {
  if (!row) return null;
  const revenue = section(row.metrics, 'revenue');
  const sales = section(row.metrics, 'salesChannels');
  const production = section(row.metrics, 'roomProduction');
  const payments = section(row.metrics, 'payments');
  const activity = section(row.metrics, 'auditActivity');

  return {
    businessDate: row.businessDate,
    updatedAt: row.updatedAt,
    reportKinds: row.reportKinds,
    warnings: row.warnings.length,
    occupancyPct: numberValue(revenue.occupancyPct),
    activityOccupancyPct: numberValue(activity.occupancyPct),
    revenueClp: numberValue(revenue.revenueClp),
    adrClp: numberValue(revenue.adrClp),
    revparClp: numberValue(revenue.revparClp),
    salesGrossClp: numberValue(sales.grossClp),
    salesNetClp: numberValue(sales.netClp),
    commissionsClp: numberValue(sales.commissionsClp),
    commissionPct: numberValue(sales.commissionPct),
    occupiedRoomsWithCost: numberValue(production.occupiedRoomsWithCost),
    productionClp: numberValue(production.totalClp),
    paymentsClp: numberValue(payments.clpAmount),
  };
}

function distinctAuditDays(rows: PmsRow[]): PmsRow[] {
  const seen = new Set<string>();
  const result: PmsRow[] = [];
  for (const row of rows) {
    const key = row.businessDate.toISOString().slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

type DecisionPriority = 'CRITICA' | 'ALTA' | 'MEDIA';

const DECISION_SPECS: Array<{
  key: string;
  priority: DecisionPriority;
  title: string;
  why: string;
}> = [
  {
    key: 'garantias-integridad',
    priority: 'CRITICA',
    title: 'Revisar integridad financiera de garantías',
    why: 'Hay custodias de efectivo cuyo estado operativo no cuadra con su salida financiera.',
  },
  {
    key: 'caja',
    priority: 'CRITICA',
    title: 'Resolver diferencias vigentes de Caja',
    why: 'El último arqueo de al menos una divisa mantiene una diferencia abierta.',
  },
  {
    key: 'incidencias',
    priority: 'CRITICA',
    title: 'Intervenir incidencias críticas abiertas',
    why: 'Existen incidencias de gravedad o prioridad crítica aún sin cierre.',
  },
  {
    key: 'garantias',
    priority: 'ALTA',
    title: 'Resolver garantías pendientes o vencidas',
    why: 'Hay custodias que requieren devolución, cobro, aplicación o regularización.',
  },
  {
    key: 'cierres',
    priority: 'ALTA',
    title: 'Normalizar turnos pendientes de cierre',
    why: 'La continuidad del hotel queda debilitada cuando un turno no alcanza su estado final.',
  },
  {
    key: 'entregas',
    priority: 'ALTA',
    title: 'Destrabar entregas de turno sin recibir',
    why: 'El turno saliente entregó información que aún no fue confirmada por el siguiente.',
  },
  {
    key: 'llaves',
    priority: 'ALTA',
    title: 'Resolver faltantes del inventario de llaves',
    why: 'El último conteo oficial de uno o más pisos reporta faltantes físicos.',
  },
  {
    key: 'tareas',
    priority: 'MEDIA',
    title: 'Recuperar tareas vencidas',
    why: 'Trabajo asignado superó su fecha límite sin completarse.',
  },
  {
    key: 'seguimientos',
    priority: 'MEDIA',
    title: 'Recuperar compromisos de seguimiento vencidos',
    why: 'Hay compromisos de continuidad cuya fecha programada ya pasó.',
  },
  {
    key: 'sin-responsable',
    priority: 'MEDIA',
    title: 'Asignar asuntos abiertos sin responsable',
    why: 'Hay trabajo operativo abierto que todavía no tiene dueño explícito.',
  },
];

function decisionQueue(blocks: SupervisionBlock[]) {
  return DECISION_SPECS.flatMap((spec) => {
    const block = blockByKey(blocks, spec.key);
    if (!block || block.rows.length === 0) return [];
    return [{
      key: spec.key,
      priority: spec.priority,
      title: spec.title,
      why: spec.why,
      count: block.rows.length,
      href: block.rows[0]?.href ?? '/supervision',
      evidence: block.rows.slice(0, 3).map((row) => ({
        ref: row.ref,
        title: row.title,
        detail: row.detail,
        meta: row.meta,
        href: row.href,
      })),
    }];
  });
}

function reservationNeedsAttention(reservation: {
  requiresAction: boolean;
  guaranteeStatus: GuaranteeStatus;
  balanceDue: { toString(): string } | null;
}) {
  return (
    reservation.requiresAction ||
    reservation.guaranteeStatus === GuaranteeStatus.PENDIENTE ||
    reservation.guaranteeStatus === GuaranteeStatus.RECHAZADA ||
    Number(reservation.balanceDue ?? 0) > 0
  );
}

/**
 * Centro de Decisión Gerencial.
 *
 * No inventa un score global. Devuelve indicadores explicables, excepciones vivas
 * y evidencia navegable a los objetos de origen. La portada es lectura; la acción
 * sigue ocurriendo en Tareas, Seguimientos, Supervisión, Caja, Llaves o Reservas.
 */
export async function getManagementDashboard(
  daysInput: number,
  now = new Date(),
) {
  const days = managementPeriodDays(daysInput);
  const currentRange = managementRange(days, now);
  const priorRange = previousRange(currentRange, days);

  const [
    current,
    previous,
    currentHealth,
    supervision,
    reservations,
    auditRows,
  ] = await Promise.all([
    getMetrics(currentRange),
    getMetrics(priorRange),
    getOperationalHealth(currentRange),
    getSupervisionData({ exhaustive: true }),
    getReservationCenterSnapshot(now),
    prisma.supervisionAuditImport.findMany({
      select: {
        id: true,
        businessDate: true,
        reportKinds: true,
        metrics: true,
        warnings: true,
        updatedAt: true,
      },
      orderBy: [{ businessDate: 'desc' }, { updatedAt: 'desc' }],
      take: 8,
    }),
  ]);

  const auditDays = distinctAuditDays(auditRows);
  const pmsCurrent = pmsSnapshot(auditDays[0]);
  const pmsPrevious = pmsSnapshot(auditDays[1]);

  const decisions = decisionQueue(supervision.blocks);
  const next24Risk = reservations.reservations.filter(
    (reservation) =>
      reservation.checkIn &&
      reservation.checkIn >= reservations.now &&
      reservation.checkIn <= reservations.horizons.in24Hours &&
      reservationNeedsAttention(reservation),
  );

  if (next24Risk.length > 0) {
    decisions.push({
      key: 'reservas-24h',
      priority: 'ALTA',
      title: 'Resolver llegadas de las próximas 24 h con riesgo',
      why: 'Hay llegadas próximas con acción pendiente, garantía no resuelta o saldo por cobrar.',
      count: next24Risk.length,
      href: '/central-reservas?vista=24h',
      evidence: next24Risk.slice(0, 3).map((reservation) => ({
        ref: reservation.code,
        title: reservation.guest?.fullName ?? reservation.code,
        detail: reservation.actionNote,
        meta: [
          reservation.roomNumber ? `Hab. ${reservation.roomNumber}` : null,
          reservation.guaranteeStatus !== GuaranteeStatus.NO_REQUERIDA
            ? `Garantía: ${reservation.guaranteeStatus}`
            : null,
          Number(reservation.balanceDue ?? 0) > 0
            ? `Saldo: ${Number(reservation.balanceDue).toLocaleString('es-CL')} CLP`
            : null,
        ].filter(Boolean).join(' · ') || null,
        href: `/central-reservas?q=${encodeURIComponent(reservation.code)}`,
      })),
    });
  }

  const priorityOrder: Record<DecisionPriority, number> = {
    CRITICA: 0,
    ALTA: 1,
    MEDIA: 2,
  };
  decisions.sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      b.count - a.count,
  );

  const fragility = {
    criticalIncidents: blockCount(supervision.blocks, 'incidencias'),
    cashDifferences: blockCount(supervision.blocks, 'caja'),
    guaranteeIssues:
      blockCount(supervision.blocks, 'garantias') +
      blockCount(supervision.blocks, 'garantias-integridad'),
    keyShortageFloors: blockCount(supervision.blocks, 'llaves'),
    overdueTasks: blockCount(supervision.blocks, 'tareas'),
    overdueFollowUps: blockCount(supervision.blocks, 'seguimientos'),
    unassigned: blockCount(supervision.blocks, 'sin-responsable'),
    unreceivedHandovers: blockCount(supervision.blocks, 'entregas'),
    pendingShiftClosures: blockCount(supervision.blocks, 'cierres'),
    reservationsNext24AtRisk: next24Risk.length,
  };

  return {
    generatedAt: now,
    periodDays: days,
    range: currentRange,
    previousRange: priorRange,
    pulses: {
      continuity: {
        handoverComplianceRate: current.handovers.complianceRate,
        handoverDeltaPp: percentagePointDelta(
          current.handovers.complianceRate,
          previous.handovers.complianceRate,
        ),
        shiftClosureRate: current.shifts.closureRate,
        shiftClosureDeltaPp: percentagePointDelta(
          current.shifts.closureRate,
          previous.shifts.closureRate,
        ),
        pendingHandovers: fragility.unreceivedHandovers,
        pendingClosures: fragility.pendingShiftClosures,
      },
      execution: {
        taskOnTimeRate: current.tasks.onTimeRate,
        taskOnTimeDeltaPp: percentagePointDelta(
          current.tasks.onTimeRate,
          previous.tasks.onTimeRate,
        ),
        completedLate: current.tasks.completedLate,
        overdueNow: current.tasks.overdue,
        openNow: current.tasks.open,
      },
      risk: {
        criticalIncidents: fragility.criticalIncidents,
        avgIncidentResolutionHours: current.incidents.avgResolutionHours,
        resolutionDeltaHours: numberDelta(
          current.incidents.avgResolutionHours,
          previous.incidents.avgResolutionHours,
        ),
        overdueFollowUps: fragility.overdueFollowUps,
        unassigned: fragility.unassigned,
      },
      control: {
        cashDifferences: fragility.cashDifferences,
        guaranteeIssues: fragility.guaranteeIssues,
        keyShortageFloors: fragility.keyShortageFloors,
        operationalFailures: currentHealth.failures,
        actionFailures: currentHealth.actions.failed,
        actionTimeouts: currentHealth.actions.timeouts,
      },
    },
    friction: {
      shiftCloseP90Ms: currentHealth.shifts.p90CloseMs,
      handoverReceiveP90Ms: currentHealth.handovers.p90ReceiveMs,
      cashCountP90Ms: currentHealth.cash.p90CountMs,
      closeIncomplete: currentHealth.shifts.closeIncomplete,
      cashCountsWithDifferences: currentHealth.cash.withDifferences,
      operationalFailures: currentHealth.failures,
    },
    trends: {
      taskOnTime: {
        current: current.tasks.onTimeRate,
        previous: previous.tasks.onTimeRate,
        unit: '%',
        better: 'higher' as const,
      },
      handoverCompliance: {
        current: current.handovers.complianceRate,
        previous: previous.handovers.complianceRate,
        unit: '%',
        better: 'higher' as const,
      },
      shiftClosure: {
        current: current.shifts.closureRate,
        previous: previous.shifts.closureRate,
        unit: '%',
        better: 'higher' as const,
      },
      incidentResolution: {
        current: current.incidents.avgResolutionHours,
        previous: previous.incidents.avgResolutionHours,
        unit: 'h',
        better: 'lower' as const,
      },
    },
    decisions: decisions.slice(0, 5),
    fragility,
    incidentsByDepartment: current.incidents.byDepartment.slice(0, 8),
    reservations: {
      next24AtRisk: next24Risk.length,
      next24Total: reservations.reservations.filter(
        (reservation) =>
          reservation.checkIn &&
          reservation.checkIn >= reservations.now &&
          reservation.checkIn <= reservations.horizons.in24Hours,
      ).length,
    },
    pms: {
      current: pmsCurrent,
      previous: pmsPrevious,
      note: pmsCurrent
        ? 'Datos leídos del último informe PMS importado. No se estiman métricas ausentes.'
        : 'Sin una fuente PMS confiable cargada para esta vista.',
    },
  };
}
