import { PrismaClient } from '@prisma/client';
import { normalizeDatabaseEnv } from './database-url';

/*
  Se resuelven los nombres de las variables de conexión antes de crear el
  cliente: según cómo se haya conectado la base, el proveedor las publica con
  nombres distintos y el esquema de Prisma sólo conoce dos.
*/
normalizeDatabaseEnv();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Filtro reutilizable: excluye registros con eliminación lógica. */
export const notDeleted = { deletedAt: null } as const;
