import 'server-only';

import {
  AuditAction,
  KeyAction,
  KeyStatus,
  KeyType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { areaCountSnapshots } from '@/domain/key-custody';
import { listStaffLoans } from '@/server/services/key-staff';
import { NotFoundError, RuleError } from '@/server/errors';

const INVENTORY_FLOORS = [4, 5, 6] as const;
export type InventoryFloor = (typeof INVENTORY_FLOORS)[number];

export const KEY_INVENTORY_MINIMUM_BY_FLOOR: Record<InventoryFloor, number> = {
  4: 29,
  5: 30,
  6: 30,
};
export const KEY_INVENTORY_MINIMUM_TOTAL = 89;
const MINIMUM_KEYS_PER_ROOM = 1;

const KEY_INVENTORY_ROOM_NUMBERS_BY_FLOOR: Record<InventoryFloor, string[]> = {
  4: Array.from({ length: 29 }, (_, index) => String(401 + index)),
  5: Array.from({ length: 30 }, (_, index) => String(501 + index)),
  6: Array.from({ length: 30 }, (_, index) => String(601 + index)),
};

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
    case KeyStatus.ENTREGADA_PERSONAL: return 'Personal · custodia registrada';
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
      number: { in: KEY_INVENTORY_ROOM_NUMBERS_BY_FLOOR[input.floor] },
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

  // El stock registrado sí depende de las llaves físicas existentes. El mínimo esperado
  // se fija más abajo en una llave por habitación y no depende del estado de la llave.
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
      // El inventario oficial mide la cobertura física mínima del hotel:
      // una llave por habitación, independientemente de si está entregada,
      // extraviada o fuera de servicio.
      expected: MINIMUM_KEYS_PER_ROOM,
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
  floor: InventoryFloor | 'todos';
  requestKey?: string;
  notes?: string | null;
  areas?: Array<{ areaId: string; found: number; accountedElsewhere: number; outOfService: number; notes?: string | null }>;
  items: Array<{
    roomId: string;
    found: number;
    accountedElsewhere?: number;
    outOfService: number;
    notes?: string | null;
  }>;
};

