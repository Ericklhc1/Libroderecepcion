import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Prepara la base de datos de pruebas.
 *
 * Aplica las migraciones con `migrate deploy` (no destructivo) y siembra el
 * catálogo base. Los datos operativos los limpia cada archivo de pruebas con
 * `resetOperationalData()`, de modo que no hace falta borrar la base entera.
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Falta TEST_DATABASE_URL. Copia .env.example a .env y define la base de pruebas.',
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL no puede apuntar a la misma base que DATABASE_URL: las pruebas borran datos.',
    );
  }

  /*
    Prisma aplica las migraciones por la conexión directa cuando el esquema
    declara `directUrl`. Hay que redirigir las dos variables, o las migraciones
    de las pruebas terminarían aplicándose a la base de desarrollo.
  */
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = url;
  process.env.DIRECT_DATABASE_URL = url;
  const { seedCatalog, prisma } = await import('./helpers');
  await seedCatalog();
  await prisma.$disconnect();
}
