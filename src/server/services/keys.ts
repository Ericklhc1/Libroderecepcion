import 'server-only';
import {
  AuditAction,
  KeyAction,
  KeyStatus,
  KeyType,
  // `Prisma` como valor, no sólo como tipo: `Prisma.sql` y `Prisma.join`
  // parametrizan el UPDATE por lotes del cruce de llaves.
  Prisma,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { principalKeyHolder, type KeyHolderCandidate } from '@/domain/rooms';

/**
 * Inventario de llaves.
 *
 * Las llaves son objetos físicos, no un contador: cada una existe, tiene un
 * código y un estado, y cada movimiento queda registrado. Por eso el stock
 * disponible no se guarda en ninguna parte —se cuenta— y nunca puede quedar
 * descuadrado respecto de las llaves que hay sobre el mesón.
 *
 * Cada habitación tiene su llave principal, que pertenece a la habitación y no
 * se mueve del piso. Las copias adicionales viven en el stock del Supervisor:
 * salen cuando se entregan y vuelven cuando se recuperan.
 */

type Tx = Prisma.TransactionClient;

/** Estados en los que la llave está fuera del stock. */
const OUT_OF_STOCK: KeyStatus[] = [
  KeyStatus.ASIGNADA,
  KeyStatus.COPIA_ADICIONAL,
  KeyStatus.PENDIENTE_DEVOLUCION,
  KeyStatus.EXTRAVIADA,
  KeyStatus.FUERA_DE_SERVICIO,
];

/** Llaves que siguen en manos de un huésped. */
const HELD_BY_GUEST: KeyStatus[] = [
  KeyStatus.ASIGNADA,
  KeyStatus.COPIA_ADICIONAL,
  KeyStatus.PENDIENTE_DEVOLUCION,
];

async function logMovement(
  tx: Tx,
  user: CurrentUser,
  input: {
    keyId: string;
    action: KeyAction;
    fromStatus: KeyStatus | null;
    toStatus: KeyStatus;
    roomId?: string | null;
    stayId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.keyMovement.create({
    data: {
      keyId: input.keyId,
      action: input.action,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      roomId: input.roomId ?? null,
      stayId: input.stayId ?? null,
      userId: user.id,
      note: input.note ?? null,
    },
  });
}

/**
 * Entrega la llave que corresponde a un check-in confirmado.
 *
 * Prefiere la llave principal de la habitación. Si esa llave está extraviada o
 * fuera de servicio, toma una copia del stock y lo deja anotado: la habitación
 * no puede quedar ocupada sin llave.
 */
/**
 * Cruza las estadías activas con el inventario y deja la llave principal en
 * manos de quien corresponde.
 *
 * Es la **única** implementación de esa regla. La decide `principalKeyHolder`
 * en el dominio, y la usan dos caminos: la importación de informes (acotada al
 * día del lote) y la reconciliación explícita del inventario (sin acotar, para
 * arreglar estadías cargadas antes de que esta regla existiera).
 *
 * Nunca le quita la llave a otra estadía, ni asigna una extraviada o fuera de
 * servicio: ahí el conflicto es real y se conserva a la vista.
 *
 * `businessDate` omitido = todas las estadías activas.
 */
export async function reconcilePrincipalKeys(
  tx: Tx,
  user: CurrentUser,
  options: { businessDate?: Date; note?: string } = {},
): Promise<number> {
  const occupants = await tx.roomStay.findMany({
    where: {
      ...(options.businessDate ? { businessDate: options.businessDate } : {}),
      deletedAt: null,
      roomId: { not: null },
      stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
      status: { in: [RoomStayStatus.IN_HOUSE, RoomStayStatus.CHECK_OUT] },
    },
    select: { id: true, roomId: true, status: true, stage: true },
  });

  const byRoom = new Map<string, KeyHolderCandidate[]>();
  for (const stay of occupants) {
    if (!stay.roomId) continue;
    const list = byRoom.get(stay.roomId) ?? [];
    list.push({ id: stay.id, status: stay.status, stage: stay.stage });
    byRoom.set(stay.roomId, list);
  }

  const holderByRoom = new Map<string, { stayId: string; status: KeyStatus }>();
  for (const [roomId, stays] of byRoom) {
    const holder = principalKeyHolder(stays);
    if (holder) {
      holderByRoom.set(roomId, { stayId: holder.stayId, status: KeyStatus[holder.status] });
    }
  }
  if (!holderByRoom.size) return 0;

  const principals = await tx.roomKey.findMany({
    where: { roomId: { in: [...holderByRoom.keys()] }, type: KeyType.PRINCIPAL },
    select: { id: true, roomId: true, status: true, stayId: true },
  });

  type Assignment = {
    keyId: string;
    roomId: string;
    stayId: string;
    from: KeyStatus;
    to: KeyStatus;
  };
  const assignments: Assignment[] = [];

  for (const key of principals) {
    if (!key.roomId) continue;
    const holder = holderByRoom.get(key.roomId);
    if (!holder) continue;
    const target = holder.status;

    // Ya está donde debe: no se escribe ni se registra movimiento.
    if (key.stayId === holder.stayId && key.status === target) continue;

    // En manos de otra estadía: no se le quita a nadie.
    const heldByOther =
      key.stayId !== null && key.stayId !== holder.stayId && HELD_BY_GUEST.includes(key.status);
    if (heldByOther) continue;

    // Extraviada o fuera de servicio: el conflicto es real y se conserva.
    if (key.status === KeyStatus.EXTRAVIADA || key.status === KeyStatus.FUERA_DE_SERVICIO) {
      continue;
    }

    assignments.push({
      keyId: key.id,
      roomId: key.roomId,
      stayId: holder.stayId,
      from: key.status,
      to: target,
    });
  }

  if (!assignments.length) return 0;

  /*
    Cada llave va a una estadía distinta, así que `updateMany` no sirve: serían
    tantas consultas como habitaciones ocupadas. Un solo UPDATE contra una
    lista de valores deja el costo en un viaje, que es lo que importa con la
    base en otra región. Los valores van parametrizados.
  */
  await tx.$executeRaw`
    UPDATE "RoomKey" AS k
    SET "status" = v."status"::"KeyStatus", "stayId" = v."stayId"
    FROM (
      SELECT * FROM (VALUES ${Prisma.join(
        assignments.map((a) => Prisma.sql`(${a.keyId}, ${a.stayId}, ${a.to}::text)`),
      )}) AS t("id", "stayId", "status")
    ) AS v
    WHERE k."id" = v."id"
  `;

  const origen = options.note ?? 'informe del PMS';
  await tx.keyMovement.createMany({
    data: assignments.map((a) => ({
      keyId: a.keyId,
      action:
        a.to === KeyStatus.PENDIENTE_DEVOLUCION
          ? KeyAction.MARCADA_PENDIENTE_DEVOLUCION
          : KeyAction.ASIGNADA,
      fromStatus: a.from,
      toStatus: a.to,
      roomId: a.roomId,
      stayId: a.stayId,
      userId: user.id,
      note:
        a.to === KeyStatus.PENDIENTE_DEVOLUCION
          ? `Salida sin confirmar (${origen}): llave por recuperar`
          : `Huésped in house (${origen})`,
    })),
  });

  return assignments.length;
}

export async function assignMainKey(
  tx: Tx,
  user: CurrentUser,
  input: { roomId: string; stayId: string; keyId?: string | null },
): Promise<{ id: string; code: string } | null> {
  const chosen = input.keyId
    ? await tx.roomKey.findFirst({
        where: { id: input.keyId, status: KeyStatus.DISPONIBLE },
      })
    : ((await tx.roomKey.findFirst({
        where: { roomId: input.roomId, type: KeyType.PRINCIPAL, status: KeyStatus.DISPONIBLE },
      })) ??
      (await tx.roomKey.findFirst({
        where: { roomId: null, type: KeyType.COPIA, status: KeyStatus.DISPONIBLE },
        orderBy: { code: 'asc' },
      })));

  if (!chosen) return null;

  await tx.roomKey.update({
    where: { id: chosen.id },
    data: {
      roomId: input.roomId,
      stayId: input.stayId,
      status: KeyStatus.ASIGNADA,
      assignedAt: new Date(),
      assignedById: user.id,
    },
  });
  await logMovement(tx, user, {
    keyId: chosen.id,
    action: KeyAction.ASIGNADA,
    fromStatus: chosen.status,
    toStatus: KeyStatus.ASIGNADA,
    roomId: input.roomId,
    stayId: input.stayId,
    note: 'Check-in confirmado',
  });

  return { id: chosen.id, code: chosen.code };
}

/**
 * Devuelve al inventario todas las llaves de una estadía.
 *
 * La principal se queda con su habitación —es su llave— y las copias vuelven
 * al stock del Supervisor.
 */
export async function releaseStayKeys(
  tx: Tx,
  user: CurrentUser,
  stayId: string,
  note: string,
): Promise<number> {
  const keys = await tx.roomKey.findMany({
    where: { stayId, status: { in: HELD_BY_GUEST } },
  });

  for (const key of keys) {
    await tx.roomKey.update({
      where: { id: key.id },
      data: {
        status: KeyStatus.DISPONIBLE,
        stayId: null,
        // La copia vuelve al stock; la principal pertenece a la habitación.
        roomId: key.type === KeyType.PRINCIPAL ? key.roomId : null,
        assignedAt: null,
        assignedById: null,
      },
    });
    await logMovement(tx, user, {
      keyId: key.id,
      action: key.type === KeyType.PRINCIPAL ? KeyAction.DEVUELTA : KeyAction.COPIA_RECUPERADA,
      fromStatus: key.status,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: key.roomId,
      stayId,
      note,
    });
  }

  return keys.length;
}

/** Deja las llaves de una salida marcadas como pendientes de devolución. */
export async function markKeysPendingReturn(
  tx: Tx,
  user: CurrentUser,
  stayId: string,
): Promise<number> {
  const keys = await tx.roomKey.findMany({
    where: { stayId, status: { in: [KeyStatus.ASIGNADA, KeyStatus.COPIA_ADICIONAL] } },
  });
  for (const key of keys) {
    await tx.roomKey.update({
      where: { id: key.id },
      data: { status: KeyStatus.PENDIENTE_DEVOLUCION },
    });
    await logMovement(tx, user, {
      keyId: key.id,
      action: KeyAction.MARCADA_PENDIENTE_DEVOLUCION,
      fromStatus: key.status,
      toStatus: KeyStatus.PENDIENTE_DEVOLUCION,
      roomId: key.roomId,
      stayId,
      note: 'Salida informada por el PMS',
    });
  }
  return keys.length;
}

// ------------------------------ Operaciones ------------------------------

/** Recibe una llave de vuelta en el mesón. */
export async function returnKey(
  user: CurrentUser,
  input: { keyId: string; note?: string | null },
): Promise<{ code: string }> {
  return prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('Esa llave no existe en el inventario.');
    if (!HELD_BY_GUEST.includes(key.status)) {
      throw new RuleError('Esa llave no está entregada, así que no hay nada que recibir.');
    }

    await tx.roomKey.update({
      where: { id: key.id },
      data: {
        status: KeyStatus.DISPONIBLE,
        stayId: null,
        roomId: key.type === KeyType.PRINCIPAL ? key.roomId : null,
        assignedAt: null,
        assignedById: null,
      },
    });
    await logMovement(tx, user, {
      keyId: key.id,
      action: key.type === KeyType.PRINCIPAL ? KeyAction.DEVUELTA : KeyAction.COPIA_RECUPERADA,
      fromStatus: key.status,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: key.roomId,
      stayId: key.stayId,
      note: input.note ?? 'Recibida en recepción',
    });
    return { code: key.code };
  });
}

