import 'server-only';
import {
  AuditAction,
  SupervisionShiftStatus,
  SupervisionVisibility,
  TaskStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate } from '@/lib/format';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { TASK_OPEN_STATUSES } from '@/domain/labels';
import { createFollowUp } from '@/server/services/followups';
import { auditOperationalPendingCount } from '@/domain/supervision-audit-review';
import { addCalendarDateDays, calendarDateKey, hotelCalendarDate } from '@/domain/time';
import {
  OPTIONAL_SUPERVISION_OPENING_REPORTS,
  REQUIRED_SUPERVISION_OPENING_REPORTS,
  SUPERVISION_REPORT_LABELS,
} from '@/domain/supervision-opening';
import { getLiveCashState } from '@/server/services/live-cash';
import { listOpenGuarantees } from '@/server/services/guarantees';
import { listRecentPhysicalKeyCounts } from '@/server/services/key-inventory';
import { getSupervisionData } from '@/server/services/supervision';

const OPEN_SUPERVISION_STATUSES = [
  SupervisionShiftStatus.PREPARACION,
  SupervisionShiftStatus.ACTIVO,
  SupervisionShiftStatus.ENTREGADO,
] as const;

function assertSupervisor(user: CurrentUser) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('El turno de Supervisión sólo puede ser operado por el rol Supervisor.');
  }
}

export async function getMyOpenSupervisionShift(userId: string) {
  return prisma.supervisionShift.findFirst({
    where: { supervisorId: userId, status: { in: [...OPEN_SUPERVISION_STATUSES] } },
    include: { handover: true },
    orderBy: { startedAt: 'desc' },
  });
}

export async function getLastClosedSupervisionShift(userId: string) {
  return prisma.supervisionShift.findFirst({
    where: {
      supervisorId: userId,
      status: SupervisionShiftStatus.CERRADO,
      finishedAt: { not: null },
    },
    orderBy: { finishedAt: 'desc' },
  });
}

export async function startSupervisionShift(
  user: CurrentUser,
  input: { priorities: string[] },
) {
  assertSupervisor(user);
  const priorities = input.priorities.map((item) => item.trim()).filter(Boolean).slice(0, 12);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.supervisionShift.findFirst({
      where: { supervisorId: user.id, status: { in: [...OPEN_SUPERVISION_STATUSES] } },
      select: { id: true },
    });
    if (existing) throw new RuleError('Ya tienes un turno de Supervisión abierto.');

    const now = new Date();
    const shift = await tx.supervisionShift.create({
      data: {
        supervisorId: user.id,
        priorities,
        status: SupervisionShiftStatus.ACTIVO,
        openingCompletedAt: now,
        openingState: { version: 0, legacyDirectStart: true },
      },
    });
    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_INICIAR,
        summary: `Turno de Supervisión iniciado por ${user.name}`,
        user,
        after: { startedAt: shift.startedAt, priorities, legacyDirectStart: true },
      },
      tx,
    );
    return shift;
  });
}

export async function beginSupervisionOpening(user: CurrentUser) {
  assertSupervisor(user);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.supervisionShift.findFirst({
      where: { supervisorId: user.id, status: { in: [...OPEN_SUPERVISION_STATUSES] } },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new RuleError(
        existing.status === SupervisionShiftStatus.PREPARACION
          ? 'Ya tienes una apertura de Supervisión en curso.'
          : 'Ya tienes un turno de Supervisión abierto.',
      );
    }

    const shift = await tx.supervisionShift.create({
      data: {
        supervisorId: user.id,
        status: SupervisionShiftStatus.PREPARACION,
        priorities: [],
        openingState: { version: 1, phase: 'PREPARACION' },
      },
    });

    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.CREAR,
        summary: `Apertura de Supervisión iniciada por ${user.name}`,
        user,
        after: { status: shift.status, startedAt: shift.startedAt },
      },
      tx,
    );
    return shift;
  });
}

type OpeningPendingRow = {
  key: string;
  ref: string;
  title: string;
  detail: string | null;
  href: string;
  tone: 'critico' | 'atencion' | 'curso';
  group: string;
};

function dedupeOpeningPending(rows: OpeningPendingRow[]): OpeningPendingRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

