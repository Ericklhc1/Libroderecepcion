import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InventoryBehavior,
  InventoryLocationKind,
  InventoryMovementKind,
  LaundryShipmentStatus,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import {
  listInventory,
  recordInventoryMovement,
  saveInventoryCategory,
  saveInventoryItem,
  saveInventoryLocation,
} from '@/server/services/inventory';
import {
  closeLaundryShipment,
  deliverLaundryShipment,
  prepareLaundryShipment,
  receiveLaundryShipment,
} from '@/server/services/laundry';

describe('Inventario común y lavandería', () => {
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  async function fixture() {
    const manager = await createUser({
      roleKey: ROLE_KEYS.HK_MANAGER,
      name: 'Ama de llaves sintética',
    });
    const hk = await prisma.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } });
    await prisma.user.update({ where: { id: manager.id }, data: { departmentId: hk.id } });

    const category = await saveInventoryCategory(manager, {
      departmentId: hk.id,
      name: 'Blancos',
    });
    const towel = await saveInventoryItem(manager, {
      categoryId: category.id,
      code: 'TOALLA-BANO',
      name: 'Toalla de baño',
      behavior: InventoryBehavior.LAVABLE,
      unit: 'pieza',
    });
    const warehouse = await saveInventoryLocation(manager, {
      key: 'HK-BODEGA',
      departmentId: hk.id,
      name: 'Bodega Housekeeping',
      kind: InventoryLocationKind.BODEGA,
    });
    const cartA = await saveInventoryLocation(manager, {
      key: 'HK-CARRO-A',
      departmentId: hk.id,
      name: 'Carro A',
      kind: InventoryLocationKind.CARRO,
    });
    const cartB = await saveInventoryLocation(manager, {
      key: 'HK-CARRO-B',
      departmentId: hk.id,
      name: 'Carro B',
      kind: InventoryLocationKind.CARRO,
    });
    const laundry = await saveInventoryLocation(manager, {
      key: 'LAV-EXTERNA',
      departmentId: null,
      name: 'Lavandería externa',
      kind: InventoryLocationKind.LAVANDERIA,
    });

    await recordInventoryMovement(manager, {
      requestKey: randomUUID(),
      itemId: towel.id,
      kind: InventoryMovementKind.ENTRADA,
      quantity: 100,
      toLocationId: warehouse.id,
      reason: 'Carga sintética inicial',
    });

    return { manager, hk, category, towel, warehouse, cartA, cartB, laundry };
  }

  async function balance(itemId: string, locationId: string) {
    return Number(
      (await prisma.inventoryBalance.findUnique({
        where: { itemId_locationId: { itemId, locationId } },
      }))?.quantity ?? 0,
    );
  }

  it('trasladar cambia custodia/ubicación sin reducir el total del hotel', async () => {
    const { manager, hk, towel, warehouse, cartA } = await fixture();

    const requestKey = randomUUID();
    const first = await recordInventoryMovement(manager, {
      requestKey,
      itemId: towel.id,
      kind: InventoryMovementKind.TRASLADO,
      quantity: 20,
      fromLocationId: warehouse.id,
      toLocationId: cartA.id,
      reason: 'Dotar carro de piso',
    });
    const retry = await recordInventoryMovement(manager, {
      requestKey,
      itemId: towel.id,
      kind: InventoryMovementKind.TRASLADO,
      quantity: 20,
      fromLocationId: warehouse.id,
      toLocationId: cartA.id,
      reason: 'Dotar carro de piso',
    });

    expect(retry.movement.id).toBe(first.movement.id);
    expect(retry.repeated).toBe(true);
    expect(await balance(towel.id, warehouse.id)).toBe(80);
    expect(await balance(towel.id, cartA.id)).toBe(20);

    const inventory = await listInventory(manager, hk.id);
    const item = inventory.items.find((row) => row.id === towel.id);
    expect(item?.total).toBe(100);
    expect(await prisma.inventoryMovement.count({ where: { requestKey } })).toBe(1);
  });

  it('evita existencias negativas incluso con dos traslados concurrentes', async () => {
    const { manager, towel, warehouse, cartA, cartB } = await fixture();

    const results = await Promise.allSettled([
      recordInventoryMovement(manager, {
        requestKey: randomUUID(),
        itemId: towel.id,
        kind: InventoryMovementKind.TRASLADO,
        quantity: 80,
        fromLocationId: warehouse.id,
        toLocationId: cartA.id,
        reason: 'Traslado concurrente A',
      }),
      recordInventoryMovement(manager, {
        requestKey: randomUUID(),
        itemId: towel.id,
        kind: InventoryMovementKind.TRASLADO,
        quantity: 80,
        fromLocationId: warehouse.id,
        toLocationId: cartB.id,
        reason: 'Traslado concurrente B',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await balance(towel.id, warehouse.id)).toBe(20);
    expect((await balance(towel.id, cartA.id)) + (await balance(towel.id, cartB.id))).toBe(80);
  });

  it('preparar no mueve stock y entregar sí cambia custodia a lavandería', async () => {
    const { manager, towel, warehouse, laundry } = await fixture();

    const prepared = await prepareLaundryShipment(manager, {
      requestKey: randomUUID(),
      originLocationId: warehouse.id,
      laundryLocationId: laundry.id,
      lines: [{ itemId: towel.id, sentQuantity: 100, weightSentKg: 52.4 }],
    });

    expect(prepared.shipment.status).toBe(LaundryShipmentStatus.PREPARADO);
    expect(await balance(towel.id, warehouse.id)).toBe(100);
    expect(await balance(towel.id, laundry.id)).toBe(0);

    await deliverLaundryShipment(manager, { id: prepared.shipment.id });

    expect(await balance(towel.id, warehouse.id)).toBe(0);
    expect(await balance(towel.id, laundry.id)).toBe(100);
    expect(
      (await prisma.laundryShipment.findUniqueOrThrow({ where: { id: prepared.shipment.id } })).status,
    ).toBe(LaundryShipmentStatus.ENTREGADO);
  });

  it('100 → 90 recibidas = 85 conformes + 5 reproceso + 10 pendientes, no 15 pérdidas', async () => {
    const { manager, towel, warehouse, laundry } = await fixture();
    const prepared = await prepareLaundryShipment(manager, {
      requestKey: randomUUID(),
      originLocationId: warehouse.id,
      laundryLocationId: laundry.id,
      notes: 'Folio de aceptación obligatorio',
      lines: [{ itemId: towel.id, sentQuantity: 100, weightSentKg: 52.4 }],
    });
    await deliverLaundryShipment(manager, { id: prepared.shipment.id });

    const receiveKey = randomUUID();
    const received = await receiveLaundryShipment(manager, {
      id: prepared.shipment.id,
      requestKey: receiveKey,
      withDifferences: true,
      note: 'Llegaron 90 piezas; cinco requieren reproceso.',
      lines: [{
        itemId: towel.id,
        receivedNow: 90,
        conformingNow: 85,
        reprocessNow: 5,
        weightReceivedKg: 46.8,
      }],
    });

    expect(received.shipment.status).toBe(LaundryShipmentStatus.RECIBIDO_DIFERENCIAS);
    const line = received.shipment.lines[0]!;
    expect(line.sentQuantity).toBe(100);
    expect(line.receivedQuantity).toBe(90);
    expect(line.conformingQuantity).toBe(85);
    expect(line.reprocessQuantity).toBe(5);
    expect(line.sentQuantity - line.receivedQuantity).toBe(10);
    expect(line.reprocessQuantity + (line.sentQuantity - line.receivedQuantity)).toBe(15);

    // El stock físico distingue disponible, reproceso y pendiente:
    // 85 vuelven a bodega; 5 regresan a lavandería y 10 nunca salieron de allí.
    expect(await balance(towel.id, warehouse.id)).toBe(85);
    expect(await balance(towel.id, laundry.id)).toBe(15);

    expect(received.shipment.differenceEntry).not.toBeNull();
    expect(await prisma.operationalEntry.count({
      where: { id: received.shipment.differenceEntryId ?? undefined },
    })).toBe(1);

    const retry = await receiveLaundryShipment(manager, {
      id: prepared.shipment.id,
      requestKey: receiveKey,
      withDifferences: true,
      note: 'Llegaron 90 piezas; cinco requieren reproceso.',
      lines: [{
        itemId: towel.id,
        receivedNow: 90,
        conformingNow: 85,
        reprocessNow: 5,
        weightReceivedKg: 46.8,
      }],
    });
    expect(retry.receiptId).toBe(received.receiptId);
    expect(retry.repeated).toBe(true);
    expect(await prisma.laundryReceipt.count({ where: { shipmentId: prepared.shipment.id } })).toBe(1);
    expect(await balance(towel.id, warehouse.id)).toBe(85);
    expect(await balance(towel.id, laundry.id)).toBe(15);

    // La discrepancia del primer folio no bloquea preparar otro envío.
    const another = await prepareLaundryShipment(manager, {
      requestKey: randomUUID(),
      originLocationId: warehouse.id,
      laundryLocationId: laundry.id,
      lines: [{ itemId: towel.id, sentQuantity: 10 }],
    });
    expect(another.shipment.status).toBe(LaundryShipmentStatus.PREPARADO);
    expect(await balance(towel.id, warehouse.id)).toBe(85);
  });

  it('resuelve reproceso y pendientes sin borrar la incidencia ni inventar conversiones por peso', async () => {
    const { manager, towel, warehouse, laundry } = await fixture();
    const prepared = await prepareLaundryShipment(manager, {
      requestKey: randomUUID(),
      originLocationId: warehouse.id,
      laundryLocationId: laundry.id,
      lines: [{ itemId: towel.id, sentQuantity: 100, weightSentKg: 52.4 }],
    });
    await deliverLaundryShipment(manager, { id: prepared.shipment.id });

    const first = await receiveLaundryShipment(manager, {
      id: prepared.shipment.id,
      requestKey: randomUUID(),
      withDifferences: true,
      lines: [{
        itemId: towel.id,
        receivedNow: 90,
        conformingNow: 85,
        reprocessNow: 5,
        weightReceivedKg: 46.8,
      }],
    });
    const incidentId = first.shipment.differenceEntryId;
    expect(incidentId).toBeTruthy();

    const repro = await receiveLaundryShipment(manager, {
      id: prepared.shipment.id,
      requestKey: randomUUID(),
      lines: [{
        itemId: towel.id,
        receivedNow: 0,
        conformingNow: 5,
        reprocessNow: 0,
        reprocessResolvedNow: 5,
        weightReceivedKg: 2.1,
      }],
    });
    expect(repro.shipment.status).toBe(LaundryShipmentStatus.PARCIAL);
    expect(repro.shipment.lines[0]!.receivedQuantity).toBe(90);
    expect(repro.shipment.lines[0]!.conformingQuantity).toBe(90);
    expect(repro.shipment.lines[0]!.reprocessQuantity).toBe(0);
    expect(await balance(towel.id, warehouse.id)).toBe(90);
    expect(await balance(towel.id, laundry.id)).toBe(10);

    await expect(closeLaundryShipment(manager, { id: prepared.shipment.id }))
      .rejects.toThrow(/quedan 10 pieza\(s\) pendientes/i);

    const final = await receiveLaundryShipment(manager, {
      id: prepared.shipment.id,
      requestKey: randomUUID(),
      lines: [{
        itemId: towel.id,
        receivedNow: 10,
        conformingNow: 10,
        reprocessNow: 0,
        weightReceivedKg: 7.9,
      }],
    });
    expect(final.shipment.status).toBe(LaundryShipmentStatus.RECIBIDO);
    expect(await balance(towel.id, warehouse.id)).toBe(100);
    expect(await balance(towel.id, laundry.id)).toBe(0);

    const closed = await closeLaundryShipment(manager, {
      id: prepared.shipment.id,
      note: 'Folio conciliado por piezas.',
    });
    expect(closed.status).toBe(LaundryShipmentStatus.CERRADO);

    // El incidente permanece como historial/seguimiento; el cierre no lo borra.
    expect(await prisma.operationalEntry.count({ where: { id: incidentId! } })).toBe(1);
    const storedLine = await prisma.laundryShipmentLine.findFirstOrThrow({
      where: { shipmentId: prepared.shipment.id, itemId: towel.id },
    });
    expect(Number(storedLine.weightReceivedKg)).toBeCloseTo(56.8);
    expect(storedLine.receivedQuantity).toBe(100);
  });
});