/**
 * Entrega una copia adicional a una habitación.
 *
 * La copia se descuenta del stock y queda asociada a la estadía que está
 * dentro, de modo que al confirmar la salida vuelva sola al inventario.
 */
export async function giveExtraCopy(
  user: CurrentUser,
  input: { roomId: string; keyId?: string | null; note?: string | null },
): Promise<{ code: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: input.roomId } });
    if (!room) throw new NotFoundError('Esa habitación no existe en el inventario.');

    const occupant = await tx.roomStay.findFirst({
      where: {
        roomId: room.id,
        deletedAt: null,
        status: RoomStayStatus.IN_HOUSE,
        stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
      },
      select: { id: true },
    });

    const copy = input.keyId
      ? await tx.roomKey.findFirst({
          where: { id: input.keyId, status: KeyStatus.DISPONIBLE, type: { not: KeyType.PRINCIPAL } },
        })
      : await tx.roomKey.findFirst({
          where: { status: KeyStatus.DISPONIBLE, type: KeyType.COPIA, roomId: null },
          orderBy: { code: 'asc' },
        });
    if (!copy) {
      throw new RuleError(
        'No hay copias disponibles en el stock. Recupera una copia entregada o agrega llaves al inventario.',
      );
    }

    await tx.roomKey.update({
      where: { id: copy.id },
      data: {
        roomId: room.id,
        stayId: occupant?.id ?? null,
        status: KeyStatus.COPIA_ADICIONAL,
        assignedAt: new Date(),
        assignedById: user.id,
        notes: input.note ?? copy.notes,
      },
    });
    await logMovement(tx, user, {
      keyId: copy.id,
      action: KeyAction.COPIA_ENTREGADA,
      fromStatus: copy.status,
      toStatus: KeyStatus.COPIA_ADICIONAL,
      roomId: room.id,
      stayId: occupant?.id ?? null,
      note: input.note ?? null,
    });

    return { code: copy.code, roomNumber: room.number };
  });

  await recordAudit({
    entity: 'RoomKey',
    entityId: result.code,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary: `Copia adicional ${result.code} entregada a la habitación ${result.roomNumber}`,
  });

  return { code: result.code };
}

