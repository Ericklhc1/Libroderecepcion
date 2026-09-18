/**
 * Build canónico para hosts de despliegue.
 *
 * 1. Normaliza DATABASE_URL / DIRECT_DATABASE_URL.
 * 2. Genera Prisma.
 * 3. Aplica sólo migraciones versionadas.
 * 4. Compila Next.js.
 *
 * En Preview las variables de Netlify apuntan a una rama Neon aislada; en
 * Production apuntan exclusivamente a Neon Production.
 */
import { execSync } from 'node:child_process';
import { normalizeDatabaseEnv } from '../src/lib/database-url';

const result = normalizeDatabaseEnv(process.env);
if (!result.ok) {
  console.error(`\n✗ ${result.detail}\n`);
  process.exit(1);
}
console.log(`✔ ${result.detail}`);

const steps: Array<[string, string]> = [
  ['Generando el cliente de base de datos', 'npx prisma generate'],
  ['Aplicando migraciones versionadas', 'npx prisma migrate deploy'],
  ['Compilando la aplicación', 'npx next build'],
];

for (const [label, command] of steps) {
  console.log(`\n▸ ${label}`);
  execSync(command, { stdio: 'inherit', env: process.env });
}
