import 'server-only';
import {
  AuditAction,
  AuditCategory,
  AuditDisclosure,
  ChecklistItemResult,
  Severity,
  SupervisionAuditStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { assertAssignable } from './users';

function assertOperationalSupervisor(user: CurrentUser) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('Las auditorías sorpresa sólo pueden ser operadas por el rol Supervisor.');
  }
}

/**
 * Checklists de supervisión.
 *
 * La decisión que gobierna el módulo: **la ejecución copia el texto de cada
 * punto**. Si apuntara a la plantilla viva, editar un punto cambiaría lo que
 * alguien ya firmó el mes pasado, y un control que se puede reescribir hacia
 * atrás no controla nada.
 *
 * Por eso son dos modelos y no uno: la plantilla es lo que se define, la
 * ejecución es lo que se recorrió un día concreto.
 */

export const templateInclude = {
  items: { orderBy: { order: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { runs: true } },
} satisfies Prisma.ChecklistTemplateInclude;

export type TemplateWithItems = Prisma.ChecklistTemplateGetPayload<{
  include: typeof templateInclude;
}>;

export const runInclude = {
  items: { orderBy: { order: 'asc' } },
  runBy: { select: { id: true, name: true } },
} satisfies Prisma.ChecklistRunInclude;

export type RunWithItems = Prisma.ChecklistRunGetPayload<{ include: typeof runInclude }>;

export async function listTemplates(includeInactive = false): Promise<TemplateWithItems[]> {
  return prisma.checklistTemplate.findMany({
    where: { deletedAt: null, ...(includeInactive ? {} : { active: true }) },
    include: templateInclude,
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Crea o reemplaza una plantilla.
 *
 * Los puntos se reemplazan en bloque en lugar de compararse uno a uno: quien
 * edita una lista de control la reescribe, no hace cirugía. Las ejecuciones ya
 * hechas no se tocan porque conservan su propia copia del texto.
 */
export async function saveTemplate(
  user: CurrentUser,
  input: {
    id?: string | null;
    name: string;
    description?: string | null;
    cadence?: string | null;
    active?: boolean;
    category?: AuditCategory;
    /** Un punto por línea. `*` al inicio lo marca como crítico. */
    items: string[];
  },
): Promise<TemplateWithItems> {
  const cleaned = input.items
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 60);

  if (cleaned.length === 0) {
    throw new RuleError('Una lista de control sin puntos no controla nada: agrega al menos uno.');
  }

  const parsed = cleaned.map((line, index) => {
    const critical = line.startsWith('*');
    return {
      text: (critical ? line.slice(1) : line).trim(),
      critical,
      order: index,
    };
  });
  if (parsed.some((item) => item.text.length === 0)) {
    throw new RuleError('Hay un punto que sólo tiene el asterisco: escribe qué se revisa.');
  }

  const template = await prisma.$transaction(async (tx) => {
    if (input.id) {
      const existing = await tx.checklistTemplate.findFirst({
        where: { id: input.id, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError('Esa lista de control no existe.');

      await tx.checklistTemplateItem.deleteMany({ where: { templateId: input.id } });
      return tx.checklistTemplate.update({
        where: { id: input.id },
        data: {
          name: input.name.trim(),
          description: input.description?.trim() || null,
          cadence: input.cadence?.trim() || null,
          active: input.active ?? true,
          category: input.category ?? AuditCategory.OTRO,
          items: { createMany: { data: parsed } },
        },
        include: templateInclude,
      });
    }

    return tx.checklistTemplate.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        cadence: input.cadence?.trim() || null,
        active: input.active ?? true,
        category: input.category ?? AuditCategory.OTRO,
        createdById: user.id,
        items: { createMany: { data: parsed } },
      },
      include: templateInclude,
    });
  });

  await recordAudit({
    entity: 'ChecklistTemplate',
    entityId: template.id,
    action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
    user,
    summary: `Lista de control «${template.name}» con ${parsed.length} punto(s)`,
  });

  return template;
}

export async function softDeleteTemplate(
  user: CurrentUser,
  input: { templateId: string; reason: string },
) {
  const template = await prisma.checklistTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!template) throw new NotFoundError('Esa lista de control no existe.');

  await prisma.checklistTemplate.update({
    where: { id: template.id },
    data: { deletedAt: new Date(), active: false, deletionReason: input.reason },
  });

  await recordAudit({
    entity: 'ChecklistTemplate',
    entityId: template.id,
    action: AuditAction.ELIMINAR,
    user,
    summary: `Lista de control «${template.name}» eliminada: ${input.reason}`,
  });
}

/**
 * Empieza a recorrer una lista.
 *
 * Copia el nombre y cada punto: es lo que hace que la ejecución sea un
 * documento y no una vista de la plantilla.
 */
export async function startRun(
  user: CurrentUser,
  input: {
    templateId: string;
    scope?: string | null;
    sample?: string | null;
    participantIds?: string[];
    reviewedShiftIds?: string[];
    reviewedDepartmentIds?: string[];
  },
): Promise<RunWithItems> {
  assertOperationalSupervisor(user);
  const template = await prisma.checklistTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null, active: true },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  if (!template) throw new NotFoundError('Esa lista de control no existe o está inactiva.');
  if (template.items.length === 0) {
    throw new RuleError('Esa lista no tiene puntos: no hay nada que recorrer.');
  }

  const supervisionShift = await prisma.supervisionShift.findFirst({
    where: { supervisorId: user.id, status: 'ACTIVO' },
    select: { id: true },
  });
  if (!supervisionShift) {
    throw new RuleError('Inicia tu turno de Supervisión antes de abrir una auditoría sorpresa.');
  }
  for (const participantId of input.participantIds ?? []) await assertAssignable(participantId);

  const run = await prisma.checklistRun.create({
    data: {
      templateId: template.id,
      templateName: template.name,
      runById: user.id,
      supervisionShiftId: supervisionShift.id,
      status: SupervisionAuditStatus.PREPARACION,
      surprise: true,
      scope: input.scope?.trim() || null,
      sample: input.sample?.trim() || null,
      reviewedShiftIds: input.reviewedShiftIds ?? [],
      reviewedDepartmentIds: input.reviewedDepartmentIds ?? [],
      participants:
        (input.participantIds?.length ?? 0) > 0
          ? {
              create: (input.participantIds ?? []).map((userId) => ({
                userId,
                addedById: user.id,
              })),
            }
          : undefined,
      items: {
        createMany: {
          data: template.items.map((item) => ({
            text: item.text,
            critical: item.critical,
            order: item.order,
          })),
        },
      },
    },
    include: runInclude,
  });

  await recordAudit({
    entity: 'ChecklistRun',
    entityId: run.id,
    action: AuditAction.CREAR,
    user,
    summary: `Ronda iniciada: «${template.name}» (${template.items.length} puntos)`,
    after: {
      supervisionShiftId: run.supervisionShiftId,
      scope: run.scope,
      sample: run.sample,
      participantIds: input.participantIds ?? [],
      reviewedShiftIds: run.reviewedShiftIds,
      reviewedDepartmentIds: run.reviewedDepartmentIds,
      surprise: run.surprise,
    },
  });

  return run;
}

/** Marca el resultado de un punto. Una falla exige observación. */
export async function markRunItem(
  user: CurrentUser,
  input: {
    itemId: string;
    result:
      | 'PENDIENTE'
      | 'OK'
      | 'CUMPLE'
      | 'OBSERVACION'
      | 'FALLA'
      | 'INCUMPLIMIENTO'
      | 'NO_APLICA';
    observation?: string | null;
    evidence?: string | null;
    severity?: Severity;
  },
) {
  assertOperationalSupervisor(user);
  const item = await prisma.checklistRunItem.findUnique({
    where: { id: input.itemId },
    select: {
      id: true,
      text: true,
      run: { select: { id: true, runById: true, finishedAt: true, templateName: true } },
    },
  });
  if (!item) throw new NotFoundError('Ese punto no existe.');
  if (item.run.finishedAt) {
    throw new RuleError('Esa ronda ya se cerró: no admite cambios.');
  }
  /*
    Sólo quien la está recorriendo la marca. Si cualquiera pudiera, el control
    dejaría de decir quién revisó qué, que es todo su valor.
  */
  if (item.run.runById !== user.id) {
    throw new RuleError('Esta ronda la está recorriendo otra persona.');
  }
  if (
    ['FALLA', 'OBSERVACION', 'INCUMPLIMIENTO'].includes(input.result) &&
    !input.observation?.trim()
  ) {
    throw new RuleError('Una falla sin observación no sirve: escribe qué encontraste.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.checklistRunItem.update({
      where: { id: item.id },
      data: {
        result: input.result as ChecklistItemResult,
        observation: input.observation?.trim() || null,
        evidence: input.evidence?.trim() || null,
        run: { update: { status: SupervisionAuditStatus.EN_CURSO } },
      },
    });
    if (['FALLA', 'OBSERVACION', 'INCUMPLIMIENTO'].includes(input.result)) {
      await tx.auditFinding.upsert({
        where: { itemId: item.id },
        create: {
          auditId: item.run.id,
          itemId: item.id,
          title: item.text,
          description: input.observation!.trim(),
          severity: input.severity ?? (input.result === 'OBSERVACION' ? Severity.BAJA : Severity.MEDIA),
        },
        update: {
          description: input.observation!.trim(),
          severity: input.severity ?? (input.result === 'OBSERVACION' ? Severity.BAJA : Severity.MEDIA),
          deletedAt: null,
          deletionReason: null,
        },
      });
    } else {
      await tx.auditFinding.updateMany({
        where: { itemId: item.id, deletedAt: null },
        data: { deletedAt: new Date(), deletionReason: 'El punto dejó de presentar hallazgo.' },
      });
    }
    await recordAudit(
      {
        entity: 'ChecklistRun',
        entityId: item.run.id,
        action: AuditAction.EDITAR,
        summary: `Auditoría «${item.run.templateName}»: ${item.text} → ${input.result}`,
        user,
        after: { result: input.result, observation: input.observation, evidence: input.evidence },
      },
      tx,
    );
    return updated;
  });
}