/** Cambia el estado de una llave a extraviada o fuera de servicio. */
export async function setKeyIncidentStatus(
  user: CurrentUser,
  input: { keyId: string; status: 'EXTRAVIADA' | 'FUERA_DE_SERVICIO'; reason: string },
): Promise<{ code: string }> {
  const target = input.status === 'EXTRAVIADA' ? KeyStatus.EXTRAVIADA : KeyStatus.FUERA_DE_SERVICIO;

  const result = await prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('Esa llave no existe en el inventario.');
    if (key.status === target) throw new RuleError('La llave ya está en ese estado.');

    await tx.roomKey.update({
      where: { id: key.id },
      data: { status: target, stayId: null, notes: input.reason },
    });
    await logMovement(tx, user, {
      keyId: key.id,
      action:
        target === KeyStatus.EXTRAVIADA
          ? KeyAction.MARCADA_EXTRAVIADA
          : KeyAction.MARCADA_FUERA_DE_SERVICIO,
      fromStatus: key.status,
      toStatus: target,
      roomId: key.roomId,
      stayId: key.stayId,
      note: input.reason,
    });
    return { code: key.code };
  });

  await recordAudit({
    entity: 'RoomKey',
    entityId: result.code,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary: `Llave ${result.code} marcada como ${target === KeyStatus.EXTRAVIADA ? 'extraviada' : 'fuera de servicio'}`,
    reason: input.reason,
  });

  return result;
}

