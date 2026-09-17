import 'server-only';
import { EntryType, RoomStayStage, RoomStayStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Una incidencia no es sólo una etiqueta: siempre nace con una tarea y un
 * seguimiento. Si viene desde una habitación, fija además la reserva/huésped
 * activos para que el pendiente pueda sobrevivir al check-out sin pertenecer
 * al próximo ocupante de ese número.
 */
export async function ensureIncidentWorkflow(entryId: string) {
  const entry = await prisma.operationalEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      priority: true,
      dueAt: true,
      ownerId: true,
      createdById: true,
      departmentId: true,
      shiftId: true,
      roomId: true,
      guestId: true,
      reservationId: true,
    },
  });
  if (!entry || entry.type !== EntryType.INCIDENCIA) return;

  let reservationId = entry.reservationId;
  let guestId = entry.guestId;
  if (entry.roomId && (!reservationId || !guestId)) {
    const stay = await prisma.roomStay.findFirst({
      where: {
        roomId: entry.roomId,
        deletedAt: null,
        stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
        status: { in: [RoomStayStatus.IN_HOUSE, RoomStayStatus.CHECK_OUT] },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        reservationRefId: true,
        reservationRef: { select: { guestId: true } },
      },
    });
    reservationId = reservationId ?? stay?.reservationRefId ?? null;
    guestId = guestId ?? stay?.reservationRef?.guestId ?? null;
    if (reservationId || guestId) {
      await prisma.operationalEntry.update({
        where: { id: entry.id },
        data: { reservationId, guestId },
      });
    }
  }

  const ownerId = entry.ownerId ?? entry.createdById;
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { entryId: entry.id, deletedAt: null },
      select: { id: true },
    });
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

    const followUp = await tx.followUp.findFirst({
      where: { entryId: entry.id, deletedAt: null },
      select: { id: true },
    });
    if (!followUp) {
      await tx.followUp.create({
        data: {
          action: `Dar seguimiento a incidencia #${entry.id}: ${entry.title}`,
          nextAction: 'Verificar resolución y cerrar únicamente cuando no queden pendientes.',
          scheduledAt: entry.dueAt,
          ownerId,
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
  });
}
