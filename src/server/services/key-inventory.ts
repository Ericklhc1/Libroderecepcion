import 'server-only';

import {
  AuditAction,
  KeyAction,
  KeyStatus,
  KeyType,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';

const INVENTORY_FLOORS = [4, 5, 6] as const;
export type InventoryFloor = (typeof INVENTORY_FLOORS)[number];

export function isInventoryFloor(value: number): value is InventoryFloor {
  return INVENTORY_FLOORS.includes(value as InventoryFloor);
}

export type PhysicalKeyRow = {
  id: string;
  code: string;
  type: KeyType;
  status: KeyStatus;
  roomId: string;
  roomNumber: string;
  floor: number;
  location: string;
  assignedAt: Date | null;
  assignedBy: string | null;
  notes: string | null;
  lastMovementAt: Date | null;
  lastMovementAction: KeyAction | null;
};

export type FloorRoomInventory = {
  roomId: string;
  roomNumber: string;
  floor: number;
  expected: number;
  registered: number;
  outOfService: number;
  lost: number;
  keys: PhysicalKeyRow[];
};

export type PhysicalKeyInventory = {
  floor: InventoryFloor;
  rooms: FloorRoomInventory[];
  summary: {
    expected: number;
    registered: number;
    outOfService: number;
    lost: number;
  };
};

function locationFor(status: KeyStatus): string {
  switch (status) {
    case KeyStatus.DISPONIBLE:
      return 'Recepción · inventario físico';
    case KeyStatus.ASIGNADA:
    case KeyStatus.COPIA_ADICIONAL:
      return 'Entregada / asignada';
    case KeyStatus.PENDIENTE_DEVOLUCION:
      return 'Pendiente de devolución';
    case KeyStatus.EXTRAVIADA:
      return 'Ubicación desconocida';
    case KeyStatus.FUERA_DE_SERVICIO:
      return 'Fuera de servicio';
  }
}

export async function getPhysicalKeyInventory(input: {
  floor: InventoryFloor;
  query?: string | null;
  status?: KeyStatus | null;
}): Promise<PhysicalKeyInventory> {
  const query = input.query?.trim() || null;

  const rooms = await prisma.room.findMany({
    where: {
      active: true,
      floor: input.floor,
      ...(query
        ? {
            OR: [
              { number: { contains: query, mode: 'insensitive' } },
              { keys: { some: { code: { contains: query, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      floor: true,
      keys: {
        where: input.status ? { status: input.status } : undefined,
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          assignedAt: true,
          notes: true,
          assignedBy: { select: { name: true } },
          movements: {
            take: 1,
            orderBy: { at: 'desc' },
            select: { at: true, action: true },
          },
        },
      },
    },
  });

  // El conteo esperado no puede depender del filtro visual de estado: representa
  // lo que el sistema espera encontrar físicamente disponible en el mesón.
  const roomIds = rooms.map((room) => room.id);
  const expectedRows = roomIds.length
    ? await prisma.roomKey.groupBy({
        by: ['roomId', 'status'],
        where: { roomId: { in: roomIds } },
        _count: { _all: true },
      })
    : [];

  const counts = new Map<string, { expected: number; registered: number; outOfService: number; lost: number }>();
  for (const roomId of roomIds) {
    counts.set(roomId, { expected: 0, registered: 0, outOfService: 0, lost: 0 });
  }
  for (const row of expectedRows) {
    if (!row.roomId) continue;
    const target = counts.get(row.roomId);
    if (!target) continue;
    target.registered += row._count._all;
    if (row.status === KeyStatus.DISPONIBLE) target.expected += row._count._all;
    if (row.status === KeyStatus.FUERA_DE_SERVICIO) target.outOfService += row._count._all;
    if (row.status === KeyStatus.EXTRAVIADA) target.lost += row._count._all;
  }

  const normalized: FloorRoomInventory[] = rooms.map((room) => {
    const count = counts.get(room.id) ?? { expected: 0, registered: 0, outOfService: 0, lost: 0 };
    const floor = room.floor ?? input.floor;
    return {
      roomId: room.id,
      roomNumber: room.number,
      floor,
      ...count,
      keys: room.keys.map((key) => ({
        id: key.id,
        code: key.code,
        type: key.type,
        status: key.status,
        roomId: room.id,
        roomNumber: room.number,
        floor,
        location: locationFor(key.status),
        assignedAt: key.assignedAt,
        assignedBy: key.assignedBy?.name ?? null,
        notes: key.notes,
        lastMovementAt: key.movements[0]?.at ?? null,
        lastMovementAction: key.movements[0]?.action ?? null,
      })),
    };
  });

  return {
    floor: input.floor,
    rooms: normalized,
    summary: normalized.reduce(
      (acc, room) => ({
        expected: acc.expected + room.expected,
        registered: acc.registered + room.registered,
        outOfService: acc.outOfService + room.outOfService,
        lost: acc.lost + room.lost,
      }),
      { expected: 0, registered: 0, outOfService: 0, lost: 0 },
    ),
  };
}

export type InventoryCountInput = {
  floor: InventoryFloor;
  notes?: string | null;
  items: Array<{
    roomId: string;
    found: number;
    outOfService: number;
    notes?: string | null;
  }>;
};

export async function savePhysicalKeyInventoryCount(
  user: CurrentUser,
  input: InventoryCountInput,
) {
  if (!isInventoryFloor(input.floor)) throw new RuleError('El piso debe ser 4, 5 o 6.');

  const rooms = await prisma.room.findMany({
    where: { active: true, floor: input.floor },
    orderBy: { number: 'asc' },
    select: { id: true, number: true },
  });

  const roomIds = new Set(rooms.map((room) => room.id));
  const received = new Set(input.items.map((item) => item.roomId));
  if (received.size !== roomIds.size || [...roomIds].some((id) => !received.has(id))) {
    throw new RuleError('El conteo debe incluir todas las habitaciones activas del piso.');
  }
  for (const item of input.items) {
    if (!roomIds.has(item.roomId)) throw new RuleError('El conteo contiene una habitación de otro piso.');
    if (!Number.isInteger(item.found) || item.found < 0) throw new RuleError('La cantidad encontrada debe ser un entero igual o mayor que cero.');
    if (!Number.isInteger(item.outOfService) || item.outOfService < 0) {
      throw new RuleError('La cantidad fuera de servicio debe ser un entero igual o mayor que cero.');
    }
  }

  const expectedRows = await prisma.roomKey.groupBy({
    by: ['roomId'],
    where: { roomId: { in: [...roomIds] }, status: KeyStatus.DISPONIBLE },
    _count: { _all: true },
  });
  const expectedByRoom = new Map(
    expectedRows.filter((row) => row.roomId).map((row) => [row.roomId!, row._count._all]),
  );

  const created = await prisma.keyInventoryCount.create({
    data: {
      floor: input.floor,
      countedById: user.id,
      notes: input.notes?.trim() || null,
      items: {
        create: input.items.map((item) => ({
          roomId: item.roomId,
          expected: expectedByRoom.get(item.roomId) ?? 0,
          found: item.found,
          outOfService: item.outOfService,
          notes: item.notes?.trim() || null,
        })),
      },
    },
    include: {
      countedBy: { select: { name: true } },
      items: { include: { room: { select: { number: true } } }, orderBy: { room: { number: 'asc' } } },
    },
  });

  const totals = created.items.reduce(
    (acc, item) => {
      acc.expected += item.expected;
      acc.found += item.found;
      acc.outOfService += item.outOfService;
      acc.missing += Math.max(item.expected - item.found, 0);
      acc.surplus += Math.max(item.found - item.expected, 0);
      return acc;
    },
    { expected: 0, found: 0, missing: 0, surplus: 0, outOfService: 0 },
  );

  await recordAudit({
    entity: 'KeyInventoryCount',
    entityId: created.id,
    action: AuditAction.CREAR,
    user,
    summary: `Conteo físico de llaves del piso ${input.floor}: ${totals.found}/${totals.expected} encontradas`,
    after: totals,
  });

  return { ...created, totals };
}

export async function listRecentPhysicalKeyCounts(floor: InventoryFloor, take = 8) {
  const counts = await prisma.keyInventoryCount.findMany({
    where: { floor },
    orderBy: { countedAt: 'desc' },
    take,
    include: {
      countedBy: { select: { name: true } },
      items: { include: { room: { select: { number: true } } } },
    },
  });

  return counts.map((count) => {
    const totals = count.items.reduce(
      (acc, item) => {
        acc.expected += item.expected;
        acc.found += item.found;
        acc.outOfService += item.outOfService;
        acc.missing += Math.max(item.expected - item.found, 0);
        acc.surplus += Math.max(item.found - item.expected, 0);
        return acc;
      },
      { expected: 0, found: 0, missing: 0, surplus: 0, outOfService: 0 },
    );
    return { ...count, totals };
  });
}

type Tx = Prisma.TransactionClient;

async function logPhysicalMovement(
  tx: Tx,
  user: CurrentUser,
  input: {
    keyId: string;
    action: KeyAction;
    fromStatus: KeyStatus | null;
    toStatus: KeyStatus;
    roomId: string | null;
    note?: string | null;
  },
) {
  await tx.keyMovement.create({
    data: {
      keyId: input.keyId,
      action: input.action,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      roomId: input.roomId,
      stayId: null,
      userId: user.id,
      note: input.note?.trim() || null,
    },
  });
}

export async function createPhysicalKey(
  user: CurrentUser,
  input: { code: string; roomId: string; type: KeyType; notes?: string | null },
) {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new RuleError('El código de la llave es obligatorio.');

  const room = await prisma.room.findFirst({ where: { id: input.roomId, active: true } });
  if (!room) throw new NotFoundError('La habitación no existe o está inactiva.');

  const existing = await prisma.roomKey.findUnique({ where: { code } });
  if (existing) throw new RuleError(`Ya existe una llave con el código ${code}.`);

  const key = await prisma.$transaction(async (tx) => {
    const created = await tx.roomKey.create({
      data: {
        code,
        type: input.type,
        roomId: room.id,
        stayId: null,
        status: KeyStatus.DISPONIBLE,
        notes: input.notes?.trim() || null,
      },
    });
    await logPhysicalMovement(tx, user, {
      keyId: created.id,
      action: KeyAction.INGRESO_INVENTARIO,
      fromStatus: null,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: room.id,
      note: input.notes,
    });
    return created;
  });

  await recordAudit({
    entity: 'RoomKey',
    entityId: key.id,
    action: AuditAction.CREAR,
    user,
    summary: `Llave física ${key.code} ingresada al inventario de la habitación ${room.number}`,
  });
  return key;
}

export async function assignPhysicalKey(
  user: CurrentUser,
  input: { keyId: string; roomId: string; note?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('La llave no existe.');
    if (key.status !== KeyStatus.DISPONIBLE) throw new RuleError('La llave no está disponible.');

    const room = await tx.room.findFirst({ where: { id: input.roomId, active: true } });
    if (!room) throw new NotFoundError('La habitación no existe o está inactiva.');
    if (key.type === KeyType.PRINCIPAL && key.roomId && key.roomId !== room.id) {
      throw new RuleError('La llave principal pertenece a otra habitación.');
    }

    const target = key.type === KeyType.PRINCIPAL ? KeyStatus.ASIGNADA : KeyStatus.COPIA_ADICIONAL;
    const updated = await tx.roomKey.update({
      where: { id: key.id },
      data: {
        roomId: room.id,
        stayId: null,
        status: target,
        assignedAt: new Date(),
        assignedById: user.id,
        notes: input.note?.trim() || key.notes,
      },
    });
    await logPhysicalMovement(tx, user, {
      keyId: key.id,
      action: key.type === KeyType.PRINCIPAL ? KeyAction.ASIGNADA : KeyAction.COPIA_ENTREGADA,
      fromStatus: key.status,
      toStatus: target,
      roomId: room.id,
      note: input.note,
    });
    return updated;
  });
}

export async function returnPhysicalKey(
  user: CurrentUser,
  input: { keyId: string; note?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('La llave no existe.');
    if (![KeyStatus.ASIGNADA, KeyStatus.COPIA_ADICIONAL, KeyStatus.PENDIENTE_DEVOLUCION].includes(key.status)) {
      throw new RuleError('La llave no está entregada ni pendiente de devolución.');
    }

    const updated = await tx.roomKey.update({
      where: { id: key.id },
      data: {
        status: KeyStatus.DISPONIBLE,
        stayId: null,
        // La llave física conserva su habitación. Ya no vuelve a un pool PMS.
        roomId: key.roomId,
        assignedAt: null,
        assignedById: null,
        notes: input.note?.trim() || key.notes,
      },
    });
    await logPhysicalMovement(tx, user, {
      keyId: key.id,
      action: key.type === KeyType.PRINCIPAL ? KeyAction.DEVUELTA : KeyAction.COPIA_RECUPERADA,
      fromStatus: key.status,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: key.roomId,
      note: input.note,
    });
    return updated;
  });
}

export async function markPhysicalKeyIncident(
  user: CurrentUser,
  input: { keyId: string; status: 'EXTRAVIADA' | 'FUERA_DE_SERVICIO'; reason: string },
) {
  const target = input.status === 'EXTRAVIADA' ? KeyStatus.EXTRAVIADA : KeyStatus.FUERA_DE_SERVICIO;
  return prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('La llave no existe.');

    const updated = await tx.roomKey.update({
      where: { id: key.id },
      data: {
        status: target,
        stayId: null,
        assignedAt: null,
        assignedById: null,
        notes: input.reason.trim(),
      },
    });
    await logPhysicalMovement(tx, user, {
      keyId: key.id,
      action: target === KeyStatus.EXTRAVIADA ? KeyAction.MARCADA_EXTRAVIADA : KeyAction.MARCADA_FUERA_DE_SERVICIO,
      fromStatus: key.status,
      toStatus: target,
      roomId: key.roomId,
      note: input.reason,
    });
    return updated;
  });
}

export async function recoverPhysicalKey(
  user: CurrentUser,
  input: { keyId: string; note?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({
      where: { id: input.keyId },
      include: { movements: { take: 1, orderBy: { at: 'desc' }, select: { action: true } } },
    });
    if (!key) throw new NotFoundError('La llave no existe.');
    if (key.movements[0]?.action === KeyAction.BAJA) {
      throw new RuleError('Una llave dada de baja no se recupera: registra una nueva llave física.');
    }
    if (![KeyStatus.EXTRAVIADA, KeyStatus.FUERA_DE_SERVICIO].includes(key.status)) {
      throw new RuleError('Sólo se recuperan llaves extraviadas o fuera de servicio.');
    }

    const updated = await tx.roomKey.update({
      where: { id: key.id },
      data: { status: KeyStatus.DISPONIBLE, stayId: null, notes: input.note?.trim() || null },
    });
    await logPhysicalMovement(tx, user, {
      keyId: key.id,
      action: KeyAction.REINTEGRADA,
      fromStatus: key.status,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: key.roomId,
      note: input.note,
    });
    return updated;
  });
}

export async function retirePhysicalKey(
  user: CurrentUser,
  input: { keyId: string; reason: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new RuleError('Explica el motivo de la baja.');

  const updated = await prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('La llave no existe.');
    const result = await tx.roomKey.update({
      where: { id: key.id },
      data: {
        status: KeyStatus.FUERA_DE_SERVICIO,
        stayId: null,
        assignedAt: null,
        assignedById: null,
        notes: `BAJA: ${reason}`,
      },
    });
    await logPhysicalMovement(tx, user, {
      keyId: key.id,
      action: KeyAction.BAJA,
      fromStatus: key.status,
      toStatus: KeyStatus.FUERA_DE_SERVICIO,
      roomId: key.roomId,
      note: reason,
    });
    return result;
  });

  await recordAudit({
    entity: 'RoomKey',
    entityId: updated.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary: `Llave ${updated.code} dada de baja del inventario físico`,
    reason,
  });
  return updated;
}
