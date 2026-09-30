import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, GuaranteeKind, GuaranteeState, Priority } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { roomNumbers } from '@/domain/room-catalog';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createGuarantee } from '@/server/services/guarantees';
import { createGymPass, createParkingPass } from '@/server/services/gym-pass';
import { getRoomMonitor } from '@/server/services/room-monitor';

describe('Novedades / Habitación', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('define exactamente las 89 habitaciones operativas del hotel', () => {
    const rooms = roomNumbers();
    expect(rooms).toHaveLength(89);
    expect(rooms[0]).toEqual({ number: '401', floor: 4 });
    expect(rooms[28]).toEqual({ number: '429', floor: 4 });
    expect(rooms[29]).toEqual({ number: '501', floor: 5 });
    expect(rooms[58]).toEqual({ number: '530', floor: 5 });
    expect(rooms[59]).toEqual({ number: '601', floor: 6 });
    expect(rooms[88]).toEqual({ number: '630', floor: 6 });
  });

  it('una Novedad vinculada enciende el monitor de su habitación', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '512' } });

    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Aire acondicionado con ruido',
      description: 'Se deja informado para continuidad.',
      priority: Priority.MEDIA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });

    expect(entry.roomId).toBe(room.id);

    const monitor = await getRoomMonitor('512');
    expect(monitor.selected?.room.number).toBe('512');
    expect(monitor.selected?.summary.activeCount).toBeGreaterThanOrEqual(1);
    expect(
      monitor.selected?.items.some(
        (item) => item.kind === 'entry' && item.id === entry.id && item.open,
      ),
    ).toBe(true);
  });

  it('una Tarea derivada hereda la habitación de la Novedad sin pedirla otra vez', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '604' } });
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Revisar cerradura',
      description: 'Contexto de prueba.',
      priority: Priority.ALTA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: true,
    });

    const task = await createTask(user, {
      title: 'Verificar cerradura con Mantenimiento',
      priority: Priority.ALTA,
      entryId: entry.id,
      tags: [],
      checklist: [],
    });

    expect(task.roomId).toBe(room.id);

    const monitor = await getRoomMonitor('604');
    expect(monitor.selected?.items.some((item) => item.kind === 'task' && item.id === task.id)).toBe(
      true,
    );
  });

  it('una Garantía con habitación seleccionada aparece en el mismo monitor', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '425' } });

    const guarantee = await createGuarantee(user, {
      roomId: room.id,
      guestName: 'Contexto operativo',
      kind: GuaranteeKind.TARJETA,
      amount: 100000,
      currency: 'CLP',
      state: GuaranteeState.VIGENTE,
    });

    const stored = await prisma.guarantee.findUniqueOrThrow({ where: { id: guarantee.id } });
    expect(stored.roomNumber).toBe('425');

    const monitor = await getRoomMonitor('425');
    expect(
      monitor.selected?.items.some(
        (item) => item.kind === 'guarantee' && item.id === guarantee.id,
      ),
    ).toBe(true);
  });

  it('folios nuevos resuelven Room.id y Estacionamiento usa ID Reserva', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await openShiftAs(user);

    const gym = await createGymPass(user, {
      serviceDate: '2026-09-30',
      roomNumber: '501',
      guestName: 'Gimnasio',
    });
    const parking = await createParkingPass(user, {
      serviceDate: '2026-09-30',
      roomNumber: '502',
      guestName: 'Estacionamiento',
      reservationCode: 'FNS-7526721',
    });

    const [gymRow, parkingRow] = await Promise.all([
      prisma.gymPass.findUniqueOrThrow({ where: { id: gym.id } }),
      prisma.gymPass.findUniqueOrThrow({ where: { id: parking.id } }),
    ]);

    expect(gymRow.roomId).not.toBeNull();
    expect(parkingRow.roomId).not.toBeNull();
    expect(parkingRow.reservationCode).toBe('FNS-7526721');
    expect(parkingRow.vehiclePlate).toBeNull();

    const monitor = await getRoomMonitor('502');
    expect(
      monitor.selected?.items.some(
        (item) => item.kind === 'parking' && item.title.includes('FNS-7526721'),
      ),
    ).toBe(true);
  });

  it('la interfaz del monitor no representa ocupación ni ciclo PMS', () => {
    const source = require('node:fs').readFileSync(
      'src/app/(app)/libro/habitaciones/page.tsx',
      'utf8',
    );
    expect(source).toContain('No muestra ocupación');
    expect(source).not.toContain('IN_HOUSE');
    expect(source).not.toContain('CHECK_IN_LISTO');
    expect(source).not.toContain('CHECK_OUT_PENDIENTE');
    expect(source).not.toContain('Llegadas');
  });
});
