import {createNativeEntry,lockNativeNoveltyCreation} from '@/server/services/native-entry-creation';
import 'server-only';

import {
  AuditAction,
  EntryType,
  InventoryBehavior,
  InventoryLocationKind,
  InventoryMovementKind,
  LaundryShipmentStatus,
  Prisma,
  Priority,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import {
  applyInventoryMovement,
  inventoryDepartmentIds,
} from '@/server/services/inventory';

type Tx = Prisma.TransactionClient;

function requireLaundry(user: CurrentUser) {
  if (!user.permissions.includes('laundry.manage')) {
    throw new ForbiddenError('No tienes permiso para gestionar lavandería.');
  }
}

function safeKey(value: string) {
  if (!/^[A-Za-z0-9:_-]{8,180}$/.test(value)) {
    throw new RuleError('La referencia de la operación no es válida.');
  }
  return value;
}

function number(value: Prisma.Decimal | number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

async function assertOriginScope(
  tx: Tx,
  user: CurrentUser,
  origin: { departmentId: string | null; name: string },
) {
  if (user.isSystemAdmin || user.permissions.includes('inventory.manage')) return;
  if (!origin.departmentId) {
    throw new ForbiddenError(`La ubicación «${origin.name}» requiere administración de inventario.`);
  }
  const scope = await inventoryDepartmentIds(user, tx);
  if (!scope.includes(origin.departmentId)) {
    throw new ForbiddenError(`La ubicación «${origin.name}» está fuera de tu alcance.`);
  }
}

export type LaundryPrepareLine = {
  itemId: string;
  sentQuantity: number;
  weightSentKg?: number | null;
  notes?: string | null;
};

export async function prepareLaundryShipment(
  user: CurrentUser,
  input: {
    requestKey: string;
    originLocationId: string;
    laundryLocationId: string;
    notes?: string | null;
    lines: LaundryPrepareLine[];
  },
) {
  requireLaundry(user);
  safeKey(input.requestKey);
  if (!input.lines.length) throw new RuleError('Agrega al menos un artículo al envío.');
  if (new Set(input.lines.map((line) => line.itemId)).size !== input.lines.length) {
    throw new RuleError('Cada artículo debe aparecer una sola vez en el folio.');
  }

  return prisma.$transaction(async (tx) => {
    await lockNativeNoveltyCreation(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))::text`;

    const existing = await tx.laundryShipment.findUnique({
      where: { requestKey: input.requestKey },
      include: { lines: true },
    });
    if (existing) {
      const same =
        existing.preparedById === user.id &&
        existing.originLocationId === input.originLocationId &&
        existing.laundryLocationId === input.laundryLocationId &&
        existing.notes === (input.notes?.trim() || null) &&
        existing.lines.length === input.lines.length &&
        existing.lines.every((row) => {
          const incoming = input.lines.find((line) => line.itemId === row.itemId);
          return Boolean(
            incoming &&
            incoming.sentQuantity === row.sentQuantity &&
            number(row.weightSentKg) === (incoming.weightSentKg ?? 0) &&
            row.notes === (incoming.notes?.trim() || null),
          );
        });
      if (!same) throw new RuleError('Este folio ya fue preparado con otro contenido.');
      return { shipment: existing, repeated: true };
    }

    const [origin, laundry] = await Promise.all([
      tx.inventoryLocation.findFirst({
        where: { id: input.originLocationId, active: true },
        select: { id: true, name: true, kind: true, departmentId: true },
      }),
      tx.inventoryLocation.findFirst({
        where: {
          id: input.laundryLocationId,
          active: true,
          kind: InventoryLocationKind.LAVANDERIA,
        },
        select: { id: true, name: true, kind: true, departmentId: true },
      }),
    ]);
    if (!origin || !laundry) throw new RuleError('Revisa origen y destino de lavandería.');
    if (origin.id === laundry.id) throw new RuleError('Origen y lavandería deben ser ubicaciones distintas.');
    await assertOriginScope(tx, user, origin);

    const itemIds = input.lines.map((line) => line.itemId);
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: itemIds }, active: true },
      select: { id: true, name: true, behavior: true, trackIndividually: true },
    });
    if (items.length !== itemIds.length) throw new RuleError('Hay artículos inexistentes o archivados.');
    const balances = await tx.inventoryBalance.findMany({
      where: { locationId: origin.id, itemId: { in: itemIds } },
    });
    const available = new Map(balances.map((row) => [row.itemId, number(row.quantity)]));

    for (const line of input.lines) {
      if (!Number.isInteger(line.sentQuantity) || line.sentQuantity <= 0) {
        throw new RuleError('Las cantidades enviadas deben ser piezas enteras mayores que cero.');
      }
      if (line.weightSentKg != null && (!(line.weightSentKg >= 0) || !Number.isFinite(line.weightSentKg))) {
        throw new RuleError('El peso informado no es válido.');
      }
      const item = items.find((row) => row.id === line.itemId)!;
      if (item.behavior !== InventoryBehavior.LAVABLE) {
        throw new RuleError(`${item.name} no está configurado como artículo lavable.`);
      }
      if (item.trackIndividually) {
        throw new RuleError(`${item.name} se sigue por unidad identificada y no puede enviarse por cantidad en este folio.`);
      }
      if ((available.get(line.itemId) ?? 0) < line.sentQuantity) {
        throw new RuleError(`No hay suficientes piezas disponibles de ${item.name} en ${origin.name}.`);
      }
    }

    const shipment = await tx.laundryShipment.create({
      data: {
        requestKey: input.requestKey,
        originLocationId: origin.id,
        laundryLocationId: laundry.id,
        preparedById: user.id,
        notes: input.notes?.trim() || null,
        lines: {
          create: input.lines.map((line) => ({
            itemId: line.itemId,
            sentQuantity: line.sentQuantity,
            weightSentKg:
              line.weightSentKg == null ? null : new Prisma.Decimal(line.weightSentKg),
            notes: line.notes?.trim() || null,
          })),
        },
      },
      include: { lines: true },
    });

    await recordAudit(
      {
        entity: 'LaundryShipment',
        entityId: shipment.id,
        action: AuditAction.CREAR,
        user,
        summary: `Lavandería folio ${shipment.folio} preparado · ${input.lines.reduce((sum, line) => sum + line.sentQuantity, 0)} pieza(s)`,
        after: {
          status: shipment.status,
          originLocationId: origin.id,
          laundryLocationId: laundry.id,
          lines: input.lines,
        },
      },
      tx,
    );
    return { shipment, repeated: false };
  });
}

export async function deliverLaundryShipment(
  user: CurrentUser,
  input: { id: string; note?: string | null },
) {
  requireLaundry(user);
  return prisma.$transaction(async (tx) => {
    await lockNativeNoveltyCreation(tx);
    await tx.$queryRaw`SELECT "id" FROM "LaundryShipment" WHERE "id"=${input.id} FOR UPDATE`;
    const shipment = await tx.laundryShipment.findUnique({
      where: { id: input.id },
      include: {
        lines: { include: { item: { select: { name: true } } } },
        originLocation: { select: { name: true, departmentId: true } },
        laundryLocation: { select: { name: true, departmentId: true } },
      },
    });
    if (!shipment) throw new NotFoundError('El folio de lavandería no existe.');
    await assertOriginScope(tx, user, shipment.originLocation);
    if (shipment.status !== LaundryShipmentStatus.PREPARADO) {
      if (shipment.deliveredAt) return { shipment, repeated: true };
      throw new RuleError('Este folio ya no está en preparación.');
    }

    for (const line of shipment.lines) {
      await applyInventoryMovement(
        tx,
        user,
        {
          requestKey: `laundry:${shipment.id}:deliver:${line.itemId}`,
          itemId: line.itemId,
          kind: InventoryMovementKind.TRASLADO,
          quantity: line.sentQuantity,
          fromLocationId: shipment.originLocationId,
          toLocationId: shipment.laundryLocationId,
          reason: `Entrega física a lavandería · folio ${shipment.folio}`,
          notes: input.note?.trim() || null,
          laundryShipmentId: shipment.id,
        },
        { permission: 'laundry.manage', allowGlobal: true },
      );
    }

    const updated = await tx.laundryShipment.update({
      where: { id: shipment.id },
      data: {
        status: LaundryShipmentStatus.ENTREGADO,
        deliveredById: user.id,
        deliveredAt: new Date(),
      },
      include: { lines: true },
    });

    await recordAudit(
      {
        entity: 'LaundryShipment',
        entityId: shipment.id,
        action: AuditAction.CAMBIO_ESTADO,
        user,
        summary: `Lavandería folio ${shipment.folio}: entrega física confirmada`,
        before: { status: shipment.status },
        after: { status: updated.status },
      },
      tx,
    );
    return { shipment: updated, repeated: false };
  }, { timeout: 15000 });
}

export type LaundryReceiveLine = {
  itemId: string;
  receivedNow: number;
  conformingNow: number;
  reprocessNow: number;
  reprocessResolvedNow?: number;
  weightReceivedKg?: number | null;
  notes?: string | null;
};

export async function receiveLaundryShipment(
  user: CurrentUser,
  input: {
    id: string;
    requestKey: string;
    withDifferences?: boolean;
    note?: string | null;
    lines: LaundryReceiveLine[];
  },
) {
  requireLaundry(user);
  safeKey(input.requestKey);
  if (!input.lines.length) throw new RuleError('Indica al menos una línea recibida.');

  return prisma.$transaction(async (tx) => {
    await lockNativeNoveltyCreation(tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))::text`;
    const prior = await tx.laundryReceipt.findUnique({
      where: { requestKey: input.requestKey },
      include: { shipment: { include: { lines: true } } },
    });
    if (prior) {
      return { shipment: prior.shipment, receiptId: prior.id, repeated: true };
    }

    await tx.$queryRaw`SELECT "id" FROM "LaundryShipment" WHERE "id"=${input.id} FOR UPDATE`;
    const shipment = await tx.laundryShipment.findUnique({
      where: { id: input.id },
      include: {
        lines: { include: { item: { select: { name: true } } } },
        originLocation: { select: { id: true, name: true, departmentId: true } },
        laundryLocation: { select: { id: true, name: true, departmentId: true } },
      },
    });
    if (!shipment) throw new NotFoundError('El folio de lavandería no existe.');
    await assertOriginScope(tx, user, shipment.originLocation);
    if (shipment.status !== LaundryShipmentStatus.ENTREGADO && shipment.status !== LaundryShipmentStatus.PARCIAL && shipment.status !== LaundryShipmentStatus.RECIBIDO_DIFERENCIAS) {
      throw new RuleError('Este folio no admite otra recepción en su estado actual.');
    }
    if (new Set(input.lines.map((line) => line.itemId)).size !== input.lines.length) {
      throw new RuleError('Cada artículo debe aparecer una sola vez en esta recepción.');
    }

    const updatedLineIds: string[] = [];
    for (const incoming of input.lines) {
      const line = shipment.lines.find((row) => row.itemId === incoming.itemId);
      if (!line) throw new RuleError('La recepción contiene un artículo que no pertenece al folio.');
      const resolved = incoming.reprocessResolvedNow ?? 0;
      for (const value of [incoming.receivedNow, incoming.conformingNow, incoming.reprocessNow, resolved]) {
        if (!Number.isInteger(value) || value < 0) {
          throw new RuleError('Las cantidades de recepción deben ser enteros iguales o mayores que cero.');
        }
      }
      if (incoming.conformingNow + incoming.reprocessNow !== incoming.receivedNow + resolved) {
        throw new RuleError(
          'Cada pieza informada debe quedar conforme o en reproceso; la resolución de reproceso no cuenta como una nueva pieza recibida.',
        );
      }
      if (line.receivedQuantity + incoming.receivedNow > line.sentQuantity) {
        throw new RuleError(`La recepción de ${line.item.name} supera las piezas enviadas.`);
      }
      if (resolved > line.reprocessQuantity) {
        throw new RuleError(`No hay tantas piezas de ${line.item.name} pendientes de reproceso.`);
      }
      const nextReceived = line.receivedQuantity + incoming.receivedNow;
      const nextConforming = line.conformingQuantity + incoming.conformingNow;
      const nextReprocess = line.reprocessQuantity + incoming.reprocessNow - resolved;
      if (nextConforming + nextReprocess > nextReceived) {
        throw new RuleError(`Las cantidades de ${line.item.name} no concilian.`);
      }

      if (incoming.receivedNow > 0) {
        await applyInventoryMovement(
          tx,
          user,
          {
            requestKey: `laundry:${input.requestKey}:receive:${line.itemId}`,
            itemId: line.itemId,
            kind: InventoryMovementKind.DEVOLUCION,
            quantity: incoming.receivedNow,
            fromLocationId: shipment.laundryLocationId,
            toLocationId: shipment.originLocationId,
            reason: `Recepción de lavandería · folio ${shipment.folio}`,
            notes: incoming.notes?.trim() || input.note?.trim() || null,
            laundryShipmentId: shipment.id,
          },
          { permission: 'laundry.manage', allowGlobal: true },
        );
      }
      if (incoming.reprocessNow > 0) {
        await applyInventoryMovement(
          tx,
          user,
          {
            requestKey: `laundry:${input.requestKey}:reprocess:${line.itemId}`,
            itemId: line.itemId,
            kind: InventoryMovementKind.REPROCESO,
            quantity: incoming.reprocessNow,
            fromLocationId: shipment.originLocationId,
            toLocationId: shipment.laundryLocationId,
            reason: `Reproceso de lavandería · folio ${shipment.folio}`,
            notes: incoming.notes?.trim() || input.note?.trim() || null,
            laundryShipmentId: shipment.id,
          },
          { permission: 'laundry.manage', allowGlobal: true },
        );
      }
      if (resolved > 0) {
        await applyInventoryMovement(
          tx,
          user,
          {
            requestKey: `laundry:${input.requestKey}:resolved:${line.itemId}`,
            itemId: line.itemId,
            kind: InventoryMovementKind.DEVOLUCION,
            quantity: resolved,
            fromLocationId: shipment.laundryLocationId,
            toLocationId: shipment.originLocationId,
            reason: `Reproceso conforme · folio ${shipment.folio}`,
            notes: incoming.notes?.trim() || input.note?.trim() || null,
            laundryShipmentId: shipment.id,
          },
          { permission: 'laundry.manage', allowGlobal: true },
        );
      }

      await tx.laundryShipmentLine.update({
        where: { id: line.id },
        data: {
          receivedQuantity: nextReceived,
          conformingQuantity: nextConforming,
          reprocessQuantity: nextReprocess,
          ...(incoming.weightReceivedKg == null
            ? {}
            : {
                weightReceivedKg: new Prisma.Decimal(
                  number(line.weightReceivedKg) + incoming.weightReceivedKg,
                ),
              }),
          ...(incoming.notes !== undefined ? { notes: incoming.notes?.trim() || null } : {}),
        },
      });
      updatedLineIds.push(line.id);
    }

    const currentLines = await tx.laundryShipmentLine.findMany({
      where: { shipmentId: shipment.id },
      include: { item: { select: { name: true } } },
      orderBy: { item: { name: 'asc' } },
    });
    const pending = currentLines.reduce(
      (sum, line) => sum + Math.max(0, line.sentQuantity - line.receivedQuantity),
      0,
    );
    const reprocess = currentLines.reduce((sum, line) => sum + line.reprocessQuantity, 0);
    const hasDifferences = Boolean(input.withDifferences) || reprocess > 0;
    const nextStatus =
      pending === 0 && reprocess === 0
        ? LaundryShipmentStatus.RECIBIDO
        : hasDifferences
          ? LaundryShipmentStatus.RECIBIDO_DIFERENCIAS
          : LaundryShipmentStatus.PARCIAL;

    let differenceEntryId = shipment.differenceEntryId;
    if (hasDifferences && !differenceEntryId) {
      const fallbackDepartment = shipment.originLocation.departmentId
        ? null
        : await tx.department.findFirst({
            where: { key: 'HOUSEKEEPING', active: true },
            select: { id: true },
          });
      const entry = await createNativeEntry(tx,{
        data: {
          type: EntryType.INCIDENCIA,
          title: `Lavandería folio ${shipment.folio}: diferencias`,
          description: [
            `Folio ${shipment.folio} recibido con diferencias.`,
            `Pendientes: ${pending} pieza(s).`,
            `En reproceso: ${reprocess} pieza(s).`,
            input.note?.trim() || null,
          ].filter(Boolean).join('\n'),
          departmentId: shipment.originLocation.departmentId ?? fallbackDepartment?.id ?? null,
          priority: Priority.MEDIA,
          createdById: user.id,
        },
      });
      differenceEntryId = entry.id;
    }

    const receipt = await tx.laundryReceipt.create({
      data: {
        requestKey: input.requestKey,
        shipmentId: shipment.id,
        receivedById: user.id,
        payload: JSON.parse(JSON.stringify({
          lines: input.lines,
          withDifferences: Boolean(input.withDifferences),
          note: input.note?.trim() || null,
          pending,
          reprocess,
        })) as Prisma.InputJsonValue,
      },
    });

    const updated = await tx.laundryShipment.update({
      where: { id: shipment.id },
      data: {
        status: nextStatus,
        receivedById: user.id,
        receivedAt: new Date(),
        differenceEntryId,
      },
      include: {
        lines: { include: { item: { select: { name: true } } } },
        differenceEntry: { select: { id: true, humanId: true, status: true } },
      },
    });

    await recordAudit(
      {
        entity: 'LaundryShipment',
        entityId: shipment.id,
        action: AuditAction.CAMBIO_ESTADO,
        user,
        summary:
          `Lavandería folio ${shipment.folio}: recepción registrada · ${pending} pendiente(s), ${reprocess} en reproceso`,
        before: { status: shipment.status },
        after: {
          status: nextStatus,
          receiptId: receipt.id,
          pending,
          reprocess,
          differenceEntryId,
          updatedLineIds,
        },
      },
      tx,
    );

    return { shipment: updated, receiptId: receipt.id, repeated: false };
  }, { timeout: 20000 });
}

export async function closeLaundryShipment(
  user: CurrentUser,
  input: { id: string; note?: string | null },
) {
  requireLaundry(user);
  return prisma.$transaction(async (tx) => {
    await lockNativeNoveltyCreation(tx);
    await tx.$queryRaw`SELECT "id" FROM "LaundryShipment" WHERE "id"=${input.id} FOR UPDATE`;
    const shipment = await tx.laundryShipment.findUnique({
      where: { id: input.id },
      include: { lines: true },
    });
    if (!shipment) throw new NotFoundError('El folio de lavandería no existe.');
    if (shipment.status === LaundryShipmentStatus.CERRADO) return shipment;
    const pending = shipment.lines.reduce(
      (sum, line) => sum + Math.max(0, line.sentQuantity - line.receivedQuantity),
      0,
    );
    const reprocess = shipment.lines.reduce((sum, line) => sum + line.reprocessQuantity, 0);
    if (pending > 0 || reprocess > 0) {
      throw new RuleError(
        `No se puede cerrar: quedan ${pending} pieza(s) pendientes y ${reprocess} en reproceso. El folio puede seguir operando sin bloquear nuevos envíos.`,
      );
    }
    const updated = await tx.laundryShipment.update({
      where: { id: shipment.id },
      data: {
        status: LaundryShipmentStatus.CERRADO,
        notes: input.note?.trim()
          ? [shipment.notes, input.note.trim()].filter(Boolean).join('\n')
          : shipment.notes,
      },
    });
    await recordAudit(
      {
        entity: 'LaundryShipment',
        entityId: shipment.id,
        action: AuditAction.CERRAR,
        user,
        summary: `Lavandería folio ${shipment.folio} cerrado sin saldo pendiente`,
      },
      tx,
    );
    return updated;
  });
}

export async function listLaundryShipments(user: CurrentUser, take = 50) {
  requireLaundry(user);
  const scope = await inventoryDepartmentIds(user);
  const all =
    user.isSystemAdmin ||
    user.permissions.includes('inventory.manage') ||
    user.permissions.includes('inventory.view') && user.roleKey === 'GERENCIA';

  return prisma.laundryShipment.findMany({
    where: all
      ? {}
      : {
          originLocation: {
            OR: [{ departmentId: { in: scope } }, { departmentId: null }],
          },
        },
    include: {
      originLocation: { select: { name: true } },
      laundryLocation: { select: { name: true } },
      preparedBy: { select: { name: true } },
      deliveredBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      differenceEntry: { select: { id: true, humanId: true, status: true } },
      lines: {
        include: { item: { select: { id: true, name: true, code: true, unit: true } } },
        orderBy: { item: { name: 'asc' } },
      },
      receipts: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(take, 100)),
  });
}
