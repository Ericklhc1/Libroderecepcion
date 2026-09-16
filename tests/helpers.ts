import { AssignmentRole, PrismaClient, ShiftStatus, ShiftType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS, type PermissionKey, type RoleKey } from '@/lib/permissions';
import { seedCatalog as domainSeedCatalog } from '@/domain/catalog';
import type { CurrentUser } from '@/server/auth/current-user';
import { plannedWindow } from '@/domain/shift';

export const prisma = new PrismaClient();

export const TEST_PASSWORD = 'PruebaSegura1';

/**
 * Catálogo base para las pruebas.
 *
 * Reutiliza la misma siembra que usan la instalación real y la semilla de
 * desarrollo: si hubiera una copia aparte, las pruebas podrían pasar contra un
 * catálogo que no existe en producción.
 */
export async function seedCatalog() {
  await domainSeedCatalog(prisma);
}

/**
 * Borra los datos que genera la operación y deja el catálogo intacto.
 *
 * Las estadías y los lotes de importación entran acá aunque hablen de
 * habitaciones: los crea la operación, no la siembra, y **referencian al
 * usuario que los creó**. Sin borrarlos, `user.deleteMany()` choca contra la
 * clave ajena de `PmsImportBatch` y revienta cualquier archivo de pruebas que
 * corra después de uno que haya importado algo.
 *
 * El orden importa: los movimientos de llave y las estadías antes que los
 * lotes, y las llaves se desligan de la estadía en lugar de borrarse, porque
 * son catálogo.
 */
