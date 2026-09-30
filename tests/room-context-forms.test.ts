import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROOM_NUMBERS } from '@/domain/room-catalog';

describe('contrato transversal de habitación', () => {
  it('mantiene exactamente las 89 habitaciones canónicas', () => {
    expect(ROOM_NUMBERS).toHaveLength(89);
    expect(ROOM_NUMBERS.slice(0, 3)).toEqual(['401', '402', '403']);
    expect(ROOM_NUMBERS).toContain('429');
    expect(ROOM_NUMBERS).toContain('501');
    expect(ROOM_NUMBERS).toContain('530');
    expect(ROOM_NUMBERS).toContain('601');
    expect(ROOM_NUMBERS.at(-1)).toBe('630');
  });

  it('los formularios operativos no vuelven a pedir habitación como texto libre', () => {
    const files = [
      'src/components/forms/entry-form.tsx',
      'src/components/forms/task-form.tsx',
      'src/components/operational/operational-alarm-form.tsx',
      'src/components/cash/live-cash-forms.tsx',
      'src/app/(app)/huespedes/guest-forms.tsx',
      'src/app/(app)/huespedes/nueva-reserva/page.tsx',
    ];

    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toContain('<Input name="roomNumber"');
    }

    expect(readFileSync(files[0]!, 'utf8')).toContain('options.rooms');
    expect(readFileSync(files[1]!, 'utf8')).toContain('options.rooms');
    for (const path of files.slice(2)) {
      expect(readFileSync(path, 'utf8'), path).toContain('ROOM_NUMBER_OPTIONS');
    }
  });

  it('el monitor declara habitación como contexto operativo y no como PMS', () => {
    const page = readFileSync('src/app/(app)/novedades/habitacion/page.tsx', 'utf8');
    expect(page).toContain('Las 89 habitaciones como mapa de contexto');
    expect(page).toContain('No muestra ocupación');
    expect(page).toContain('defaultRoomId={detail.room.id}');
    expect(page).toContain('defaultRoomNumber={detail.room.number}');
  });

  it('Central de Reservas queda retirada y redirige al monitor', () => {
    const legacy = readFileSync('src/app/(app)/central-reservas/page.tsx', 'utf8');
    const nav = readFileSync('src/components/layout/nav-items.ts', 'utf8');

    expect(legacy).toContain("redirect('/novedades/habitacion')");
    expect(nav).toContain("href: '/novedades/habitacion'");
    expect(nav).not.toContain("href: '/central-reservas'");
  });

  it('Estacionamiento usa ID Reserva y no vuelve a mostrar Patente', () => {
    const forms = readFileSync('src/components/cash/live-cash-forms.tsx', 'utf8');
    const page = readFileSync('src/app/(app)/caja/page.tsx', 'utf8');
    const csv = readFileSync('src/app/api/caja/estacionamiento/route.ts', 'utf8');

    expect(forms).toContain('label="ID Reserva"');
    expect(forms).toContain('name="reservationCode"');
    expect(page).toContain('{pass.reservationCode ?? "—"}');
    expect(csv).toContain("'ID Reserva'");
    expect(forms).not.toContain('label="Patente"');
  });
});