export async function savePhysicalKeyInventoryCount(
  user: CurrentUser,
  input: InventoryCountInput,
) {
  if (input.requestKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey)) throw new RuleError('Identificador de inventario inválido.');
  if (input.floor !== 'todos' && !isInventoryFloor(input.floor)) throw new RuleError('El piso debe ser 4, 5 o 6.');

  const rooms = await prisma.room.findMany({
    where: {
      active: true,
      floor: input.floor === 'todos' ? { in: [4, 5, 6] } : input.floor,
      number: { in: input.floor === 'todos' ? Object.values(KEY_INVENTORY_ROOM_NUMBERS_BY_FLOOR).flat() : KEY_INVENTORY_ROOM_NUMBERS_BY_FLOOR[input.floor] },
    },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, keys: { select: { code: true, status: true, notes: true } } },
  });

  const requiredRooms = input.floor === 'todos' ? 89 : KEY_INVENTORY_MINIMUM_BY_FLOOR[input.floor];
  if (rooms.length !== requiredRooms) {
    throw new RuleError(
      `El piso ${input.floor} debe tener ${requiredRooms} habitaciones activas para tomar inventario; actualmente hay ${rooms.length}.`,
    );
  }

  const roomIds = new Set(rooms.map((room) => room.id));
  const roomNumberById = new Map(rooms.map((room) => [room.id, room.number]));
  const received = new Set(input.items.map((item) => item.roomId));
  if (input.items.length !== roomIds.size || received.size !== roomIds.size || [...roomIds].some((id) => !received.has(id))) {
    throw new RuleError('El inventario debe incluir todas las habitaciones activas del piso.');
  }
  for (const item of input.items) {
    if (!roomIds.has(item.roomId)) throw new RuleError('El inventario contiene una habitación de otro piso.');
    if (!Number.isInteger(item.found) || item.found < 0) throw new RuleError('La cantidad encontrada debe ser un entero igual o mayor que cero.');
    if (!Number.isInteger(item.outOfService) || item.outOfService < 0) {
      throw new RuleError('La cantidad fuera de servicio debe ser un entero igual o mayor que cero.');
    }
    if (!Number.isInteger(item.accountedElsewhere ?? 0) || (item.accountedElsewhere ?? 0) < 0) throw new RuleError('La cantidad en custodia debe ser un entero igual o mayor que cero.');
    if ((item.accountedElsewhere ?? 0) > 0 && !item.notes?.trim()) throw new RuleError('Indica la custodia conocida de la llave entregada.');
    if (item.found + (item.accountedElsewhere ?? 0) < MINIMUM_KEYS_PER_ROOM && !item.notes?.trim()) {
      throw new RuleError(
        `La habitación ${roomNumberById.get(item.roomId) ?? item.roomId} tiene una llave faltante: agrega una observación o justificación.`,
      );
    }
  }

  const created = await prisma.$transaction(async tx => {
    if (input.requestKey) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))::text`;
      const previous = await tx.keyInventoryCount.findUnique({ where: { requestKey: input.requestKey }, include: { countedBy: { select: { name: true } }, items: { include: { room: { select: { number: true } } }, orderBy: { room: { number: 'asc' } } } } });
      if (previous) {
        if (previous.countedById !== user.id) throw new RuleError('Este inventario pertenece a otro usuario.');
        const savedAreas = areaCountSnapshots(previous.areasSnapshot);
        const sameAreas = savedAreas.length === (input.areas?.length ?? 0) && savedAreas.every(p => { const i = input.areas?.find(i => i.areaId === p.areaId); return i && i.found === p.found && i.accountedElsewhere === p.accountedElsewhere && i.outOfService === p.outOfService && p.notes === (i.notes?.trim() || null); });
        const same = sameAreas && previous.floor === (input.floor === 'todos' ? null : input.floor) && previous.notes === (input.notes?.trim() || null) && previous.items.every(p => { const i = input.items.find(i => i.roomId === p.roomId); return i && p.found === i.found && p.outOfService === i.outOfService && p.accountedElsewhere === (i.accountedElsewhere ?? 0) && p.notes === (i.notes?.trim() || null); });
        if (!same) throw new RuleError('Este inventario ya fue guardado con otro contenido. Abre el documento o inicia una nueva toma.');
        return previous;
      }
    }
    const areaRows = input.floor === 'todos' ? await tx.keyArea.findMany({ where: { active: true }, orderBy: { name: 'asc' }, include: { keys: { include: { movements: { orderBy: { at: 'desc' }, take: 1 } } } } }) : [];
    const areaInput = input.areas ?? [];
    if (areaInput.length !== areaRows.length || new Set(areaInput.map(a => a.areaId)).size !== areaRows.length || areaRows.some(a => !areaInput.some(i => i.areaId === a.id))) throw new RuleError('El inventario completo debe incluir todas las áreas activas. Recarga para revisar los destinos actuales.');
    const areasSnapshot = areaRows.map(area => {
      const i = areaInput.find(i => i.areaId === area.id)!;
      if (![i.found,i.accountedElsewhere,i.outOfService].every(n => Number.isInteger(n) && n >= 0 && n <= 100)) throw new RuleError('Las cantidades de áreas deben ser enteros entre cero y cien.');
      const expected = area.keys.filter(k => k.movements[0]?.action !== 'BAJA').length;
      if ((i.accountedElsewhere > 0 || i.found + i.accountedElsewhere < expected) && !i.notes?.trim()) throw new RuleError(`Indica la custodia o el faltante del área ${area.name}.`);
      return { areaId:area.id,name:area.name,expected,found:i.found,accountedElsewhere:i.accountedElsewhere,outOfService:i.outOfService,notes:i.notes?.trim() || null };
    });
    const staffCustodySnapshot = (await listStaffLoans(user, tx)).map(l => ({ humanId:l.humanId, departmentName:l.departmentName,collaboratorName:l.collaboratorName,authorizedByName:l.authorizedByName,items:l.items.filter(i => !i.returnedAt && (input.floor === 'todos' || rooms.some(r => r.id === i.destinationId))).map(i => ({keyCode:i.keyCode,destinationId:i.destinationId,destinationName:i.destinationName,destinationKind:i.destinationKind})) })).filter(l => l.items.length);
    const saved = await tx.keyInventoryCount.create({
    data: {
      floor: input.floor === 'todos' ? null : input.floor,
      requestKey: input.requestKey,
      areasSnapshot,
      staffCustodySnapshot,
      countedById: user.id,
      notes: input.notes?.trim() || null,
      items: {
        create: input.items.map((item) => ({
          roomId: item.roomId,
          expected: MINIMUM_KEYS_PER_ROOM,
          found: item.found,
          accountedElsewhere: item.accountedElsewhere ?? 0,
          roomNumberSnapshot: roomNumberById.get(item.roomId),
          custodySnapshot: rooms.find(r => r.id === item.roomId)?.keys ?? [],
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
    await tx.auditLog.create({ data: { entity: 'KeyInventoryCount', entityId: saved.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Inventario de llaves #${saved.humanId} · ${input.floor === 'todos' ? 'tres pisos' : `piso ${input.floor}`}` } });
    return saved;
  });

  const totals = created.items.reduce(
    (acc, item) => {
      acc.expected += item.expected;
      acc.found += item.found;
      acc.outOfService += item.outOfService;
      acc.missing += Math.max(item.expected - item.found - item.accountedElsewhere, 0);
      acc.surplus += Math.max(item.found + item.accountedElsewhere - item.expected, 0);
      return acc;
    },
    { expected: 0, found: 0, missing: 0, surplus: 0, outOfService: 0 },
  );

  return { ...created, totals };
}

