import 'server-only';

import {
  AuditAction,
  InventoryBehavior,
  InventoryLocationKind,
  InventoryMovementKind,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { ROLE_KEYS } from '@/lib/permissions';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

function decimal(value: Prisma.Decimal | number | string): number {
  return Number(value);
}

export async function inventoryDepartmentIds(
  user: CurrentUser,
  tx: Db = prisma,
): Promise<string[]> {
  if (
    user.isSystemAdmin ||
    user.permissions.includes('inventory.manage') ||
    user.roleKey === ROLE_KEYS.MANAGEMENT
  ) {
    return (await tx.department.findMany({
      where: { active: true },
      select: { id: true },
    })).map((row) => row.id);
  }

  const person = await tx.user.findUnique({
    where: { id: user.id },
    select: {
      departmentId: true,
      scheduleCollaborator: {
        select: {
          active: true,
          memberships: {
            where: { active: true, department: { active: true } },
            select: { departmentId: true },
          },
        },
      },
    },
  });
  return [...new Set([
    person?.departmentId,
    ...(person?.scheduleCollaborator?.active
      ? person.scheduleCollaborator.memberships.map((row) => row.departmentId)
      : []),
  ].filter((id): id is string => Boolean(id)))];
}

function requireInventoryPermission(
  user: CurrentUser,
  permission: 'inventory.view' | 'inventory.move' | 'inventory.manage' | 'laundry.manage',
) {
  if (!user.permissions.includes(permission)) {
    throw new ForbiddenError(`No tienes permiso para esta acción de inventario (${permission}).`);
  }
}

async function assertLocationScope(
  user: CurrentUser,
  location: { id: string; departmentId: string | null; name: string },
  tx: Db,
  options: { allowGlobal?: boolean } = {},
) {
  if (user.isSystemAdmin || user.permissions.includes('inventory.manage')) return;
  if (!location.departmentId) {
    if (options.allowGlobal && user.permissions.includes('laundry.manage')) return;
    throw new ForbiddenError(`La ubicación «${location.name}» requiere administración de inventario.`);
  }
  const allowed = await inventoryDepartmentIds(user, tx);
  if (!allowed.includes(location.departmentId)) {
    throw new ForbiddenError(`La ubicación «${location.name}» está fuera de tu alcance.`);
  }
}

export async function listInventory(user: CurrentUser, departmentId?: string) {
  requireInventoryPermission(user, 'inventory.view');
  const scope = await inventoryDepartmentIds(user);
  const allowedDepartmentIds =
    user.isSystemAdmin || user.permissions.includes('inventory.manage') || user.roleKey === ROLE_KEYS.MANAGEMENT
      ? undefined
      : scope;

  if (departmentId && allowedDepartmentIds && !allowedDepartmentIds.includes(departmentId)) {
    throw new ForbiddenError('Ese departamento está fuera de tu alcance de inventario.');
  }

  const [categories, locations, items] = await Promise.all([
    prisma.inventoryCategory.findMany({
      where: {
        active: true,
        ...(departmentId
          ? { departmentId }
          : allowedDepartmentIds
            ? { departmentId: { in: allowedDepartmentIds } }
            : {}),
      },
      include: { department: { select: { id: true, name: true } } },
      orderBy: [{ department: { order: 'asc' } }, { name: 'asc' }],
    }),
    prisma.inventoryLocation.findMany({
      where: {
        active: true,
        ...(departmentId
          ? { OR: [{ departmentId }, { departmentId: null }] }
          : allowedDepartmentIds
            ? { OR: [{ departmentId: { in: allowedDepartmentIds } }, { departmentId: null }] }
            : {}),
      },
      include: { department: { select: { id: true, name: true } } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    }),
    prisma.inventoryItem.findMany({
      where: {
        active: true,
        category: {
          active: true,
          ...(departmentId
            ? { departmentId }
            : allowedDepartmentIds
              ? { departmentId: { in: allowedDepartmentIds } }
              : {}),
        },
      },
      include: {
        category: { include: { department: { select: { id: true, name: true } } } },
        balances: {
          include: { location: { select: { id: true, name: true, kind: true, departmentId: true } } },
          orderBy: { location: { name: 'asc' } },
        },
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    }),
  ]);

  return {
    categories,
    locations,
    items: items.map((item) => ({
      ...item,
      total: item.balances.reduce((sum, row) => sum + decimal(row.quantity), 0),
      balances: item.balances.map((row) => ({ ...row, quantity: decimal(row.quantity) })),
    })),
  };
}

export async function saveInventoryCategory(
  user: CurrentUser,
  input: { id?: string; departmentId: string; name: string; active?: boolean },
) {
  requireInventoryPermission(user, 'inventory.manage');
  const name = input.name.trim();
  if (name.length < 2) throw new RuleError('La categoría debe tener al menos dos caracteres.');
  const department = await prisma.department.findFirst({
    where: { id: input.departmentId, active: true },
    select: { id: true, name: true },
  });
  if (!department) throw new NotFoundError('El departamento no existe o está inactivo.');

  const row = input.id
    ? await prisma.inventoryCategory.update({
        where: { id: input.id },
        data: {
          departmentId: department.id,
          name,
          active: input.active ?? true,
          archivedAt: input.active === false ? new Date() : null,
        },
      })
    : await prisma.inventoryCategory.create({
        data: {
          departmentId: department.id,
          name,
          active: input.active ?? true,
          archivedAt: input.active === false ? new Date() : null,
          createdById: user.id,
        },
      });

  await recordAudit({
    entity: 'InventoryCategory',
    entityId: row.id,
    action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
    user,
    summary: `Categoría de inventario «${row.name}» · ${department.name}`,
  });
  return row;
}

function normalizeCurrency(value?: string | null): string | null {
  const currency = value?.trim().toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new RuleError('La moneda debe tener tres letras.');
  }
  return currency;
}

export async function saveInventoryItem(
  user: CurrentUser,
  input: {
    id?: string;
    categoryId: string;
    code: string;
    name: string;
    behavior: InventoryBehavior;
    unit?: string;
    presentation?: string | null;
    trackIndividually?: boolean;
    active?: boolean;
    cost?: number | null;
    costCurrency?: string | null;
    replacementEstimate?: number | null;
    replacementCurrency?: string | null;
    replacementSource?: string | null;
    replacementDate?: Date | null;
    accountingValue?: number | null;
    accountingCurrency?: string | null;
  },
) {
  requireInventoryPermission(user, 'inventory.manage');
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (code.length < 2 || name.length < 2) throw new RuleError('Completa código y nombre del artículo.');
  for (const value of [input.cost, input.replacementEstimate, input.accountingValue]) {
    if (value !== undefined && value !== null && (!(value >= 0) || !Number.isFinite(value))) {
      throw new RuleError('Los valores monetarios deben ser iguales o mayores que cero.');
    }
  }
  if (input.accountingValue !== undefined && input.accountingValue !== null && !input.accountingCurrency) {
    throw new RuleError('El valor contable requiere moneda aportada o validada por contabilidad.');
  }

  const category = await prisma.inventoryCategory.findFirst({
    where: { id: input.categoryId, active: true },
    select: { id: true, name: true },
  });
  if (!category) throw new NotFoundError('La categoría no existe o está archivada.');

  const data = {
    categoryId: category.id,
    code,
    name,
    behavior: input.behavior,
    unit: input.unit?.trim() || 'pieza',
    presentation: input.presentation?.trim() || null,
    trackIndividually: input.trackIndividually ?? false,
    active: input.active ?? true,
    archivedAt: input.active === false ? new Date() : null,
    cost: input.cost == null ? null : new Prisma.Decimal(input.cost),
    costCurrency: normalizeCurrency(input.costCurrency),
    replacementEstimate:
      input.replacementEstimate == null ? null : new Prisma.Decimal(input.replacementEstimate),
    replacementCurrency: normalizeCurrency(input.replacementCurrency),
    replacementSource: input.replacementSource?.trim() || null,
    replacementDate: input.replacementDate ?? null,
    accountingValue:
      input.accountingValue == null ? null : new Prisma.Decimal(input.accountingValue),
    accountingCurrency: normalizeCurrency(input.accountingCurrency),
  } satisfies Prisma.InventoryItemUncheckedCreateInput;

  const row = input.id
    ? await prisma.inventoryItem.update({ where: { id: input.id }, data })
    : await prisma.inventoryItem.create({ data: { ...data, createdById: user.id } });

  await recordAudit({
    entity: 'InventoryItem',
    entityId: row.id,
    action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
    user,
    summary: `Artículo #${row.humanId} · ${row.code} · ${row.name}`,
  });
  return row;
}

export async function saveInventoryLocation(
  user: CurrentUser,
  input: {
    id?: string;
    key?: string | null;
    departmentId?: string | null;
    name: string;
    kind: InventoryLocationKind;
    active?: boolean;
  },
) {
  requireInventoryPermission(user, 'inventory.manage');
  const name = input.name.trim();
  if (name.length < 2) throw new RuleError('La ubicación debe tener al menos dos caracteres.');
  const departmentId = input.departmentId || null;
  if (departmentId && !(await prisma.department.count({ where: { id: departmentId, active: true } }))) {
    throw new RuleError('El departamento de la ubicación no está activo.');
  }

  const data = {
    key: input.key?.trim().toUpperCase() || null,
    departmentId,
    name,
    kind: input.kind,
    active: input.active ?? true,
  };
  const row = input.id
    ? await prisma.inventoryLocation.update({ where: { id: input.id }, data })
    : await prisma.inventoryLocation.create({ data });

  await recordAudit({
    entity: 'InventoryLocation',
    entityId: row.id,
    action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
    user,
    summary: `Ubicación de inventario «${row.name}» · ${row.kind}`,
  });
  return row;
}

export type InventoryMovementInput = {
  requestKey: string;
  itemId: string;
  assetId?: string | null;
  kind: InventoryMovementKind;
  quantity: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reason: string;
  notes?: string | null;
  laundryShipmentId?: string | null;
};

async function lockInventoryCoordinates(tx: Tx, itemId: string, locationIds: string[]) {
  for (const locationId of [...new Set(locationIds)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory:${itemId}:${locationId}`}))::text`;
  }
}

async function changeBalance(
  tx: Tx,
  itemId: string,
  locationId: string,
  delta: number,
) {
  const current = await tx.inventoryBalance.findUnique({
    where: { itemId_locationId: { itemId, locationId } },
  });
  const next = decimal(current?.quantity ?? 0) + delta;
  if (next < -0.000001) throw new RuleError('El movimiento dejaría existencias negativas.');
  return tx.inventoryBalance.upsert({
    where: { itemId_locationId: { itemId, locationId } },
    create: { itemId, locationId, quantity: new Prisma.Decimal(Math.max(0, next)) },
    update: { quantity: new Prisma.Decimal(Math.max(0, next)) },
  });
}

export async function applyInventoryMovement(
  tx: Tx,
  user: CurrentUser,
  input: InventoryMovementInput,
  options: { permission?: 'inventory.move' | 'laundry.manage'; allowGlobal?: boolean } = {},
) {
  const permission = options.permission ?? 'inventory.move';
  requireInventoryPermission(user, permission);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey)) {
    throw new RuleError('La referencia del movimiento no es válida.');
  }
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
    throw new RuleError('La cantidad debe ser mayor que cero.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw new RuleError('Indica el motivo del movimiento.');
  if (!input.fromLocationId && !input.toLocationId) {
    throw new RuleError('El movimiento necesita origen o destino.');
  }
  if (input.fromLocationId && input.fromLocationId === input.toLocationId) {
    throw new RuleError('Origen y destino deben ser distintos.');
  }

  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))::text`;
  const previous = await tx.inventoryMovement.findUnique({ where: { requestKey: input.requestKey } });
  if (previous) {
    const same =
      previous.itemId === input.itemId &&
      previous.assetId === (input.assetId || null) &&
      previous.kind === input.kind &&
      decimal(previous.quantity) === input.quantity &&
      previous.fromLocationId === (input.fromLocationId || null) &&
      previous.toLocationId === (input.toLocationId || null) &&
      previous.reason === reason &&
      previous.notes === (input.notes?.trim() || null) &&
      previous.laundryShipmentId === (input.laundryShipmentId || null);
    if (!same) throw new RuleError('Ese movimiento ya fue guardado con otro contenido.');
    return { movement: previous, repeated: true };
  }

  const item = await tx.inventoryItem.findFirst({
    where: { id: input.itemId, active: true, category: { active: true } },
    select: {
      id: true,
      humanId: true,
      name: true,
      code: true,
      behavior: true,
      trackIndividually: true,
    },
  });
  if (!item) throw new NotFoundError('El artículo no existe o está archivado.');

  const ids = [input.fromLocationId, input.toLocationId].filter((id): id is string => Boolean(id));
  const locations = ids.length
    ? await tx.inventoryLocation.findMany({
        where: { id: { in: ids }, active: true },
        select: { id: true, name: true, departmentId: true, kind: true },
      })
    : [];
  if (locations.length !== ids.length) throw new RuleError('Una ubicación no existe o está inactiva.');
  for (const location of locations) {
    await assertLocationScope(user, location, tx, { allowGlobal: options.allowGlobal });
  }

  if (item.trackIndividually) {
    if (!input.assetId || input.quantity !== 1) {
      throw new RuleError('Este artículo requiere seleccionar una unidad identificada y cantidad 1.');
    }
    const asset = await tx.inventoryAsset.findFirst({
      where: { id: input.assetId, itemId: item.id, active: true },
    });
    if (!asset) throw new RuleError('La unidad identificada no existe o no pertenece al artículo.');
    if (input.fromLocationId && asset.currentLocationId !== input.fromLocationId) {
      throw new RuleError('La unidad identificada ya no está en la ubicación de origen.');
    }
  } else if (input.assetId) {
    throw new RuleError('Este artículo se gestiona por cantidad, no por identificación individual.');
  }

  await lockInventoryCoordinates(tx, item.id, ids);
  if (input.fromLocationId) await changeBalance(tx, item.id, input.fromLocationId, -input.quantity);
  if (input.toLocationId) await changeBalance(tx, item.id, input.toLocationId, input.quantity);

  if (input.assetId) {
    await tx.inventoryAsset.update({
      where: { id: input.assetId },
      data: {
        currentLocationId: input.toLocationId || null,
        ...(input.kind === InventoryMovementKind.BAJA ? { active: false } : {}),
      },
    });
  }

  const movement = await tx.inventoryMovement.create({
    data: {
      requestKey: input.requestKey,
      itemId: item.id,
      assetId: input.assetId || null,
      kind: input.kind,
      quantity: new Prisma.Decimal(input.quantity),
      fromLocationId: input.fromLocationId || null,
      toLocationId: input.toLocationId || null,
      reason,
      notes: input.notes?.trim() || null,
      createdById: user.id,
      laundryShipmentId: input.laundryShipmentId || null,
    },
  });

  await recordAudit(
    {
      entity: 'InventoryMovement',
      entityId: movement.id,
      action: AuditAction.CREAR,
      user,
      summary:
        `Movimiento #${movement.humanId} · ${item.code} · ${input.quantity} ` +
        `${input.fromLocationId ? 'desde ' + locations.find((l) => l.id === input.fromLocationId)?.name : 'entrada'}` +
        `${input.toLocationId ? ' hacia ' + locations.find((l) => l.id === input.toLocationId)?.name : ''}`,
      after: {
        kind: input.kind,
        itemId: item.id,
        quantity: input.quantity,
        fromLocationId: input.fromLocationId || null,
        toLocationId: input.toLocationId || null,
        laundryShipmentId: input.laundryShipmentId || null,
      },
    },
    tx,
  );

  return { movement, repeated: false };
}

