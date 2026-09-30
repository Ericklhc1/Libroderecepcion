/**
 * Catálogo operativo de habitaciones del Hotel HW Libertad.
 *
 * AROH NO usa esta lista para gestionar ocupación, check-in, check-out ni
 * disponibilidad. La habitación es contexto transversal para Novedades,
 * Tareas, Alertas, Garantías y otros registros operativos.
 */
export const HOTEL_ROOM_RANGES = [
  { floor: 4, from: 401, to: 429 },
  { floor: 5, from: 501, to: 530 },
  { floor: 6, from: 601, to: 630 },
] as const;

export type HotelFloor = (typeof HOTEL_ROOM_RANGES)[number]['floor'];

export const HOTEL_ROOMS: Array<{ number: string; floor: HotelFloor }> =
  HOTEL_ROOM_RANGES.flatMap((range) =>
    Array.from({ length: range.to - range.from + 1 }, (_, index) => ({
      number: String(range.from + index),
      floor: range.floor,
    })),
  );

export const HOTEL_ROOM_NUMBERS = HOTEL_ROOMS.map((room) => room.number);

export const HOTEL_ROOM_NUMBER_OPTIONS = HOTEL_ROOMS.map((room) => ({
  value: room.number,
  label: room.number,
}));

export function isHotelRoomNumber(value: string | null | undefined): boolean {
  return Boolean(value && HOTEL_ROOM_NUMBERS.includes(value.trim()));
}

export function hotelRoomFloor(value: string | null | undefined): HotelFloor | null {
  const room = HOTEL_ROOMS.find((candidate) => candidate.number === value?.trim());
  return room?.floor ?? null;
}
