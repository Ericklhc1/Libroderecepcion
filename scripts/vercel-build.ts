/**
 * Compilación en el servidor de despliegue.
 *
 * Normaliza los nombres de las variables de conexión, aplica las migraciones
 * pendientes y compila. Existe como script y no como una cadena de comandos en
 * package.json porque las variables que resuelve tienen que llegar a los
 * procesos siguientes, y eso no ocurre encadenando comandos con `&&`.
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
  ['Aplicando migraciones', 'npx prisma migrate deploy'],
  ['Compilando la aplicación', 'npx next build'],
];

for (const [label, command] of steps) {
  console.log(`\n▸ ${label}`);
  execSync(command, { stdio: 'inherit', env: process.env });
}
