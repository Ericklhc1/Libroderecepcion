import { describe, expect, it } from 'vitest';
import { parseReservationLines } from '@/server/services/reservation-pdf';

describe('lector de reserva PDF FNSRooms', () => {
  it('extrae con precisión ID, huésped, habitación, fechas y canal aunque el PDF mezcle columnas', () => {
    const parsed = parseReservationLines([
      'ID: 7531122',
      'Confirmada Check-in Cobrado Check-out',
      'Datos de la reserva. ID: 7531122',
      'Alojamiento: Hotel Ejemplo',
      'Fecha de la reserva: 14/09/2026 19:29:40',
      'Localizador: 5790334310',
      'Canal: Booking Dirección: Calle Ejemplo 123',
      'Segmento: OTAS',
      'Entrada: 14/09/2026',
      'Salida: 15/09/2026',
      'Datos del cliente',
      'Nombre: María Ejemplo Soto',
      'Email: huesped@example.com',
      'Teléfono: +56911111111',
      'Dirección: Calle Ejemplo 123',
      'Ciudad: Santiago',
      'Datos empresa',
      'Desglose reserva',
      'ID TH Tarifa Régimen Precio Entrada Salida Ocupación Beb Hab. Huéspedes',
      '14897766 Doble Matrimonial Tarifa estándar AD CL$ 56.926 14/09/2026 15/09/2026 (1N) 2 405 María Ejemplo Soto Otro Huésped',
    ]);

    expect(parsed.code).toBe('7531122');
    expect(parsed.guestName).toBe('María Ejemplo Soto');
    expect(parsed.roomNumber).toBe('405');
    expect(parsed.checkInDate).toBe('2026-09-14');
    expect(parsed.checkOutDate).toBe('2026-09-15');
    expect(parsed.channel).toBe('Booking');
  });

  it('no confunde dirección, teléfono ni importes con habitación o canal', () => {
    const parsed = parseReservationLines([
      'Datos de la reserva. ID: 7531122',
      'Canal: Booking Dirección: Calle Ejemplo 123',
      'Entrada: 14/09/2026 Salida: 15/09/2026',
      'Datos del cliente Nombre: María Ejemplo Soto Email: huesped@example.com Teléfono: +56911111111 Dirección: Calle Ejemplo 123',
      'Datos empresa',
      'ID TH Tarifa Régimen Precio Entrada Salida Ocupación Beb Hab. Huéspedes',
      '14897766 Doble Matrimonial Tarifa estándar AD CL$ 56.926 14/09/2026 15/09/2026 (1N) 2 405 María Ejemplo Soto',
    ]);

    expect(parsed.channel).toBe('Booking');
    expect(parsed.roomNumber).toBe('405');
    expect(parsed.guestName).toBe('María Ejemplo Soto');
  });
});
