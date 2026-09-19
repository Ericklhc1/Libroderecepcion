import 'server-only';

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  CASH_APPROVAL_CAPABLE_PERMISSIONS,
  type CashApprovalCapablePermission,
} from '@/lib/permissions';
import { hasPermission, type CurrentUser } from '@/server/auth/current-user';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Tener permiso y requerir aprobación son controles independientes.
 * La aprobación está apagada por defecto.
 */
export async function cashApprovalRequired(
  user: Pick<CurrentUser, 'roleId' | 'permissions'>,
  permission: CashApprovalCapablePermission,
  client: Client = prisma,
): Promise<boolean> {
  if (!CASH_APPROVAL_CAPABLE_PERMISSIONS.includes(permission)) return false;
  if (hasPermission(user, 'cash.approve')) return false;

  const row = await client.rolePermission.findFirst({
    where: { roleId: user.roleId, permission: { key: permission } },
    select: { requiresApproval: true },
  });
  return row?.requiresApproval === true;
}

export async function listCashApproverIds(client: Client = prisma): Promise<string[]> {
  const users = await client.user.findMany({
    where: {
      active: true,
      deletedAt: null,
      role: {
        permissions: {
          some: { permission: { key: 'cash.approve' } },
        },
      },
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
