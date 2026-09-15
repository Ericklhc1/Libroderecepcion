/**
 * Crea un Administrador de sistema real (no demo).
 *
 *   npx tsx scripts/create-admin.ts "Nombre Apellido" correo@hotel.com "ContraseñaSegura1"
 *
 * Si se omite la contraseña se genera una aleatoria y se imprime una sola vez.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS } from '../src/lib/permissions';

const prisma = new PrismaClient();

function assertPassword(password: string) {
  const ok =
    password.length >= 10 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password);
  if (!ok) {
    throw new Error(
      'La contraseña debe tener al menos 10 caracteres, con mayúscula, minúscula y número.',
    );
  }
}

async function main() {
  const [name, email, providedPassword] = process.argv.slice(2);
  if (!name || !email) {
    console.error(
      'Uso: npx tsx scripts/create-admin.ts "Nombre Apellido" correo@hotel.com ["ContraseñaSegura1"]',
    );
    process.exit(1);
  }

  const password =
    providedPassword ?? `${crypto.randomBytes(9).toString('base64url')}Aa1`;
  assertPassword(password);

  const role = await prisma.role.findUnique({ where: { key: ROLE_KEYS.SYSTEM_ADMIN } });
  if (!role) {
    throw new Error('El rol Administrador de sistema no existe. Ejecuta primero `npm run db:seed`.');
  }

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      name,
      roleId: role.id,
      passwordHash: await bcrypt.hash(password, 12),
      active: true,
      isDemo: false,
      deletedAt: null,
      mustChangePassword: true,
    },
    create: {
      name,
      email: email.toLowerCase(),
      roleId: role.id,
      passwordHash: await bcrypt.hash(password, 12),
      isDemo: false,
      mustChangePassword: true,
    },
  });

  console.log(`✔ Administrador de sistema listo: ${user.name} <${user.email}>`);
  if (!providedPassword) {
    console.log(`  Contraseña temporal (cámbiala al entrar): ${password}`);
  }
}

main()
  .catch((error) => {
    console.error(`✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
