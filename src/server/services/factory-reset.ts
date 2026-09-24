import 'server-only';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Dejar el sistema en cero para empezar a operar de verdad.
 *
 * **Qué problema resuelve.** Antes de la puesta en marcha la base arrastra todo
 * lo de las pruebas: turnos de ensayo, novedades inventadas, cuentas demo,
 * estadías de informes viejos. Empezar a operar sobre eso es arrancar con el
 * libro sucio, y limpiarlo a mano por base de datos es la clase de cosa que
 * borra de más.
 *
 * **Qué NO es.** No es la eliminación lógica del resto del sistema, donde nada
 * se borra nunca. Esto es un gesto de INSTALACIÓN, no de operación: se ejecuta
 * una vez, antes de que existan datos reales, y por eso sí borra de verdad. Las
 * dos cosas conviven porque son momentos distintos, y la diferencia se protege
 * con tres cierres:
 *
 *   · sólo `system.configure` —el Administrador de sistema—;
 *   · hay que escribir la frase exacta, no basta un botón;
 *   · queda UNA entrada de auditoría que lo cuenta, y esa entrada sobrevive.
 *
 * **Qué conserva.** El catálogo, que es la instalación del hotel: roles,
 * permisos, áreas, las 89 habitaciones, las 101 llaves, las denominaciones de
 * efectivo y los parámetros. Y **la cuenta que lo ejecuta**, o el hotel se
 * quedaría sin poder entrar a su propio sistema.
 */

/** La frase que hay que escribir. En español y sin ambigüedad. */
export const RESET_PHRASE = 'DEJAR EN CERO';

export type ResetScope = {
  /** Borra también las estadías y los lotes de informes del PMS. */
  includeStays: boolean;
  /** Borra las demás cuentas de usuario. La propia nunca se borra. */
  includeUsers: boolean;
};

export type ResetSummary = {
  /** Cuántas filas se borraron, por grupo, para poder informarlo. */
  deleted: Record<string, number>;
  total: number;
  keptUser: string;
};

/** Lo que hay hoy, para poder mostrarlo ANTES de tocar nada. */
export async function getResetPreview() {
  const [
    entries,
    tasks,
    followUps,
    alerts,
    comments,
    shifts,
    handovers,
    stays,
    batches,
    fines,
    guests,
    reservations,
    announcements,
    checklistRuns,
    checklistTemplates,
    cashCounts,
    notifications,
    auditLogs,
    performanceObservations,
    correctiveMeasures,
    taskAssignments,
    cashMovements,
    cashAudits,
    gymPasses,
    auditFindings,
    auditParticipants,
    supervisionNotes,
    supervisionShifts,
    supervisionHandovers,
    frontiConversations,
    frontiMemories,
    frontiConfirmations,
    users,
    assignedKeys,
  ] = await Promise.all([
    prisma.operationalEntry.count(),
    prisma.task.count(),
    prisma.followUp.count(),
    prisma.alert.count(),
    prisma.comment.count(),
    prisma.shift.count(),
    prisma.shiftHandover.count(),
    prisma.roomStay.count(),
    prisma.pmsImportBatch.count(),
    prisma.fine.count(),
    prisma.guestReference.count(),
    prisma.reservationReference.count(),
    prisma.announcement.count(),
    prisma.checklistRun.count(),
    prisma.checklistTemplate.count(),
    prisma.cashCount.count(),
    prisma.notification.count(),
    prisma.auditLog.count(),
    prisma.performanceObservation.count(),
    prisma.correctiveMeasure.count(),
    prisma.taskAssignment.count(),
    prisma.cashMovement.count(),
    prisma.cashAudit.count(),
    prisma.gymPass.count(),
    prisma.auditFinding.count(),
    prisma.auditParticipant.count(),
    prisma.supervisionNote.count(),
    prisma.supervisionShift.count(),
    prisma.supervisionShiftHandover.count(),
    prisma.ai_conversation.count(),
    prisma.ai_memory.count(),
    prisma.assistantActionReceipt.count(),
    prisma.user.count(),
    prisma.roomKey.count({ where: { stayId: { not: null } } }),
  ]);

  return {
    entries,
    tasks,
    followUps,
    alerts,
    comments,
    shifts,
    handovers,
    stays,
    batches,
    fines,
    guests,
    reservations,
    announcements,
    checklistRuns,
    checklistTemplates,
    cashCounts,
    notifications,
    auditLogs,
    performanceObservations,
    correctiveMeasures,
    taskAssignments,
    cashMovements,
    cashAudits,
    gymPasses,
    auditFindings,
    auditParticipants,
    supervisionNotes,
    supervisionShifts,
    supervisionHandovers,
    frontiConversations,
    frontiMemories,
    frontiConfirmations,
    users,
    assignedKeys,
  };
}

