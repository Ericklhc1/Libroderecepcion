import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetOperationalData } from './helpers';
import { needsInstall, runInstall } from '@/server/services/install';
import { authenticate } from '@/server/services/auth';
import { AppError } from '@/server/errors';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '@/lib/permissions';
import { DEPARTMENTS } from '@/domain/catalog';

const DATOS = {
  hotelName: 'Hotel Costa Serena',
  name: 'Erick Herrera',
  password: 'ClaveSegura2026',
};

describe('instalación inicial', () => {
  beforeEach(async () => {
    await resetOperationalData();
  });

  it('ofrece la instalación mientras no exista ningún usuario', async () => {
    expect(await needsInstall()).toBe(true);
  });

  it('deja el sistema operativo: hotel, catálogo y Administrador de sistema', async () => {
    const { userId } = await runInstall(DATOS);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });
    expect(user.role.key).toBe(ROLE_KEYS.SYSTEM_ADMIN);
    // La instalación no pide correo: la cuenta es nombre, usuario y clave.
    expect(user.username).toBeTruthy();
    expect(user.isDemo).toBe(false);

    const hotel = await prisma.systemSetting.findUnique({ where: { key: 'hotel.name' } });
    expect(hotel?.value).toBe(DATOS.hotelName);

    expect(await prisma.department.count()).toBe(DEPARTMENTS.length);
    /*
      Se cuenta contra el catálogo, no contra un número escrito a mano: si se
      agrega un rol, la prueba debe seguir diciendo «se sembraron todos», no
      romperse por aritmética.
    */
    expect(await prisma.role.count()).toBe(ROLE_DEFINITIONS.length);
    expect(await prisma.rolePermission.count()).toBeGreaterThan(0);
  });

  it('deja la pantalla inerte y rechaza una segunda instalación', async () => {
    await runInstall(DATOS);

    expect(await needsInstall()).toBe(false);
    await expect(
      runInstall({ ...DATOS, name: 'Otra Persona' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await prisma.user.count()).toBe(1);
  });

  it('la cuenta creada puede iniciar sesión de inmediato', async () => {
    const { userId } = await runInstall(DATOS);

    /*
      Se entra con el USUARIO, no con el correo. La instalación lo deriva del
      nombre: «Erick Herrera» → EHerrera. Se comprueba aquí porque es el dato
      con el que la única cuenta del hotel podrá entrar el primer día.
    */
    const cuenta = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(cuenta.username).toBe('EHerrera');

    const session = await authenticate({
      username: '@eherrera',
      password: DATOS.password,
    });
    expect(session.userId).toBe(userId);
    expect(session.mustChangePassword).toBe(false);
  });

  it('registra la instalación en la auditoría', async () => {
    const { userId } = await runInstall(DATOS);

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: userId },
    });
    expect(log?.summary).toContain(DATOS.hotelName);
  });
});