export async function getSupervisionOpeningReadiness(user: CurrentUser) {
  assertSupervisor(user);
  const shift = await prisma.supervisionShift.findFirst({
    where: {
      supervisorId: user.id,
      status: SupervisionShiftStatus.PREPARACION,
    },
    orderBy: { startedAt: 'desc' },
  });
  if (!shift) throw new RuleError('No tienes una apertura de Supervisión en preparación.');

  const businessDate = addCalendarDateDays(hotelCalendarDate(), -1);
  const [
    cashState,
    cashFunds,
    cashAudits,
    openGuarantees,
    floor4,
    floor5,
    floor6,
    reportRows,
    supervision,
    myTasks,
    myFollowUps,
  ] = await Promise.all([
    getLiveCashState({ movementLimit: 1, auditLimit: 1 }),
    prisma.cashFund.findMany({
      where: { active: true, currency: { in: ['CLP', 'USD'] } },
      select: { currency: true, amount: true },
      orderBy: { currency: 'asc' },
    }),
    prisma.cashAudit.findMany({
      where: { countedById: user.id, createdAt: { gte: shift.startedAt } },
      select: {
        id: true,
        humanId: true,
        currency: true,
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        notes: true,
        guaranteeSnapshot: true,
        denominationSnapshot: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    listOpenGuarantees(100),
    listRecentPhysicalKeyCounts(4, 1),
    listRecentPhysicalKeyCounts(5, 1),
    listRecentPhysicalKeyCounts(6, 1),
    prisma.supervisionAuditImport.findMany({
      where: { businessDate },
      select: {
        id: true,
        reportKinds: true,
        updatedAt: true,
        uploadedBy: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    getSupervisionData(),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        assigneeId: user.id,
        status: { in: TASK_OPEN_STATUSES },
      },
      select: {
        id: true,
        humanId: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        dueAt: true,
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
      take: 50,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        ownerId: user.id,
        status: { in: ['PENDIENTE', 'VENCIDO'] },
      },
      select: {
        id: true,
        humanId: true,
        action: true,
        description: true,
        status: true,
        priority: true,
        scheduledAt: true,
      },
      orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }, { createdAt: 'asc' }],
      take: 50,
    }),
  ]);

  const latestAuditByCurrency = new Map<string, (typeof cashAudits)[number]>();
  for (const audit of cashAudits) {
    const currency = audit.currency.toUpperCase();
    if (!latestAuditByCurrency.has(currency)) latestAuditByCurrency.set(currency, audit);
  }

  const cashCurrencies = cashFunds.map((fund) => {
    const currency = fund.currency.toUpperCase();
    const audit = latestAuditByCurrency.get(currency) ?? null;
    return {
      currency,
      fund: Number(fund.amount),
      audit: audit
        ? {
            id: audit.id,
            humanId: audit.humanId,
            expectedAmount: Number(audit.expectedAmount),
            countedAmount: Number(audit.countedAmount),
            difference: Number(audit.difference),
            notes: audit.notes,
            createdAt: audit.createdAt,
          }
        : null,
    };
  });
  const missingCashCurrencies = cashCurrencies.filter((row) => !row.audit).map((row) => row.currency);
  const unexplainedCashDifferences = cashCurrencies
    .filter((row) => row.audit && row.audit.difference !== 0 && !row.audit.notes?.trim())
    .map((row) => row.currency);

  const presentReportKinds = Array.from(
    new Set(reportRows.flatMap((row) => row.reportKinds).filter((kind) => kind !== 'DESCONOCIDO')),
  );
  const missingRequiredReports = REQUIRED_SUPERVISION_OPENING_REPORTS.filter(
    (kind) => !presentReportKinds.includes(kind),
  );
  const missingOptionalReports = OPTIONAL_SUPERVISION_OPENING_REPORTS.filter(
    (kind) => !presentReportKinds.includes(kind),
  );

  const signalRows: OpeningPendingRow[] = supervision.blocks.flatMap((block) =>
    block.rows.map((row) => ({
      key: row.sourceEntity && row.sourceId ? `${row.sourceEntity}:${row.sourceId}` : `signal:${block.key}:${row.id}`,
      ref: row.ref,
      title: row.title,
      detail: row.detail,
      href: row.href,
      tone: block.tone,
      group: block.title,
    })),
  );
  const taskRows: OpeningPendingRow[] = myTasks.map((task) => ({
    key: `Task:${task.id}`,
    ref: `#${task.humanId}`,
    title: task.title,
    detail: task.description,
    href: `/tareas/${task.id}`,
    tone: task.priority === 'CRITICA' ? 'critico' : task.status === 'BLOQUEADA' ? 'atencion' : 'curso',
    group: 'Asignado a mí',
  }));
  const followUpRows: OpeningPendingRow[] = myFollowUps.map((followUp) => ({
    key: `FollowUp:${followUp.id}`,
    ref: `#${followUp.humanId}`,
    title: followUp.action,
    detail: followUp.description,
    href: '/seguimientos',
    tone: followUp.status === 'VENCIDO' ? 'critico' : 'curso',
    group: 'En seguimiento',
  }));
  const pendingRows = dedupeOpeningPending([...signalRows, ...taskRows, ...followUpRows]);

  const keyRows = [
    { floor: 4, count: floor4[0] ?? null },
    { floor: 5, count: floor5[0] ?? null },
    { floor: 6, count: floor6[0] ?? null },
  ].map(({ floor, count }) => ({
    floor,
    id: count?.id ?? null,
    countedAt: count?.countedAt ?? null,
    countedBy: count?.countedBy.name ?? null,
    totals: count?.totals ?? {
      expected: floor === 4 ? 29 : 30,
      found: 0,
      missing: floor === 4 ? 29 : 30,
      surplus: 0,
      outOfService: 0,
    },
  }));

  return {
    shift: {
      id: shift.id,
      status: shift.status,
      startedAt: shift.startedAt,
    },
    businessDate,
    businessDateKey: calendarDateKey(businessDate),
    pendingRows,
    pendingTotal: pendingRows.length,
    cash: {
      currencies: cashCurrencies,
      missingCurrencies: missingCashCurrencies,
      unexplainedDifferences: unexplainedCashDifferences,
      denominations: cashState.denominations,
      guarantees: cashState.cashGuarantees.map((guarantee) => ({
        id: guarantee.id,
        amount: guarantee.amount,
        guestName: guarantee.guestName,
        roomNumber: guarantee.roomNumber,
        reference: guarantee.reference,
        currency: guarantee.currency,
      })),
    },
    guarantees: openGuarantees.map((guarantee) => ({
      id: guarantee.id,
      humanId: guarantee.humanId,
      kind: guarantee.kind,
      currency: guarantee.currency,
      amount: Number(guarantee.amount),
      state: guarantee.state,
      reference: guarantee.reference,
      roomNumber: guarantee.roomNumber,
      guestName: guarantee.guestName,
    })),
    keys: keyRows,
    reports: {
      presentKinds: presentReportKinds,
      required: [...REQUIRED_SUPERVISION_OPENING_REPORTS],
      optional: [...OPTIONAL_SUPERVISION_OPENING_REPORTS],
      missingRequired: missingRequiredReports,
      missingOptional: missingOptionalReports,
      labels: SUPERVISION_REPORT_LABELS,
      sources: reportRows.map((row) => ({
        id: row.id,
        reportKinds: row.reportKinds,
        updatedAt: row.updatedAt,
        uploadedBy: row.uploadedBy.name,
      })),
    },
    blockers: {
      cash: missingCashCurrencies.length + unexplainedCashDifferences.length,
      reports: missingRequiredReports.length,
    },
  };
}

export async function completeSupervisionOpening(
  user: CurrentUser,
  input: {
    shiftId: string;
    reviewedPending: boolean;
    reviewedGuarantees: boolean;
    reviewedKeys: boolean;
  },
) {
  assertSupervisor(user);
  if (!input.reviewedPending || !input.reviewedGuarantees || !input.reviewedKeys) {
    throw new RuleError('Debes confirmar la revisión operacional completa antes de iniciar tu turno.');
  }

  const readiness = await getSupervisionOpeningReadiness(user);
  if (readiness.shift.id !== input.shiftId) {
    throw new RuleError('La apertura que intentas confirmar ya no es la apertura vigente.');
  }
  if (readiness.cash.missingCurrencies.length > 0) {
    throw new RuleError(
      `Debes arquear personalmente la Caja antes de iniciar: ${readiness.cash.missingCurrencies.join(', ')}.`,
    );
  }
  if (readiness.cash.unexplainedDifferences.length > 0) {
    throw new RuleError(
      `Hay diferencias de Caja sin observación en: ${readiness.cash.unexplainedDifferences.join(', ')}.`,
    );
  }
  if (readiness.reports.missingRequired.length > 0) {
    throw new RuleError(
      `Faltan informes operativos obligatorios: ${readiness.reports.missingRequired
        .map((kind) => SUPERVISION_REPORT_LABELS[kind] ?? kind)
        .join(', ')}.`,
    );
  }

  const priorities = [
    ...readiness.pendingRows.map((row) => `${row.ref} · ${row.title}`),
    ...readiness.reports.missingOptional.map(
      (kind) => `Completar ${SUPERVISION_REPORT_LABELS[kind] ?? kind}`,
    ),
  ]
    .filter(Boolean)
    .slice(0, 12);

  const now = new Date();
  const openingState = JSON.parse(
    JSON.stringify({
      version: 1,
      businessDate: readiness.businessDateKey,
      completedAt: now,
      confirmations: {
        pending: true,
        guarantees: true,
        keys: true,
      },
      cash: readiness.cash.currencies.map((row) => ({
        currency: row.currency,
        fund: row.fund,
        audit: row.audit,
      })),
      guarantees: readiness.guarantees,
      keys: readiness.keys,
      reports: {
        presentKinds: readiness.reports.presentKinds,
        missingOptional: readiness.reports.missingOptional,
      },
      pending: readiness.pendingRows.map((row) => ({
        key: row.key,
        ref: row.ref,
        title: row.title,
        group: row.group,
      })),
    }),
  ) as Prisma.InputJsonObject;

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.supervisionShift.findUnique({
      where: { id: input.shiftId },
      select: { id: true, supervisorId: true, status: true },
    });
    if (!current || current.supervisorId !== user.id) {
      throw new NotFoundError('La apertura de Supervisión no existe.');
    }
    if (current.status !== SupervisionShiftStatus.PREPARACION) {
      throw new RuleError('Esta apertura ya fue iniciada o cerrada.');
    }

    const shift = await tx.supervisionShift.update({
      where: { id: current.id },
      data: {
        status: SupervisionShiftStatus.ACTIVO,
        startedAt: now,
        openingCompletedAt: now,
        openingState,
        priorities,
      },
    });

    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_INICIAR,
        summary: `Turno de Supervisión iniciado por ${user.name} tras recepción operacional`,
        user,
        after: {
          startedAt: now,
          priorities,
          cashAudits: readiness.cash.currencies.map((row) => row.audit?.id).filter(Boolean),
          reportKinds: readiness.reports.presentKinds,
          pendingReviewed: readiness.pendingTotal,
        },
      },
      tx,
    );
    return shift;
  });

  return updated;
}