export async function recordInventoryMovement(
  user: CurrentUser,
  input: InventoryMovementInput,
) {
  return prisma.$transaction(
    (tx) => applyInventoryMovement(tx, user, input),
    { timeout: 15000 },
  );
}

export async function createInventoryAsset(
  user: CurrentUser,
  input: {
    itemId: string;
    internalCode: string;
    locationId?: string | null;
    condition?: string;
    custodianUserId?: string | null;
  },
) {
  requireInventoryPermission(user, 'inventory.manage');
  const item = await prisma.inventoryItem.findFirst({
    where: { id: input.itemId, active: true, trackIndividually: true },
  });
  if (!item) throw new RuleError('El artículo no admite identificación individual.');
  const internalCode = input.internalCode.trim().toUpperCase();
  if (internalCode.length < 2) throw new RuleError('Indica el código interno de la unidad.');
  const locationId = input.locationId || null;
  if (locationId) {
    const location = await prisma.inventoryLocation.findFirst({
      where: { id: locationId, active: true },
      select: { id: true, name: true, departmentId: true },
    });
    if (!location) throw new RuleError('La ubicación no existe.');
    await assertLocationScope(user, location, prisma);
  }

  return prisma.$transaction(async (tx) => {
    const asset = await tx.inventoryAsset.create({
      data: {
        itemId: item.id,
        internalCode,
        currentLocationId: locationId,
        custodianUserId: input.custodianUserId || null,
        condition: input.condition?.trim() || 'OPERATIVO',
      },
    });
    if (locationId) {
      await lockInventoryCoordinates(tx, item.id, [locationId]);
      await changeBalance(tx, item.id, locationId, 1);
    }
    await recordAudit(
      {
        entity: 'InventoryAsset',
        entityId: asset.id,
        action: AuditAction.CREAR,
        user,
        summary: `Unidad ${asset.internalCode} registrada para ${item.name}`,
      },
      tx,
    );
    return asset;
  });
}

export { InventoryBehavior, InventoryLocationKind, InventoryMovementKind };
