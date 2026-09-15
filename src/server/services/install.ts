import 'server-only';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { hashPassword } from '@/server/auth/password';
import { seedCatalog } from '@/domain/catalog';
import { suggestUsername } from '@/domain/username';
import { ROLE_KEYS } from '@/lib/permissions';

/**
 * Instalación inicial de un despliegue.
 *
 * Existe para que poner en marcha el sistema no exija una consola: el primer
 * visitante crea el hotel y su Administrador de sistema desde el navegador.
 *
 * La pantalla queda inerte en cuanto existe un usuario, y la comprobación se
 * repite dentro de la transacción que crea la cuenta: dos personas abriendo la
 * instalación a la vez no pueden crear dos administradores.
 */
export async function needsInstall(): Promise<boolean> {
  const users = await prisma.user.count();
  return users === 0;
}

export async function runInstall(input: {
  hotelName: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ userId: string }> {
  if (!(await needsInstall())) {
    throw new AppError(
      'El sistema ya está instalado. Inicia sesión con tu cuenta.',
      'ALREADY_INSTALLED',
    );
  }

  const passwordHash = await hashPassword(input.password);
  const email = input.email.trim().toLowerCase();

  const user = await prisma.$transaction(
    async (tx) => {
    // Cierre de la carrera: si otra instalación se adelantó, esta se detiene.
    if ((await tx.user.count()) > 0) {
      throw new AppError('El sistema ya está instalado.', 'ALREADY_INSTALLED');
    }

    await seedCatalog(tx, { hotelName: input.hotelName.trim() });

    const role = await tx.role.findUniqueOrThrow({
      where: { key: ROLE_KEYS.SYSTEM_ADMIN },
    });

    return tx.user.create({
      data: {
        name: input.name.trim(),
        username: suggestUsername(input.name),
        email,
        passwordHash,
        roleId: role.id,
        isDemo: false,
        mustChangePassword: false,
      },
    });
    },
    /*
      La base de datos puede estar lejos del servidor que ejecuta esto. El
      plazo por omisión de cinco segundos no alcanza para sembrar el catálogo
      completo cuando cada consulta cruza un océano, y el catálogo tiene que
      quedar entero o no quedar: si se cortara a medias, el sistema arrancaría
      con roles sin permisos.
    */
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recordAudit({
    entity: 'User',
    entityId: user.id,
    action: AuditAction.CONFIGURAR,
    summary: `Instalación inicial de ${input.hotelName.trim()}: se creó el Administrador de sistema ${user.name}`,
  });

  return { userId: user.id };
}