/**
 * Ejecuta la puesta en cero.
 *
 * El ORDEN no es decorativo: casi todo referencia al usuario que lo creó con
 * clave ajena RESTRICT, así que borrar cuentas antes que sus registros
 * revienta. Es el mismo orden que usa `resetOperationalData` en las pruebas, y
 * por eso se mantiene junto: si divergieran, las pruebas dejarían de estar
 * ejercitando el orden que corre en producción.
 *
 * Las llaves **no se borran** —son catálogo, cuestan dinero y están numeradas—
 * pero se DESLIGAN de la estadía y vuelven a disponible, que es su estado de
 * inventario.
 */
export async function runFactoryReset(
  user: CurrentUser,
  input: { phrase: string; scope: ResetScope },
): Promise<ResetSummary> {
  if (input.phrase.trim().toUpperCase() !== RESET_PHRASE) {
    throw new RuleError(
      `Para dejar el sistema en cero hay que escribir exactamente «${RESET_PHRASE}». ` +
        'Es a propósito: esto borra de verdad y no se puede deshacer.',
    );
  }

  const deleted: Record<string, number> = {};
  const count = (label: string, result: { count: number }) => {
    if (result.count > 0) deleted[label] = result.count;
    return result.count;
  };

  /*
    Se hace en UNA transacción: una puesta en cero a medias —los turnos
    borrados y las novedades no— sería peor que no haberla hecho, porque
    dejaría el libro incoherente. El `timeout` es generoso porque puede haber
    miles de filas y la base está en otra región.
  */
  await prisma.$transaction(
    async (tx) => {
      // Tablas auxiliares que se crean por migración SQL y cuelgan de
      // usuarios/turnos. Deben vaciarse antes de borrar sus padres.
      count('Borradores de reserva', {
        count: await tx.$executeRawUnsafe('DELETE FROM "ReservationPdfDraft"'),
      });
      count('Cierres de Caja por turno', {
        count: await tx.$executeRawUnsafe('DELETE FROM "ShiftCashClosure"'),
      });

      // --- Lo que cuelga de otras cosas, primero. ---
      count('Movimientos de llave', await tx.keyMovement.deleteMany());
      // Las llaves vuelven al inventario en lugar de borrarse: son catálogo.
      await tx.roomKey.updateMany({
        data: { stayId: null, status: 'DISPONIBLE', assignedAt: null, assignedById: null },
      });

      count('Notificaciones', await tx.notification.deleteMany());
      count('Confirmaciones de Fronti', await tx.assistantActionReceipt.deleteMany());
      count('Mensajes de Fronti', await tx.ai_message.deleteMany());
      count('Memorias de Fronti', await tx.ai_memory.deleteMany());
      count('Conversaciones de Fronti', await tx.ai_conversation.deleteMany());
      count('Observaciones de rendimiento', await tx.performanceObservation.deleteMany());
      count('Adjuntos', await tx.attachment.deleteMany());
      count('Reacciones de chat', await tx.chatReaction.deleteMany());
      count('Mensajes guardados de chat', await tx.chatSavedMessage.deleteMany());
      count('Indicadores de escritura', await tx.chatTyping.deleteMany());
      count('Preferencias multimedia de chat', await tx.chatMediaPreference.deleteMany());
      count('Mensajes de chat', await tx.chatMessage.deleteMany());
      count('Participantes de chat', await tx.chatParticipant.deleteMany());
      count('Conversaciones de chat', await tx.chatConversation.deleteMany());
      count('Stickers de chat', await tx.chatSticker.deleteMany());
      count('Comentarios', await tx.comment.deleteMany());
      count('Pasos de tarea', await tx.taskChecklistItem.deleteMany());
      count('Alertas', await tx.alert.deleteMany());
      count('Medidas correctivas', await tx.correctiveMeasure.deleteMany());
      count('Asignaciones de tarea', await tx.taskAssignment.deleteMany());
      count('Seguimientos', await tx.followUp.deleteMany());
      count('Tareas', await tx.task.deleteMany());
      count('Movimientos de Caja', await tx.cashMovement.deleteMany());
      count('Auditorías de Caja', await tx.cashAudit.deleteMany());
      count('Pases de gimnasio', await tx.gymPass.deleteMany());
      count('Multas', await tx.fine.deleteMany());
      count('Registros del libro', await tx.operationalEntry.deleteMany());

      // Auditorías sorpresa: los hallazgos/participantes cuelgan de las
      // ejecuciones de checklist y deben salir antes que ellas.
      count('Hallazgos de auditoría', await tx.auditFinding.deleteMany());
      count('Participantes de auditoría', await tx.auditParticipant.deleteMany());

      // Checklists: las rondas y también las plantillas, que las arma cada
      // Supervisor y no son catálogo del sistema.
      count('Puntos de ronda', await tx.checklistRunItem.deleteMany());
      count('Rondas de supervisión', await tx.checklistRun.deleteMany());
      count('Puntos de plantilla', await tx.checklistTemplateItem.deleteMany());
      count('Listas de control', await tx.checklistTemplate.deleteMany());

      count('Lecturas de comunicado', await tx.announcementRead.deleteMany());
      count('Comunicados', await tx.announcement.deleteMany());
      count('Notas de Supervisión', await tx.supervisionNote.deleteMany());

      // Caja: antes de la entrega y de los usuarios.
      count('Líneas de arqueo', await tx.cashCountLine.deleteMany());
      count('Arqueos', await tx.cashCount.deleteMany());
      count('Transferencias a Tesorería', await tx.cashTransfer.deleteMany());
      count('Elementos de entrega', await tx.handoverElement.deleteMany());

      count('Puntos de entrega', await tx.handoverItem.deleteMany());
      count('Entregas de turno', await tx.shiftHandover.deleteMany());
      count('Asignaciones de turno', await tx.shiftAssignment.deleteMany());
      count('Turnos', await tx.shift.deleteMany());

      // El turno del Supervisor es una raíz independiente del turno de
      // Recepción y también forma parte de la operación que se reinicia.
      count('Entregas de Supervisión', await tx.supervisionShiftHandover.deleteMany());
      count('Turnos de Supervisión', await tx.supervisionShift.deleteMany());

      if (input.scope.includeStays) {
        count('Estadías', await tx.roomStay.deleteMany());
        count('Lotes de informes del PMS', await tx.pmsImportBatch.deleteMany());
      }

      count('Garantías', await tx.guarantee.deleteMany());
      count('Reservas', await tx.reservationReference.deleteMany());
      count('Huéspedes', await tx.guestReference.deleteMany());

      count('Intentos de acceso', await tx.loginAttempt.deleteMany());

      if (input.scope.includeUsers) {
        /*
          La cuenta que ejecuta esto NUNCA se borra: si se borrara, el hotel se
          quedaría sin forma de entrar a su propio sistema, y no habría manera
          de arreglarlo desde dentro.
        */
        count(
          'Sesiones',
          await tx.session.deleteMany({ where: { userId: { not: user.id } } }),
        );
        count(
          'Cuentas de usuario',
          await tx.user.deleteMany({ where: { id: { not: user.id } } }),
        );
      }

      /*
        La auditoría se borra AL FINAL y a propósito: es historia de las
        pruebas, no del hotel, y dejarla haría que el primer día de operación
        empezara con cien movimientos que nadie hizo. La entrada que registra
        esta misma puesta en cero se escribe DESPUÉS de la transacción, así que
        sobrevive: queda constancia de que esto ocurrió y de quién lo hizo.
      */
      count('Auditoría', await tx.auditLog.deleteMany());
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  const total = Object.values(deleted).reduce((sum, value) => sum + value, 0);

  await recordAudit({
    entity: 'SystemSetting',
    entityId: 'puesta-en-cero',
    action: AuditAction.CONFIGURAR,
    user,
    summary:
      `Sistema dejado en cero para la puesta en marcha: ${total} registro(s) eliminados. ` +
      `${input.scope.includeStays ? 'Incluyó' : 'Conservó'} las estadías y los informes del PMS. ` +
      `${input.scope.includeUsers ? 'Eliminó' : 'Conservó'} las demás cuentas. ` +
      'El catálogo (roles, permisos, áreas, habitaciones, llaves y parámetros) se conserva.',
    after: { deleted, total },
  });

  return { deleted, total, keptUser: user.name };
}