/** Devuelve al stock una llave extraviada que apareció o una reparada. */
export async function reinstateKey(
  user: CurrentUser,
  input: { keyId: string; note?: string | null },
): Promise<{ code: string }> {
  return prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.findUnique({ where: { id: input.keyId } });
    if (!key) throw new NotFoundError('Esa llave no existe en el inventario.');
    const reinstatable: KeyStatus[] = [KeyStatus.EXTRAVIADA, KeyStatus.FUERA_DE_SERVICIO];
    if (!reinstatable.includes(key.status)) {
      throw new RuleError('Sólo se reintegran llaves extraviadas o fuera de servicio.');
    }

    await tx.roomKey.update({
      where: { id: key.id },
      data: { status: KeyStatus.DISPONIBLE, notes: input.note ?? null },
    });
    await logMovement(tx, user, {
      keyId: key.id,
      action: KeyAction.REINTEGRADA,
      fromStatus: key.status,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: key.roomId,
      note: input.note ?? null,
    });
    return { code: key.code };
  });
}

/** Agrega una llave al inventario. */
export async function createKey(
  user: CurrentUser,
  input: { code: string; type: KeyType; roomNumber?: string | null; notes?: string | null },
): Promise<{ code: string }> {
  const code = input.code.trim().toUpperCase();
  const existing = await prisma.roomKey.findUnique({ where: { code } });
  if (existing) throw new RuleError(`Ya existe una llave con el código ${code}.`);

  const room = input.roomNumber
    ? await prisma.room.findUnique({ where: { number: input.roomNumber } })
    : null;
  if (input.roomNumber && !room) {
    throw new RuleError(`La habitación ${input.roomNumber} no existe en el inventario.`);
  }
  if (room && input.type === KeyType.PRINCIPAL) {
    const principal = await prisma.roomKey.findFirst({
      where: { roomId: room.id, type: KeyType.PRINCIPAL, status: { not: KeyStatus.FUERA_DE_SERVICIO } },
    });
    if (principal) {
      throw new RuleError(
        `La habitación ${room.number} ya tiene llave principal (${principal.code}). ` +
          'Marca la anterior fuera de servicio antes de registrar otra.',
      );
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const key = await tx.roomKey.create({
      data: { code, type: input.type, roomId: room?.id ?? null, notes: input.notes ?? null },
    });
    await logMovement(tx, user, {
      keyId: key.id,
      action: KeyAction.CREADA,
      fromStatus: null,
      toStatus: KeyStatus.DISPONIBLE,
      roomId: room?.id ?? null,
      note: input.notes ?? null,
    });
    return key;
  });

  await recordAudit({
    entity: 'RoomKey',
    entityId: created.id,
    action: AuditAction.CREAR,
    user,
    summary: `Llave ${created.code} agregada al inventario`,
  });

  return { code: created.code };
}

