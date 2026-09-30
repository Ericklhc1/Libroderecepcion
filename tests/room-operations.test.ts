import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { HOTEL_ROOMS, HOTEL_ROOM_NUMBERS } from '@/domain/hotel-rooms';
import { getFormOptions } from '@/server/services/options';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { getRoomOperationsBoard } from '@/server/services/room-operations';

describe('Novedades · Habitaciones', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('usa exactamente las 89 habitaciones operativas del hotel', async () => {
    expect(HOTEL_ROOMS).toHaveLength(89);
    expect(HOTEL_ROOM_NUMBERS.slice(0, 3)).toEqual(['401', '402', '403']);
    expect(HOTEL_ROOM_NUMBERS).toContain('429');
    expect(HOTEL_ROOM_NUMBERS).toContain('501');
    expect(HOTEL_ROOM_NUMBERS).toContain('530');
    expect(HOTEL_ROOM_NUMBERS).toContain('601');
    expect(HOTEL_ROOM_NUMBERS.at(-1)).toBe('630');

    const options = await getFormOptions();
    expect(options.rooms).toHaveLength(89);
    expect(options.rooms.map((room) => room.label)).toEqual(HOTEL_ROOM_NUMBERS);
  });

  it('reúne Novedades y Tareas por habitación sin estado PMS', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción Monitor',
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '512' } });

    await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Televisor sin señal',
      description: 'Se dejó registrado para revisión técnica.',
      priority: Priority.MEDIA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });
    await createTask(receptionist, {
      title: 'Revisar televisor 512',
      priority: Priority.ALTA,
      roomId: room.id,
      tags: [],
      checklist: [],
    });

    const board = await getRoomOperationsBoard({
      includeCashContext: false,
      selectedRoomNumber: '512',
    });

    expect(board.rooms).toHaveLength(89);
    expect(board.selected?.number).toBe('512');
    expect(board.selected?.counts.entries).toBe(1);
    expect(board.selected?.counts.tasks).toBe(1);
    expect(board.selected?.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['NOVEDAD', 'TAREA']),
    );
  });

  it('mantiene el monitor explícitamente fuera del dominio PMS', () => {
    const page = readFileSync('src/app/(app)/libro/habitaciones/page.tsx', 'utf8');
    const service = readFileSync('src/server/services/room-operations.ts', 'utf8');

    expect(page).toContain('No representa ocupación ni reemplaza al PMS');
    expect(page).toContain('La habitación es sólo contexto');
    expect(service).not.toContain('RoomStayStatus');
    expect(service).not.toContain('checkIn');
    expect(service).not.toContain('checkOut');
  });

  it('retira Central de Reservas del menú y conserva sólo una redirección compatible', () => {
    const nav = readFileSync('src/components/layout/nav-items.ts', 'utf8');
    const retired = readFileSync('src/app/(app)/central-reservas/page.tsx', 'utf8');
    const book = readFileSync('src/app/(app)/libro/page.tsx', 'utf8');

    expect(nav).not.toContain("href: '/central-reservas'");
    expect(nav).toContain("href: '/libro/habitaciones'");
    expect(retired).toContain("redirect('/libro/habitaciones')");
    expect(book).toContain("{ label: 'Habitaciones', href: '/libro/habitaciones' }");
  });

  it('todos los formularios operativos principales usan habitación estructurada', () => {
    const entries = readFileSync('src/components/forms/entry-form.tsx', 'utf8');
    const tasks = readFileSync('src/components/forms/task-form.tsx', 'utf8');
    const alarms = readFileSync('src/components/operational/operational-alarm-form.tsx', 'utf8');
    const cash = readFileSync('src/components/cash/live-cash-forms.tsx', 'utf8');

    expect(entries).toContain('name="roomId"');
    expect(entries).toContain('options={options.rooms}');
    expect(tasks).toContain('name="roomId"');
    expect(tasks).toContain('options={options.rooms}');
    expect(alarms).toContain('name="roomId"');
    expect(alarms).toContain('options={rooms}');
    expect(cash).toContain('HOTEL_ROOM_NUMBER_OPTIONS');
  });

  it('Estacionamiento pide ID Reserva y no una patente nueva', () => {
    const form = readFileSync('src/components/cash/live-cash-forms.tsx', 'utf8');
    const action = readFileSync('src/server/actions/live-cash.ts', 'utf8');
    const csv = readFileSync('src/app/api/caja/estacionamiento/route.ts', 'utf8');

    expect(form).toContain('label="ID Reserva"');
    expect(form).toContain('name="reservationCode"');
    expect(form).not.toContain('name="vehiclePlate"');
    expect(action).toContain("reservationCode: z.string().trim().min(2, 'Indica el ID de reserva.')");
    expect(csv).toContain("'ID Reserva'");
  });
});
