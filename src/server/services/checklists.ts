import 'server-only';
import { AuditAction, ChecklistItemResult } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { getMyOpenShift } from './shifts';

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
  input: { templateId: string },
): Promise<RunWithItems> {
  const template = await prisma.checklistTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null, active: true },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  if (!template) throw new NotFoundError('Esa lista de control no existe o está inactiva.');
  if (template.items.length === 0) {
    throw new RuleError('Esa lista no tiene puntos: no hay nada que recorrer.');
  }

  // Se cuelga del turno abierto si hay uno: así la ronda queda en su contexto.
  const shift = await getMyOpenShift(user.id);

  const run = await prisma.checklistRun.create({
    data: {
      templateId: template.id,
      templateName: template.name,
      runById: user.id,
      shiftId: shift?.id ?? null,
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
  });

  return run;
}

/** Marca el resultado de un punto. Una falla exige observación. */
export async function markRunItem(
  user: CurrentUser,
  input: {
    itemId: string;
    result: 'PENDIENTE' | 'OK' | 'FALLA' | 'NO_APLICA';
    observation?: string | null;
  },
) {
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
  if (input.result === 'FALLA' && !input.observation?.trim()) {
    throw new RuleError('Una falla sin observación no sirve: escribe qué encontraste.');
  }

  return prisma.checklistRunItem.update({
    where: { id: item.id },
    data: {
      result: input.result as ChecklistItemResult,
      observation: input.observation?.trim() || null,
    },
  });
}

/**
 * Cierra la ronda.
 *
 * No se puede cerrar con puntos sin revisar: una lista a medias da la
 * impresión de haberse recorrido sin haberlo hecho, que es peor que no tenerla.
 */
export async function finishRun(user: CurrentUser, input: { runId: string; notes?: string | null }) {
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

  const failures = run.items.filter((item) => item.result === ChecklistItemResult.FALLA);
  const criticalFailures = failures.filter((item) => item.critical);

  const closed = await prisma.checklistRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), notes: input.notes?.trim() || null },
    include: runInclude,
  });

  await recordAudit({
    entity: 'ChecklistRun',
    entityId: run.id,
    action: AuditAction.CERRAR,
    user,
    summary:
      `Ronda «${run.templateName}» cerrada: ${failures.length} falla(s)` +
      (criticalFailures.length > 0 ? `, ${criticalFailures.length} crítica(s)` : '') +
      `${input.notes ? `. ${input.notes}` : ''}`,
  });

  return { run: closed, failures: failures.length, criticalFailures: criticalFailures.length };
}

/** Rondas recientes, para el tablero del Supervisor. */
export async function listRuns(limit = 20): Promise<RunWithItems[]> {
  return prisma.checklistRun.findMany({
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