async function buildSupervisionSnapshot(
  shiftId: string,
  client: Prisma.TransactionClient,
): Promise<Prisma.InputJsonObject> {
  const shift = await client.supervisionShift.findUnique({
    where: { id: shiftId },
    include: { supervisor: { select: { id: true, name: true } } },
  });
  if (!shift) throw new NotFoundError('El turno de Supervisión no existe.');

  const [tasks, followUps, audits, auditImports, correctiveMeasures, decisions] = await Promise.all([
    client.task.findMany({
      where: { supervisionShiftId: shift.id, deletedAt: null },
      select: {
        id: true,
        humanId: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.followUp.findMany({
      where: { supervisionShiftId: shift.id, deletedAt: null },
      select: {
        id: true,
        action: true,
        status: true,
        priority: true,
        scheduledAt: true,
        owner: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.checklistRun.findMany({
      where: { supervisionShiftId: shift.id, deletedAt: null },
      select: {
        id: true,
        humanId: true,
        templateName: true,
        status: true,
        severity: true,
        finishedAt: true,
        _count: { select: { findings: true } },
      },
      orderBy: { startedAt: 'asc' },
    }),
    client.supervisionAuditImport.findMany({
      where: { supervisionShiftId: shift.id },
      select: {
        id: true,
        businessDate: true,
        reportKinds: true,
        metrics: true,
        checks: true,
        findings: true,
        warnings: true,
        reviewState: true,
        sourceFiles: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { businessDate: 'asc' },
    }),
    client.correctiveMeasure.findMany({
      where: {
        deletedAt: null,
        finding: { audit: { supervisionShiftId: shift.id } },
      },
      select: {
        id: true,
        taskId: true,
        title: true,
        status: true,
        dueAt: true,
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.auditLog.findMany({
      where: { userId: shift.supervisorId, createdAt: { gte: shift.startedAt } },
      select: { id: true, entity: true, entityId: true, action: true, summary: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
  ]);

  return JSON.parse(
    JSON.stringify({
      version: 2,
      capturedAt: new Date(),
      shift: {
        id: shift.id,
        startedAt: shift.startedAt,
        supervisor: shift.supervisor,
        priorities: shift.priorities,
        openingState: shift.openingState,
        openingCompletedAt: shift.openingCompletedAt,
      },
      tasks,
      followUps,
      audits,
      auditImports,
      correctiveMeasures,
      decisions,
      summary: {
        tasksCompleted: tasks.filter((task) =>
          new Set<TaskStatus>([
            TaskStatus.REALIZADA,
            TaskStatus.VALIDADA,
            TaskStatus.COMPLETADA,
          ]).has(task.status),
        ).length,
        tasksPending: tasks.filter((task) => TASK_OPEN_STATUSES.includes(task.status)).length,
        tasksBlocked: tasks.filter((task) => task.status === TaskStatus.BLOQUEADA).length,
        tasksReturned: tasks.filter((task) => task.status === TaskStatus.DEVUELTA).length,
        followUpsOpen: followUps.filter((followUp) =>
          ['PENDIENTE', 'VENCIDO'].includes(followUp.status),
        ).length,
        auditsOpen: audits.filter((audit) => audit.status !== 'CERRADA').length,
        dailyAuditImports: auditImports.length,
        dailyAuditFindings: auditImports.reduce((sum, item) => {
          const findings = Array.isArray(item.findings) ? item.findings : [];
          return sum + findings.length;
        }, 0),
        dailyAuditPending: auditImports.reduce((sum, item) => {
          const checks = Array.isArray(item.checks)
            ? (item.checks as Array<{ key: string; done: boolean | null }>)
            : [];
          const findings = Array.isArray(item.findings)
            ? (item.findings as Array<{ key: string }>)
            : [];
          return (
            sum +
            auditOperationalPendingCount({
              metrics: item.metrics,
              checks,
              findings,
              reviewState: item.reviewState,
            })
          );
        }, 0),
        correctiveMeasuresOpen: correctiveMeasures.filter(
          (measure) => !['VALIDADA', 'CANCELADA'].includes(measure.status),
        ).length,
      },
    }),
  ) as Prisma.InputJsonObject;
}

export async function deliverSupervisionShift(
  user: CurrentUser,
  input: { shiftId: string; note?: string | null },
) {
  assertSupervisor(user);
  return prisma.$transaction(async (tx) => {
    const shift = await tx.supervisionShift.findUnique({ where: { id: input.shiftId } });
    if (!shift) throw new NotFoundError('El turno de Supervisión no existe.');
    if (shift.supervisorId !== user.id) throw new RuleError('Ese turno pertenece a otro supervisor.');
    if (shift.status !== SupervisionShiftStatus.ACTIVO) {
      throw new RuleError('Sólo un turno de Supervisión activo puede entregarse.');
    }

    const snapshot = await buildSupervisionSnapshot(shift.id, tx);
    const handover = await tx.supervisionShiftHandover.create({
      data: {
        supervisionShiftId: shift.id,
        issuedById: user.id,
        note: input.note?.trim() || null,
        snapshot,
      },
    });
    await tx.supervisionShift.update({
      where: { id: shift.id },
      data: { status: SupervisionShiftStatus.ENTREGADO, deliveredAt: handover.issuedAt },
    });
    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_ENTREGAR,
        summary: `Turno de Supervisión entregado por ${user.name}`,
        user,
        after: { handoverId: handover.id, issuedAt: handover.issuedAt },
      },
      tx,
    );
    return handover;
  });
}

export async function finishSupervisionShift(user: CurrentUser, shiftId: string) {
  assertSupervisor(user);
  return prisma.$transaction(async (tx) => {
    const shift = await tx.supervisionShift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundError('El turno de Supervisión no existe.');
    if (shift.supervisorId !== user.id) throw new RuleError('Ese turno pertenece a otro supervisor.');
    if (!OPEN_SUPERVISION_STATUSES.includes(shift.status as (typeof OPEN_SUPERVISION_STATUSES)[number])) {
      throw new RuleError('Ese turno de Supervisión ya está cerrado.');
    }

    let handover = await tx.supervisionShiftHandover.findUnique({
      where: { supervisionShiftId: shift.id },
      select: { id: true, issuedAt: true },
    });
    if (!handover) {
      const snapshot = await buildSupervisionSnapshot(shift.id, tx);
      handover = await tx.supervisionShiftHandover.create({
        data: {
          supervisionShiftId: shift.id,
          issuedById: user.id,
          snapshot,
        },
        select: { id: true, issuedAt: true },
      });
    }

    const finishedAt = new Date();
    const finished = await tx.supervisionShift.update({
      where: { id: shift.id },
      data: {
        status: SupervisionShiftStatus.CERRADO,
        finishedAt,
        deliveredAt: shift.deliveredAt ?? handover.issuedAt,
      },
    });
    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_CERRAR,
        summary: `Turno de Supervisión finalizado por ${user.name}`,
        user,
        after: {
          finishedAt: finished.finishedAt,
          handoverId: handover.id,
          snapshotEnsured: true,
          continuity: 'Los seguimientos y tareas abiertos permanecen vigentes fuera del turno.',
        },
      },
      tx,
    );
    return finished;
  });
}

export async function receiveSupervisionHandover(user: CurrentUser, handoverId: string) {
  assertSupervisor(user);
  return prisma.$transaction(async (tx) => {
    const handover = await tx.supervisionShiftHandover.findUnique({
      where: { id: handoverId },
      include: { issuedBy: { select: { name: true } } },
    });
    if (!handover) throw new NotFoundError('La entrega de Supervisión no existe.');
    if (handover.issuedById === user.id) {
      throw new RuleError('No puedes recibir tu propia entrega de Supervisión.');
    }
    if (handover.receivedAt) throw new RuleError('Esta entrega ya fue recibida.');
    const receivedAt = new Date();
    const received = await tx.supervisionShiftHandover.update({
      where: { id: handover.id },
      data: { receivedById: user.id, receivedAt },
    });
    await recordAudit(
      {
        entity: 'SupervisionShiftHandover',
        entityId: handover.id,
        action: AuditAction.TURNO_RECIBIR,
        summary: `Entrega de Supervisión de ${handover.issuedBy.name} recibida por ${user.name}`,
        user,
        after: { receivedById: user.id, receivedAt },
      },
      tx,
    );
    return received;
  });
}

type SupervisionSourceEntity =
  | 'OperationalEntry'
  | 'Alert'
  | 'Guarantee'
  | 'CashAudit'
  | 'Task'
  | 'ShiftHandover'
  | 'Shift'
  | 'KeyInventoryCount';

async function resolveSupervisionSource(sourceEntity: SupervisionSourceEntity, sourceId: string) {
  switch (sourceEntity) {
    case 'OperationalEntry': {
      const row = await prisma.operationalEntry.findFirst({
        where: { id: sourceId, deletedAt: null },
        select: { id: true, humanId: true, title: true },
      });
      if (!row) throw new NotFoundError('La novedad de origen ya no existe.');
      return { label: `#${row.humanId} · ${row.title}`, entryId: row.id, taskId: null };
    }
    case 'Alert': {
      const row = await prisma.alert.findUnique({
        where: { id: sourceId },
        select: { id: true, title: true },
      });
      if (!row) throw new NotFoundError('La alerta de origen ya no existe.');
      return { label: `Alerta · ${row.title}`, entryId: null, taskId: null };
    }
    case 'Guarantee': {
      const row = await prisma.guarantee.findFirst({
        where: { id: sourceId, deletedAt: null },
        select: { id: true, humanId: true, reference: true, guestName: true, roomNumber: true },
      });
      if (!row) throw new NotFoundError('La garantía de origen ya no existe.');
      const label = row.reference || row.guestName || (row.roomNumber ? `Hab. ${row.roomNumber}` : null);
      return { label: `#${row.humanId} · Garantía · ${label ?? 'sin referencia'}`, entryId: null, taskId: null };
    }
    case 'CashAudit': {
      const row = await prisma.cashAudit.findUnique({
        where: { id: sourceId },
        select: { id: true, humanId: true, currency: true, difference: true },
      });
      if (!row) throw new NotFoundError('El arqueo de origen ya no existe.');
      return {
        label: `#${row.humanId} · Caja ${row.currency} · diferencia ${Number(row.difference).toLocaleString('es-CL')}`,
        entryId: null,
        taskId: null,
      };
    }
    case 'Task': {
      const row = await prisma.task.findFirst({
        where: { id: sourceId, deletedAt: null },
        select: { id: true, humanId: true, title: true },
      });
      if (!row) throw new NotFoundError('La tarea de origen ya no existe.');
      return { label: `#${row.humanId} · ${row.title}`, entryId: null, taskId: row.id };
    }
    case 'ShiftHandover': {
      const row = await prisma.shiftHandover.findUnique({
        where: { id: sourceId },
        select: { id: true, humanId: true, issuedBy: { select: { name: true } } },
      });
      if (!row) throw new NotFoundError('La entrega de turno de origen ya no existe.');
      return { label: `#${row.humanId} · Entrega de turno · ${row.issuedBy.name}`, entryId: null, taskId: null };
    }
    case 'Shift': {
      const row = await prisma.shift.findUnique({
        where: { id: sourceId },
        select: { id: true, humanId: true, type: true, date: true },
      });
      if (!row) throw new NotFoundError('El turno de origen ya no existe.');
      return {
        label: `#${row.humanId} · Turno ${row.type} · ${formatCalendarDate(row.date)}`,
        entryId: null,
        taskId: null,
      };
    }
    case 'KeyInventoryCount': {
      const row = await prisma.keyInventoryCount.findUnique({
        where: { id: sourceId },
        select: { id: true, humanId: true, floor: true, countedAt: true },
      });
      if (!row) throw new NotFoundError('El inventario de llaves de origen ya no existe.');
      return {
        label: `#${row.humanId} · Inventario de llaves · piso ${row.floor}`,
        entryId: null,
        taskId: null,
      };
    }
    default:
      throw new RuleError('Ese tipo de fuente no puede seguirse desde Supervisión.');
  }
}

export async function followSupervisionSource(
  user: CurrentUser,
  input: { sourceEntity: SupervisionSourceEntity; sourceId: string },
) {
  assertSupervisor(user);
  const source = await resolveSupervisionSource(input.sourceEntity, input.sourceId);
  const existing = await prisma.followUp.findFirst({
    where: {
      deletedAt: null,
      ownerId: user.id,
      sourceEntity: input.sourceEntity,
      sourceId: input.sourceId,
      status: { in: ['PENDIENTE', 'VENCIDO'] },
    },
    include: { owner: { select: { id: true, name: true } } },
  });
  if (existing) return existing;

  return createFollowUp(user, {
    entryId: source.entryId,
    taskId: source.taskId,
    action: `Seguir: ${source.label}`,
    description: 'Añadido a Mi continuidad desde la bandeja transversal de Supervisión.',
    ownerId: user.id,
    origin: `SUPERVISION_${input.sourceEntity.toUpperCase()}`,
    visibility: SupervisionVisibility.SUPERVISION,
    sourceEntity: input.sourceEntity,
    sourceId: input.sourceId,
  });
}

export async function createSupervisionNote(
  user: CurrentUser,
  input: {
    title: string;
    body: string;
    visibility: SupervisionVisibility;
    sourceEntity?: string | null;
    sourceId?: string | null;
  },
) {
  assertSupervisor(user);
  if (
    input.visibility !== SupervisionVisibility.PRIVADO &&
    !user.permissions.includes('supervision.note.share')
  ) {
    throw new RuleError('No tienes permiso para compartir notas.');
  }
  const shift = await getMyOpenSupervisionShift(user.id);
  const note = await prisma.supervisionNote.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      visibility: input.visibility,
      authorId: user.id,
      supervisionShiftId: shift?.id ?? null,
      sourceEntity: input.sourceEntity ?? null,
      sourceId: input.sourceId ?? null,
    },
  });
  await recordAudit({
    entity: 'SupervisionNote',
    entityId: note.id,
    action: AuditAction.CREAR,
    summary: `Nota de Supervisión creada: ${note.title}`,
    user,
    after: { visibility: note.visibility, sourceEntity: note.sourceEntity, sourceId: note.sourceId },
  });
  return note;
}

export async function listVisibleSupervisionNotes(user: CurrentUser, take = 30) {
  if (!user.isSystemAdmin && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError('Las notas de Supervisión no forman parte del Libro operativo.');
  }
  return prisma.supervisionNote.findMany({
    where: {
      deletedAt: null,
      OR: [
        { visibility: SupervisionVisibility.PRIVADO, authorId: user.id },
        { visibility: SupervisionVisibility.SUPERVISION },
        { visibility: SupervisionVisibility.OPERATIVO },
      ],
    },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/** Acceso técnico excepcional: nunca se usa para alimentar listados. */
export async function readSupervisionNote(user: CurrentUser, noteId: string) {
  const note = await prisma.supervisionNote.findFirst({ where: { id: noteId, deletedAt: null } });
  if (!note) throw new NotFoundError('La nota no existe.');
  if (!user.isSystemAdmin && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError('Las notas de Supervisión no forman parte del Libro operativo.');
  }
  if (note.visibility === SupervisionVisibility.PRIVADO && note.authorId !== user.id) {
    if (!user.isSystemAdmin) throw new RuleError('Esta nota es privada.');
    await recordAudit({
      entity: 'SupervisionNote',
      entityId: note.id,
      action: AuditAction.EDITAR,
      summary: 'Acceso técnico excepcional a una nota privada',
      user,
      reason: 'Consulta técnica auditada',
    });
  }
  return note;
}

export async function softDeleteSupervisionNote(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const note = await prisma.supervisionNote.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!note) throw new NotFoundError('La nota no existe o ya fue eliminada.');
  if (note.authorId !== user.id && !user.isSystemAdmin) {
    throw new RuleError('Sólo el autor puede eliminar esta nota.');
  }
  const deleted = await prisma.supervisionNote.update({
    where: { id: note.id },
    data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
  });
  await recordAudit({
    entity: 'SupervisionNote',
    entityId: note.id,
    action: AuditAction.ELIMINAR,
    summary: `Nota de Supervisión eliminada lógicamente: ${note.title}`,
    user,
    reason: input.reason,
  });
  return deleted;
}

export async function restoreSupervisionNote(user: CurrentUser, noteId: string) {
  if (!user.isSystemAdmin) throw new RuleError('Sólo el Administrador de sistema puede restaurar notas.');
  const note = await prisma.supervisionNote.findFirst({
    where: { id: noteId, deletedAt: { not: null } },
  });
  if (!note) throw new NotFoundError('La nota no está eliminada.');
  const restored = await prisma.supervisionNote.update({
    where: { id: note.id },
    data: { deletedAt: null, deletedById: null, deletionReason: null },
  });
  await recordAudit({
    entity: 'SupervisionNote',
    entityId: note.id,
    action: AuditAction.RESTAURAR,
    summary: `Nota de Supervisión restaurada: ${note.title}`,
    user,
  });
  return restored;
}

export async function getSupervisionCenterSummary(user: CurrentUser) {
  if (!user.permissions.includes('supervision.center.view')) {
    throw new RuleError('No tienes permiso para consultar el Centro de Supervisión.');
  }
  const [currentShift, lastClosedShift] = await Promise.all([
    getMyOpenSupervisionShift(user.id),
    getLastClosedSupervisionShift(user.id),
  ]);
  const now = new Date();
  const sinceLastShift = lastClosedShift?.finishedAt ?? null;
  const noteWhere: Prisma.SupervisionNoteWhereInput = {
    deletedAt: null,
    OR: [
      { visibility: SupervisionVisibility.PRIVADO, authorId: user.id },
      { visibility: { in: [SupervisionVisibility.SUPERVISION, SupervisionVisibility.OPERATIVO] } },
    ],
  };
  const [
    tasks,
    followUps,
    myTasks,
    myFollowUps,
    notes,
    audits,
    auditImports,
    measures,
    changesSinceLastShift,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
      include: { assignee: { select: { name: true } } },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 20,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PENDIENTE', 'VENCIDO'] },
        OR: [
          { visibility: SupervisionVisibility.SUPERVISION },
          { visibility: SupervisionVisibility.OPERATIVO },
          { visibility: SupervisionVisibility.PRIVADO, createdById: user.id },
        ],
      },
      include: { owner: { select: { name: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        assigneeId: user.id,
        status: { in: TASK_OPEN_STATUSES },
      },
      include: { assignee: { select: { name: true } } },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      take: 30,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        ownerId: user.id,
        status: { in: ['PENDIENTE', 'VENCIDO'] },
      },
      include: { owner: { select: { name: true } } },
      orderBy: [{ scheduledAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      take: 30,
    }),
    prisma.supervisionNote.findMany({
      where: noteWhere,
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.checklistRun.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CERRADA' },
        ...(user.isSystemAdmin
          ? {}
          : {
              OR: [
                { status: { not: 'PREPARACION' } },
                { status: 'PREPARACION', runById: user.id },
              ],
            }),
      },
      select: {
        id: true,
        humanId: true,
        templateName: true,
        status: true,
        scope: true,
        startedAt: true,
        runBy: { select: { name: true } },
        _count: { select: { findings: true } },
      },
      orderBy: { startedAt: 'asc' },
      take: 12,
    }),
    currentShift
      ? prisma.supervisionAuditImport.findMany({
          where: { supervisionShiftId: currentShift.id },
          include: { uploadedBy: { select: { id: true, name: true } } },
          orderBy: { businessDate: 'desc' },
          take: 7,
        })
      : Promise.resolve([]),
    prisma.correctiveMeasure.findMany({
      where: { deletedAt: null, status: { notIn: ['VALIDADA', 'CANCELADA'] } },
      select: {
        id: true,
        taskId: true,
        title: true,
        action: true,
        status: true,
        dueAt: true,
        assignee: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 12,
    }),
    sinceLastShift
      ? Promise.all([
          prisma.operationalEntry.count({
            where: { deletedAt: null, createdAt: { gt: sinceLastShift } },
          }),
          prisma.task.count({
            where: {
              deletedAt: null,
              assigneeId: user.id,
              updatedAt: { gt: sinceLastShift },
            },
          }),
          prisma.followUp.count({
            where: {
              deletedAt: null,
              ownerId: user.id,
              updatedAt: { gt: sinceLastShift },
            },
          }),
          prisma.cashAudit.count({ where: { createdAt: { gt: sinceLastShift } } }),
          prisma.shiftHandover.count({ where: { issuedAt: { gt: sinceLastShift } } }),
          prisma.keyInventoryCount.count({ where: { countedAt: { gt: sinceLastShift } } }),
        ]).then(([entries, myTaskUpdates, myFollowUpUpdates, cashAudits, handovers, keyInventories]) => ({
          entries,
          myTaskUpdates,
          myFollowUpUpdates,
          cashAudits,
          handovers,
          keyInventories,
        }))
      : Promise.resolve({
          entries: 0,
          myTaskUpdates: 0,
          myFollowUpUpdates: 0,
          cashAudits: 0,
          handovers: 0,
          keyInventories: 0,
        }),
  ]);

  const [myTaskCount, myFollowUpCount, auditOpenCount, measureOpenCount] = await Promise.all([
    prisma.task.count({
      where: {
        deletedAt: null,
        assigneeId: user.id,
        status: { in: TASK_OPEN_STATUSES },
      },
    }),
    prisma.followUp.count({
      where: {
        deletedAt: null,
        ownerId: user.id,
        status: { in: ['PENDIENTE', 'VENCIDO'] },
      },
    }),
    prisma.checklistRun.count({
      where: {
        deletedAt: null,
        status: { not: 'CERRADA' },
        ...(user.isSystemAdmin
          ? {}
          : {
              OR: [
                { status: { not: 'PREPARACION' } },
                { status: 'PREPARACION', runById: user.id },
              ],
            }),
      },
    }),
    prisma.correctiveMeasure.count({
      where: { deletedAt: null, status: { notIn: ['VALIDADA', 'CANCELADA'] } },
    }),
  ]);

  return {
    now,
    currentShift,
    lastClosedShift,
    sinceLastShift,
    changesSinceLastShift,
    tasks,
    followUps,
    myTasks,
    myFollowUps,
    notes,
    audits,
    auditImports,
    measures,
    counts: {
      myTasks: myTaskCount,
      myFollowUps: myFollowUpCount,
      auditsOpen: auditOpenCount,
      measuresOpen: measureOpenCount,
    },
  };
}