// -------------------------------- Consultas -------------------------------

export type KeyRow = {
  id: string;
  code: string;
  type: KeyType;
  status: KeyStatus;
  roomNumber: string | null;
  guest: string | null;
  assignedAt: Date | null;
  assignedBy: string | null;
  notes: string | null;
};

export type KeyInventory = {
  keys: KeyRow[];
  stock: {
    /** Copias sin destino, listas para entregar. */
    copiesAvailable: number;
    /** Llaves principales en el tablero, sin entregar. */
    principalsAvailable: number;
    assigned: number;
    extraCopies: number;
    pendingReturn: number;
    lost: number;
    outOfService: number;
    total: number;
  };
};

export async function getKeyInventory(): Promise<KeyInventory> {
  const keys = await prisma.roomKey.findMany({
    orderBy: [{ status: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      notes: true,
      assignedAt: true,
      room: { select: { number: true } },
      stay: { select: { guestNames: true } },
      assignedBy: { select: { name: true } },
    },
  });

  const rows: KeyRow[] = keys.map((key) => ({
    id: key.id,
    code: key.code,
    type: key.type,
    status: key.status,
    roomNumber: key.room?.number ?? null,
    guest: key.stay?.guestNames[0] ?? null,
    assignedAt: key.assignedAt,
    assignedBy: key.assignedBy?.name ?? null,
    notes: key.notes,
  }));

  const count = (predicate: (row: KeyRow) => boolean) => rows.filter(predicate).length;

  return {
    keys: rows,
    stock: {
      copiesAvailable: count(
        (row) => row.status === KeyStatus.DISPONIBLE && row.type !== KeyType.PRINCIPAL && !row.roomNumber,
      ),
      principalsAvailable: count(
        (row) => row.status === KeyStatus.DISPONIBLE && row.type === KeyType.PRINCIPAL,
      ),
      assigned: count((row) => row.status === KeyStatus.ASIGNADA),
      extraCopies: count((row) => row.status === KeyStatus.COPIA_ADICIONAL),
      pendingReturn: count((row) => row.status === KeyStatus.PENDIENTE_DEVOLUCION),
      lost: count((row) => row.status === KeyStatus.EXTRAVIADA),
      outOfService: count((row) => row.status === KeyStatus.FUERA_DE_SERVICIO),
      total: rows.length,
    },
  };
}

export type MovementRow = {
  id: string;
  at: Date;
  code: string;
  action: KeyAction;
  fromStatus: KeyStatus | null;
  toStatus: KeyStatus;
  roomNumber: string | null;
  user: string;
  note: string | null;
};

export async function listKeyMovements(limit = 60): Promise<MovementRow[]> {
  const movements = await prisma.keyMovement.findMany({
    orderBy: { at: 'desc' },
    take: limit,
    select: {
      id: true,
      at: true,
      action: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      key: { select: { code: true } },
      room: { select: { number: true } },
      user: { select: { name: true } },
    },
  });

  return movements.map((movement) => ({
    id: movement.id,
    at: movement.at,
    code: movement.key.code,
    action: movement.action,
    fromStatus: movement.fromStatus,
    toStatus: movement.toStatus,
    roomNumber: movement.room?.number ?? null,
    user: movement.user.name,
    note: movement.note,
  }));
}

/** Llaves que pueden entregarse ahora mismo, para los selectores de la interfaz. */
export async function listAvailableKeys(): Promise<Array<{ value: string; label: string }>> {
  const keys = await prisma.roomKey.findMany({
    where: { status: KeyStatus.DISPONIBLE },
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, type: true, room: { select: { number: true } } },
  });
  return keys.map((key) => ({
    value: key.id,
    label:
      `${key.code} · ${key.type === KeyType.PRINCIPAL ? 'principal' : 'copia'}` +
      (key.room ? ` hab. ${key.room.number}` : ''),
  }));
}

export { OUT_OF_STOCK as KEY_STATUSES_OUT_OF_STOCK };
