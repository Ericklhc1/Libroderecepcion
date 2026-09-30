export const ROOM_RANGES = [
  { floor: 4, from: 401, to: 429 },
  { floor: 5, from: 501, to: 530 },
  { floor: 6, from: 601, to: 630 },
] as const;

export function roomNumbers(): Array<{ number: string; floor: number }> {
  const rooms: Array<{ number: string; floor: number }> = [];
  for (const range of ROOM_RANGES) {
    for (let number = range.from; number <= range.to; number += 1) {
      rooms.push({ number: String(number), floor: range.floor });
    }
  }
  return rooms;
}

export const ROOM_NUMBER_OPTIONS = roomNumbers().map((room) => ({
  value: room.number,
  label: room.number,
}));
