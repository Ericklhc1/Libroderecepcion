import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import {assertEntryWorkDestination} from './entry-visibility';
import { EntryType, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Una incidencia no es sólo una etiqueta: siempre nace con una tarea y un
 * seguimiento. Desde v1.4.0 no resuelve ni hereda contexto PMS.
 */
export async function ensureIncidentWorkflow(entryId: string, client?: Prisma.TransactionClient, options: { leaveUnassigned?: boolean } = {}): Promise<void> {
  if (!client) return prisma.$transaction(tx => ensureIncidentWorkflow(entryId, tx, options));
  const tx = client;
  await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id" = ${entryId} FOR UPDATE`;
  const entry = await readEntries(tx, {engine:"incident"}).findUnique({
    where: { id: entryId },
    select: {
      id: true,
      humanId: true,
      type: true,
      title: true,
      description: true,
      priority: true,
      dueAt: true,
      ownerId: true,
      createdById: true,
      departmentId: true,
      shiftId: true,
    },
  });
  if (!entry || entry.type !== EntryType.INCIDENCIA) return;

  const ownerId = entry.ownerId ?? (options.leaveUnassigned ? null : entry.createdById);
  {
    const task = await tx.task.findFirst({
      where: { entryId: entry.id, deletedAt: null },
      select: { id: true },
    });
    const followUp = await tx.followUp.findFirst({
      where: { entryId: entry.id, deletedAt: null },
      select: { id: true },
    });
    if(!task||!followUp)await assertEntryWorkDestination(tx,entry.id,entry.departmentId??'',ownerId??entry.createdById);
    const ensuredTask = task ?? await tx.task.create({
      data: {
        title: `Resolver incidencia: ${entry.title}`,
        description: entry.description,
        priority: entry.priority,
        dueAt: entry.dueAt,
        assigneeId: ownerId,
        createdById: entry.createdById,
        departmentId: entry.departmentId,
        shiftId: entry.shiftId,
        entryId: entry.id,
      },
      select: { id: true },
    });

    if (!followUp) {
      await tx.followUp.create({
        data: {
          action: `Dar seguimiento a incidencia #${entry.humanId}: ${entry.title}`,
          nextAction: 'Verificar resolución y cerrar únicamente cuando no queden pendientes.',
          scheduledAt: entry.dueAt,
          ownerId: ownerId ?? entry.createdById,
          createdById: entry.createdById,
          entryId: entry.id,
          taskId: ensuredTask.id,
        },
      });
    }

    await tx.operationalEntry.update({
      where: { id: entry.id },
      data: { requiresFollowUp: true },
    });
  }
}
