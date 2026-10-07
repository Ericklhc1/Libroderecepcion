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

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma;
}

/** Filtro reutilizable: excluye registros con eliminación lógica. */
export const notDeleted = { deletedAt: null } as const;

/** Canonical lifecycle filter for admin-cleanable data. Explicit deletedAt enables audited history. */
export const prisma: PrismaClient = basePrisma.$extends({
  name: 'admin-cleanup-visibility',
  query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    if (['Notification', 'CashAudit', 'HousekeepingRequest', 'ai_message', 'ai_memory'].includes(model)
      && ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany'].includes(operation)) {
      const input = args as { where?: Record<string, unknown> };
      if (!Object.prototype.hasOwnProperty.call(input.where ?? {}, 'deletedAt')) {
        input.where = { ...input.where, deletedAt: null };
      }
    }
    return query(args);
  } } },
}) as unknown as PrismaClient;
