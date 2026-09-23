import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyStatus, KeyType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import {
  assignPhysicalKey,
  createPhysicalKey,
  getPhysicalKeyInventory,
  listRecentPhysicalKeyCounts,
  markPhysicalKeyIncident,
  returnPhysicalKey,
  savePhysicalKeyInventoryCount,
} from '@/server/services/key-inventory';
import { ROLE_PERMISSIONS } from '@/lib/permissions';

describe('inventario físico de llaves independiente de PMS', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  it('entrega y recibe una llave sin crear ni consultar estadías o reservas', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción llaves',
    });
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión llaves',
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '401' } });

    const key = await createPhysicalKey(supervisor, {
      code: 'F-401-C2',
      roomId: room.id,
      type: KeyType.COPIA,
      notes: 'Copia física identificada',
    });

    expect(await prisma.roomStay.count()).toBe(0);
    expect(await prisma.reservationReference.count()).toBe(0);

    await assignPhysicalKey(receptionist, {
      keyId: key.id,
      roomId: room.id,
      note: 'Entrega física',
    });

    const assigned = await prisma.roomKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(assigned.status).toBe(KeyStatus.COPIA_ADICIONAL);
    expect(assigned.stayId).toBeNull();

    const movement = await prisma.keyMovement.findFirstOrThrow({
      where: { keyId: key.id, action: 'COPIA_ENTREGADA' },
      orderBy: { at: 'desc' },
    });
    expect(movement.stayId).toBeNull();
    expect(movement.roomId).toBe(room.id);

    await returnPhysicalKey(receptionist, { keyId: key.id, note: 'Devuelta al mesón' });
    const returned = await prisma.roomKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(returned.status).toBe(KeyStatus.DISPONIBLE);
    expect(returned.stayId).toBeNull();

    expect(await prisma.roomStay.count()).toBe(0);
    expect(await prisma.reservationReference.count()).toBe(0);
  });

  it('guarda un conteo completo del piso y calcula faltantes y sobrantes', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción inventario',
    });
    const inventory = await getPhysicalKeyInventory({ floor: 4 });

    expect(inventory.rooms).toHaveLength(29);
    expect(inventory.summary.expected).toBe(29);

    const items = inventory.rooms.map((room, index) => ({
      roomId: room.roomId,
      found: index === 0 ? Math.max(room.expected - 1, 0) : room.expected,
      outOfService: room.outOfService,
      notes: index === 0 ? 'No apareció durante el conteo' : null,
    }));

    const count = await savePhysicalKeyInventoryCount(receptionist, {
      floor: 4,
      notes: 'Conteo de prueba sin PMS',
      items,
    });

    expect(count.totals.expected).toBe(29);
    expect(count.totals.found).toBe(28);
    expect(count.totals.missing).toBe(1);
    expect(count.totals.surplus).toBe(0);

    const history = await listRecentPhysicalKeyCounts(4);
    expect(history[0]?.id).toBe(count.id);
    expect(history[0]?.totals.missing).toBe(1);

    expect(await prisma.roomStay.count()).toBe(0);
    expect(await prisma.pmsImportBatch.count()).toBe(0);
  });

  it('registra extravío como hecho físico sin vínculo a una estadía', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión incidente llave',
    });
    const key = await prisma.roomKey.findUniqueOrThrow({ where: { code: 'P-402' } });

    await markPhysicalKeyIncident(supervisor, {
      keyId: key.id,
      status: 'EXTRAVIADA',
      reason: 'No apareció en el tablero físico',
    });

    const updated = await prisma.roomKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(updated.status).toBe(KeyStatus.EXTRAVIADA);
    expect(updated.stayId).toBeNull();

    const movement = await prisma.keyMovement.findFirstOrThrow({
      where: { keyId: key.id, action: 'MARCADA_EXTRAVIADA' },
      orderBy: { at: 'desc' },
    });
    expect(movement.stayId).toBeNull();
  });

  it('la matriz operativa ya no concede PMS ni gestión de reservas/habitaciones', () => {
    for (const role of [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.NIGHT_AUDITOR, ROLE_KEYS.SUPERVISOR]) {
      expect(ROLE_PERMISSIONS[role]).toContain('key.inventory');
      expect(ROLE_PERMISSIONS[role]).not.toContain('pms.import');
      expect(ROLE_PERMISSIONS[role]).not.toContain('room.manage');
      expect(ROLE_PERMISSIONS[role]).not.toContain('guest.manage');
    }
  });
});
