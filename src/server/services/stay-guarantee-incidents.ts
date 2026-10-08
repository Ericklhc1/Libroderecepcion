import 'server-only';
import {AlertLevel,AlertStatus,AlertType,AuditAction,EntryStatus,EntryType,GuaranteeState,Impact,Priority,Severity} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {recordAudit} from '@/server/audit';
import type {CurrentUser} from '@/server/auth/current-user';
import {readEntries} from './entry-visibility';
import {createNativeEntry,lockNativeNoveltyCreation} from './native-entry-creation';
/**
 * Una garantía que sobrevive al check-out ya no es sólo una alerta: es una
 * incidencia económica trazable. Se crea una sola vez, con área relacionada
 * en modo simple o responsable inicial en el modo anterior. Se liga a reserva/huésped, no a la
 * habitación física, para que nunca contamine al huésped siguiente.
 */
export async function ensureUnresolvedGuaranteeIncidents(
  user: CurrentUser,
  reservationRefId: string | null,
  roomNumber: string | null,
): Promise<number> {
  if (!reservationRefId) return 0;

  const guarantees = await prisma.guarantee.findMany({
    where: {
      reservationReferenceId: reservationRefId,
      deletedAt: null,
      state: {
        in: [
          GuaranteeState.PENDIENTE,
          GuaranteeState.VIGENTE,
          GuaranteeState.APLICADA_PARCIALMENTE,
        ],
      },
    },
    select: { id:true },
  });

  let created = 0;
  for (const candidate of guarantees) {
    const marker = `garantia-post-salida:${candidate.id}`;

    const didCreate=await prisma.$transaction(async (tx) => {
      await lockNativeNoveltyCreation(tx);
      await tx.$queryRaw`SELECT "id" FROM "Guarantee" WHERE "id"=${candidate.id} FOR UPDATE`;
      const guarantee=await tx.guarantee.findFirst({
        where:{id:candidate.id,reservationReferenceId:reservationRefId,deletedAt:null,state:{in:[GuaranteeState.PENDIENTE,GuaranteeState.VIGENTE,GuaranteeState.APLICADA_PARCIALMENTE]}},
        include:{reservationReference:{select:{code:true,guestId:true,guest:{select:{fullName:true}}}}},
      });
      // Caja may have resolved, removed or reassociated it after the candidate scan.
      const reservation=guarantee?.reservationReference;
      if(!guarantee||!reservation)return false;
      const existing=await readEntries(tx,{engine:'lifecycle'}).findFirst({where:{deletedAt:null,tags:{has:marker}},select:{id:true}});
      if(existing)return false;
      const guestName = reservation.guest?.fullName ?? 'Huésped';
      const entry = await createNativeEntry(tx,{
        data: {
          type: EntryType.INCIDENCIA,
          status: EntryStatus.ABIERTO,
          title: `Garantía sin resolver tras check-out · reserva ${reservation.code}`,
          description:
            `La salida fue confirmada con una garantía todavía en estado ${guarantee.state}. ` +
            `${guestName}${roomNumber ? ` · habitación ${roomNumber}` : ''}. ` +
            `Monto registrado: ${guarantee.currency} ${guarantee.amount.toString()}. ` +
            'Debe devolverse, aplicarse o cerrarse con respaldo antes de dar por terminada la incidencia.',
          category: 'GARANTIA_POST_SALIDA',
          reservationId: reservationRefId,
          guestId: reservation.guestId,
          priority: Priority.CRITICA,
          severity: Severity.CRITICA,
          impact: Impact.ECONOMICO,
          immediateAction: 'Resolver el estado final de la garantía y dejar respaldo de la decisión.',
          ownerId: user.id,
          occurredAt: new Date(),
          tags: ['garantia', 'post-checkout', marker],
          requiresFollowUp: true,
          createdById: user.id,
        },
      });

      await tx.alert.upsert({
        where: { dedupeKey: `guarantee-unresolved-checkout:${guarantee.id}` },
        create: {
          dedupeKey: `guarantee-unresolved-checkout:${guarantee.id}`,
          type: AlertType.GARANTIA_SIN_RESOLVER_EN_SALIDA,
          level: AlertLevel.CRITICA,
          status: AlertStatus.NUEVA,
          title: `Garantía sin resolver tras check-out: ${guestName}`,
          message: `Reserva ${reservation.code}. Incidencia #${entry.humanId} ${entry.ownerId?`asignada inicialmente a ${user.name}`:'relacionada con Recepción, sin asignación individual'}.`,
          entryId: entry.id,
          reservationId: reservationRefId,
          guestId: reservation.guestId,
          guaranteeId: guarantee.id,
          auto: true,
        },
        update: {
          level: AlertLevel.CRITICA,
          status: AlertStatus.NUEVA,
          title: `Garantía sin resolver tras check-out: ${guestName}`,
          message: `Reserva ${reservation.code}. Incidencia #${entry.humanId} ${entry.ownerId?`asignada inicialmente a ${user.name}`:'relacionada con Recepción, sin asignación individual'}.`,
          entryId: entry.id,
          reservationId: reservationRefId,
          guestId: reservation.guestId,
          guaranteeId: guarantee.id,
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
          deletedAt: null,
        },
      });

      await recordAudit(
        {
          entity: 'OperationalEntry',
          entityId: entry.id,
          action: AuditAction.CREAR,
          user,
          summary: `Incidencia automática por garantía ${guarantee.id} abierta después del check-out`,
          after: {
            reservationId: reservationRefId,
            guaranteeId: guarantee.id,
            ownerId: entry.ownerId,
            state: guarantee.state,
          },
        },
        tx,
      );
      return true;
    });
    if(didCreate)created += 1;
  }
  return created;
}