export async function listRecentPhysicalKeyCounts(floor: InventoryFloor | 'todos', take = 8) {
  const counts = await prisma.keyInventoryCount.findMany({
    where: floor === 'todos' ? {} : { OR: [{ floor }, { floor: null }] },
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
        acc.missing += Math.max(item.expected - item.found - item.accountedElsewhere, 0);
        acc.surplus += Math.max(item.found + item.accountedElsewhere - item.expected, 0);
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
    await tx.$queryRaw`SELECT "id" FROM "RoomKey" WHERE "id" = ${input.keyId} FOR UPDATE`;
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (key?.status === KeyStatus.ENTREGADA_PERSONAL) throw new RuleError('Recibe la llave desde Entregas a personal antes de cambiar su estado.');
    if (!key) throw new NotFoundError('La llave no existe.');
    if (key.status !== KeyStatus.DISPONIBLE) throw new RuleError('La llave no está disponible.');
    if (key.areaId) throw new RuleError('Entrega las llaves de áreas desde Entregas a personal.');

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
    await tx.$queryRaw`SELECT "id" FROM "RoomKey" WHERE "id" = ${input.keyId} FOR UPDATE`;
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (key?.status === KeyStatus.ENTREGADA_PERSONAL) throw new RuleError('Recibe la llave desde Entregas a personal antes de cambiar su estado.');
    if (!key) throw new NotFoundError('La llave no existe.');
    if (!([KeyStatus.ASIGNADA, KeyStatus.COPIA_ADICIONAL, KeyStatus.PENDIENTE_DEVOLUCION] as KeyStatus[]).includes(key.status)) {
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
    await tx.$queryRaw`SELECT "id" FROM "RoomKey" WHERE "id" = ${input.keyId} FOR UPDATE`;
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (key?.status === KeyStatus.ENTREGADA_PERSONAL) throw new RuleError('Recibe la llave desde Entregas a personal antes de cambiar su estado.');
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
    if (key?.status === KeyStatus.ENTREGADA_PERSONAL) throw new RuleError('Recibe la llave desde Entregas a personal antes de cambiar su estado.');
    if (!key) throw new NotFoundError('La llave no existe.');
    if (key.movements[0]?.action === KeyAction.BAJA) {
      throw new RuleError('Una llave dada de baja no se recupera: registra una nueva llave física.');
    }
    if (!([KeyStatus.EXTRAVIADA, KeyStatus.FUERA_DE_SERVICIO] as KeyStatus[]).includes(key.status)) {
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
    await tx.$queryRaw`SELECT "id" FROM "RoomKey" WHERE "id" = ${input.keyId} FOR UPDATE`;
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (key?.status === KeyStatus.ENTREGADA_PERSONAL) throw new RuleError('Recibe la llave desde Entregas a personal antes de cambiar su estado.');
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