/**
 * Cierra la ronda.
 *
 * No se puede cerrar con puntos sin revisar: una lista a medias da la
 * impresión de haberse recorrido sin haberlo hecho, que es peor que no tenerla.
 */
export async function finishRun(
  user: CurrentUser,
  input: {
    runId: string;
    notes?: string | null;
    resultSummary?: string | null;
    disclosure?: AuditDisclosure;
  },
) {
  assertOperationalSupervisor(user);
  const run = await prisma.checklistRun.findUnique({
    where: { id: input.runId },
    include: { items: true },
  });
  if (!run) throw new NotFoundError('Esa ronda no existe.');
  if (run.finishedAt) throw new RuleError('Esa ronda ya está cerrada.');
  if (run.runById !== user.id) {
    throw new RuleError('Esta ronda la está recorriendo otra persona.');
  }

  const pending = run.items.filter((item) => item.result === ChecklistItemResult.PENDIENTE);
  if (pending.length > 0) {
    throw new RuleError(
      `Quedan ${pending.length} punto(s) sin revisar. Márcalos, aunque sea como «no aplica».`,
    );
  }

  const failureResults = new Set<ChecklistItemResult>([
    ChecklistItemResult.FALLA,
    ChecklistItemResult.INCUMPLIMIENTO,
  ]);
  const failures = run.items.filter((item) => failureResults.has(item.result));
  const criticalFailures = failures.filter((item) => item.critical);

  const closed = await prisma.$transaction(async (tx) => {
    const result = await tx.checklistRun.update({
      where: { id: run.id },
      data: {
        status: SupervisionAuditStatus.CERRADA,
        finishedAt: new Date(),
        closedById: user.id,
        notes: input.notes?.trim() || null,
        resultSummary: input.resultSummary?.trim() || null,
        disclosure: input.disclosure ?? AuditDisclosure.RESERVADO,
        severity:
          criticalFailures.length > 0
            ? Severity.CRITICA
            : failures.length > 0
              ? Severity.MEDIA
              : null,
      },
      include: runInclude,
    });
    await tx.auditFinding.updateMany({
      where: { auditId: run.id, deletedAt: null },
      data: {
        confirmed: true,
        disclosure: input.disclosure ?? AuditDisclosure.RESERVADO,
      },
    });
    await recordAudit(
      {
        entity: 'ChecklistRun',
        entityId: run.id,
        action: AuditAction.CERRAR,
        user,
        summary:
          `Auditoría «${run.templateName}» cerrada: ${failures.length} incumplimiento(s)` +
          (criticalFailures.length > 0 ? `, ${criticalFailures.length} crítico(s)` : '') +
          `${input.notes ? `. ${input.notes}` : ''}`,
        after: { disclosure: input.disclosure ?? AuditDisclosure.RESERVADO },
      },
      tx,
    );
    return result;
  });

  return { run: closed, failures: failures.length, criticalFailures: criticalFailures.length };
}

/** Rondas recientes, para el tablero del Supervisor. */
export async function listRuns(user: CurrentUser, limit = 20): Promise<RunWithItems[]> {
  if (!user.isSystemAdmin && !user.permissions.includes('supervision.audit.reserved')) {
    throw new RuleError('No tienes permiso para consultar auditorías de Supervisión.');
  }
  return prisma.checklistRun.findMany({
    where: {
      deletedAt: null,
      ...(user.isSystemAdmin
        ? {}
        : {
            OR: [
              { status: { not: SupervisionAuditStatus.PREPARACION } },
              { status: SupervisionAuditStatus.PREPARACION, runById: user.id },
            ],
          }),
    },
    include: runInclude,
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}

/** La ronda que esta persona tiene abierta, si alguna. */
export async function getMyOpenRun(userId: string): Promise<RunWithItems | null> {
  return prisma.checklistRun.findFirst({
    where: { runById: userId, finishedAt: null },
    include: runInclude,
    orderBy: { startedAt: 'desc' },
  });
}
