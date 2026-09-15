/**
 * Elimina definitivamente los datos demo para comenzar producción.
 *
 * Sólo borra filas marcadas con `isDemo = true`. El catálogo base (permisos,
 * roles, áreas y parámetros) se conserva.
 *
 * Por seguridad, exige que exista al menos un Administrador de sistema real
 * (no demo) antes de borrar los usuarios demo: así el sistema nunca queda sin
 * acceso administrativo. Crear uno con `npx tsx scripts/create-admin.ts`.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ROLE_KEYS } from '../src/lib/permissions';

const prisma = new PrismaClient();

async function main() {
  const realAdmins = await prisma.user.count({
    where: {
      isDemo: false,
      active: true,
      deletedAt: null,
      role: { key: ROLE_KEYS.SYSTEM_ADMIN },
    },
  });

  if (realAdmins === 0) {
    console.error(
      '✖ No existe ningún Administrador de sistema real (no demo).\n' +
        '  Crea uno antes de purgar los datos demo:\n' +
        '    npx tsx scripts/create-admin.ts "Nombre" correo@hotel.com "ContraseñaSegura1"',
    );
    process.exit(1);
  }

  const demoUserIds = (
    await prisma.user.findMany({ where: { isDemo: true }, select: { id: true } })
  ).map((u) => u.id);

  // Orden inverso a las dependencias para no violar claves foráneas.
  const steps: Array<[string, () => Promise<{ count: number }>]> = [
    ['notificaciones', () => prisma.notification.deleteMany({ where: { isDemo: true } })],
    ['auditoría demo', () => prisma.auditLog.deleteMany({ where: { isDemo: true } })],
    ['adjuntos', () => prisma.attachment.deleteMany({ where: { isDemo: true } })],
    ['comentarios', () => prisma.comment.deleteMany({ where: { isDemo: true } })],
    ['ítems de checklist', () => prisma.taskChecklistItem.deleteMany({ where: { task: { isDemo: true } } })],
    ['alertas', () => prisma.alert.deleteMany({ where: { OR: [{ isDemo: true }, { auto: true }] } })],
    ['seguimientos', () => prisma.followUp.deleteMany({ where: { isDemo: true } })],
    ['tareas', () => prisma.task.deleteMany({ where: { isDemo: true } })],
    ['registros del libro', () => prisma.operationalEntry.deleteMany({ where: { isDemo: true } })],
    ['ítems de entrega', () => prisma.handoverItem.deleteMany({ where: { handover: { isDemo: true } } })],
    ['entregas de turno', () => prisma.shiftHandover.deleteMany({ where: { isDemo: true } })],
    ['asignaciones de turno', () => prisma.shiftAssignment.deleteMany({ where: { shift: { isDemo: true } } })],
    ['turnos', () => prisma.shift.deleteMany({ where: { isDemo: true } })],
    ['reservas de referencia', () => prisma.reservationReference.deleteMany({ where: { isDemo: true } })],
    ['huéspedes de referencia', () => prisma.guestReference.deleteMany({ where: { isDemo: true } })],
    ['sesiones demo', () => prisma.session.deleteMany({ where: { userId: { in: demoUserIds } } })],
    ['auditoría de usuarios demo', () => prisma.auditLog.deleteMany({ where: { userId: { in: demoUserIds } } })],
    ['notificaciones de usuarios demo', () => prisma.notification.deleteMany({ where: { userId: { in: demoUserIds } } })],
    ['usuarios demo', () => prisma.user.deleteMany({ where: { isDemo: true } })],
  ];

  for (const [label, run] of steps) {
    const result = await run();
    console.log(`  · ${label}: ${result.count}`);
  }

  console.log('✔ Datos demo eliminados. El catálogo base se mantiene intacto.');
}

main()
  .catch((error) => {
    console.error('✖ Error al purgar los datos demo', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