export async function resetOperationalData() {
  await prisma.$transaction([
    prisma.keyMovement.deleteMany(),
    prisma.roomKey.updateMany({ data: { stayId: null } }),
    prisma.roomStay.deleteMany(),
    prisma.pmsImportBatch.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.taskChecklistItem.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.followUp.deleteMany(),
    prisma.task.deleteMany(),
    /*
      Caja viva, folios de gimnasio y memoria del asistente.

      Van ACÁ, antes del registro del libro, y el orden entre ellas tampoco es
      libre: el movimiento de caja apunta al folio, y el folio apunta al
      registro del libro, a la reserva, a la habitación y al recepcionista con
      clave ajena RESTRICT. Faltaban por completo, y eso no hacía fallar una
      prueba: hacía fallar VEINTIÚN archivos enteros en su `beforeAll`, porque
      `user.deleteMany()` chocaba contra `CashMovement_createdById_fkey` y el
      fallo real quedaba tapado por un error de clave ajena.

      Las tres del asistente se borran en cascada desde la conversación, pero
      se nombran igual: si mañana alguien quita la cascada, esta prueba avisa
      en lugar de dejar memoria de un turno viva entre archivos.
    */
    prisma.cashMovement.deleteMany(),
    prisma.cashAudit.deleteMany(),
    prisma.gymPass.deleteMany(),
    prisma.ai_message.deleteMany(),
    prisma.ai_memory.deleteMany(),
    prisma.ai_conversation.deleteMany(),
    prisma.operationalEntry.deleteMany(),
    // Las multas referencian la habitación, la estadía y al usuario que las
    // creó, con clave ajena RESTRICT: van antes que todos ellos.
    prisma.fine.deleteMany(),
    /*
      Las rondas de checklist referencian al usuario que las recorrió y al
      turno, y las plantillas al usuario que las creó: van antes que ambos.
      La PLANTILLA no es catálogo —la arma cada Supervisor— así que también
      se limpia, o el conjunto de pruebas dependería del orden de los
      archivos.
    */
    prisma.checklistRunItem.deleteMany(),
    prisma.checklistRun.deleteMany(),
    prisma.checklistTemplateItem.deleteMany(),
    prisma.checklistTemplate.deleteMany(),
    // Los comunicados y sus confirmaciones referencian al usuario: van antes.
    prisma.announcementRead.deleteMany(),
    prisma.announcement.deleteMany(),
    /*
      La configuración de correo se borra por la MISMA razón que `CashFund`: su
      existencia cambia el comportamiento —con SMTP guardado, `isMailConfigured`
      da verdadero— y dejarla viva haría que la prueba de credenciales pasara o
      fallara según qué archivo corriera antes.
    */
    prisma.mailSettings.deleteMany(),
    prisma.handoverItem.deleteMany(),
    /*
      La caja va ANTES de la entrega y de los usuarios: los arqueos y los
      egresos referencian a quien contó con clave ajena RESTRICT, así que
      borrar usuarios sin borrarlos antes reventaría.

      `CashFund` y `HandoverElementType` también se borran aunque parezcan
      catálogo: NO lo son, son configuración del hotel, y la existencia de un
      fondo es lo que activa la exigencia de arqueo. La migración los siembra
      para producción, de modo que si no se limpiaran acá el conjunto de
      pruebas daría un resultado distinto según el orden en que corrieran los
      archivos: las del ciclo de turno fallarían si se ejecutaran antes que
      las de caja. Cada prueba que necesita fondo lo siembra ella.
    */
    prisma.cashCountLine.deleteMany(),
    prisma.cashCount.deleteMany(),
    prisma.cashTransfer.deleteMany(),
    prisma.handoverElement.deleteMany(),
    prisma.cashFund.deleteMany(),
    prisma.handoverElementType.deleteMany(),
    /*
      `SystemSetting` entra por la MISMA razón que `CashFund`: parece catálogo
      y es configuración. Un ajuste del sistema —el precio del pase de
      gimnasio, por ejemplo— cambia el resultado de la prueba que lo cobra, y
      dejarlo vivo hace que el conjunto dependa del orden de los archivos, que
      es el error más difícil de encontrar.

      `CashDenomination` NO entra, y la distinción importa: las denominaciones
      son los billetes y monedas que existen en Chile, no una decisión del
      hotel. Se sembraron acá por error al arreglar esto y nueve pruebas de
      caja se cayeron, porque sin denominaciones no se puede armar un arqueo.
      `caja-turno.test.ts` lo deja escrito.
    */
    prisma.systemSetting.deleteMany(),
    prisma.shiftHandover.deleteMany(),
    prisma.shiftAssignment.deleteMany(),
    prisma.shift.deleteMany(),
    // Las garantías referencian al usuario que las creó: van antes.
    prisma.guarantee.deleteMany(),
    prisma.reservationReference.deleteMany(),
    prisma.guestReference.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

/**
 * Devuelve el inventario de habitaciones y llaves a su estado sembrado.
 *
 * Habitaciones y llaves son catálogo, así que `resetOperationalData` no las
 * borra. Pero una prueba que agrega una llave extra —para provocar el
 * conflicto de dos principales, por ejemplo— la deja ahí para todos los
 * archivos que corran después, sobre la misma base. Este reinicio lo evita, y
 * se comparte en lugar de repetirse en cada archivo.
 *
 * Hay que llamarlo **antes** de volver a sembrar.
 */
export async function resetRoomsAndKeys() {
  // Las multas cuelgan de la habitación: sin borrarlas, no se puede borrar.
  await prisma.fine.deleteMany();
  /*
    Y los folios de gimnasio y los movimientos de caja también apuntan a la
    habitación, el folio con RESTRICT. Van antes, y el movimiento antes que el
    folio.
  */
  await prisma.cashMovement.deleteMany();
  await prisma.gymPass.deleteMany();
  await prisma.keyMovement.deleteMany();
  await prisma.roomKey.updateMany({ data: { stayId: null } });
  await prisma.roomStay.deleteMany();
  await prisma.pmsImportBatch.deleteMany();
  await prisma.roomKey.deleteMany();
  await prisma.room.deleteMany();
}

export async function createUser(options: {
  roleKey: RoleKey;
  name?: string;
  password?: string;
  active?: boolean;
  username?: string;
  /* El usuario es la identidad de la cuenta y lo único que la identifica:
     las cuentas no tienen correo. */
}): Promise<CurrentUser & { passwordPlain: string; username: string }> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: options.roleKey },
    include: { permissions: { include: { permission: true } } },
  });
  const password = options.password ?? TEST_PASSWORD;

  const user = await prisma.user.create({
    data: {
      name: options.name ?? `Usuario ${role.name}`,
      username:
        options.username ??
        `U${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      passwordHash: await bcrypt.hash(password, 4),
      roleId: role.id,
      active: options.active ?? true,
    },
  });

  return {
    id: user.id,
    name: user.name,
    sessionId: 'sesion-de-prueba',
    roleId: role.id,
    roleKey: role.key,
    roleName: role.name,
    roleLevel: role.level,
    roleOperational: role.operational,
    departmentId: null,
    mustChangePassword: false,
    permissions: role.permissions.map((rp) => rp.permission.key as PermissionKey),
    isSystemAdmin: role.key === ROLE_KEYS.SYSTEM_ADMIN,
    passwordPlain: password,
    username: user.username,
  };
}

/** Crea un turno programado y asigna al usuario como titular. */
export async function createShift(options: {
  userId?: string;
  type: ShiftType;
  dayOffset?: number;
  status?: ShiftStatus;
}) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + (options.dayOffset ?? 0));
  const window = plannedWindow(date, options.type);

  return prisma.shift.create({
    data: {
      date,
      type: options.type,
      status: options.status ?? ShiftStatus.PROGRAMADO,
      plannedStart: window.start,
      plannedEnd: window.end,
      ...(options.userId
        ? {
            assignments: {
              create: [{ userId: options.userId, role: AssignmentRole.TITULAR }],
            },
          }
        : {}),
    },
    include: { assignments: true },
  });
}

/**
 * Abre un turno en las pruebas.
 *
 * Envuelve `openShift`, que es el único camino real: crea el turno si no hay
 * ninguno en curso, o suma a la persona al que ya está abierto. Acepta una fila
 * de turno completa además de `{type, date}`, para que las pruebas puedan
 * pasarle el turno que crearon con `createShift`.
 */
export async function openShiftAs(
  user: CurrentUser,
  slot?: { type?: ShiftType; date?: Date },
) {
  const { openShift } = await import('@/server/services/shifts');
  const result = await openShift(user, {
    type: slot?.type ?? null,
    date: slot?.date ?? null,
  });
  return result.shift;
}

/**
 * Deja la pizarra de turnos limpia.
 *
 * Hace falta porque ahora hay un índice único parcial que permite UN SOLO
 * turno en curso en toda la base: sin esto, un archivo de pruebas que dejó un
 * turno activo hace fallar al siguiente con un error de índice en lugar de con
 * el fallo que se estaba buscando.
 */
export async function closeAllShifts() {
  await prisma.shift.updateMany({
    where: { status: { in: [ShiftStatus.INICIADO, ShiftStatus.ACTIVO, ShiftStatus.PREPARANDO_ENTREGA] } },
    data: { status: ShiftStatus.CERRADO },
  });
}

export { ROLE_KEYS, ShiftStatus, ShiftType };
