export const ROOM_RANGES = [
  { floor: 4, from: 401, to: 429 },
  { floor: 5, from: 501, to: 530 },
  { floor: 6, from: 601, to: 630 },
] as const;

export const ROOM_NUMBERS = ROOM_RANGES.flatMap((range) =>
  Array.from({ length: range.to - range.from + 1 }, (_, index) =>
    String(range.from + index),
  ),
);

export const ROOM_NUMBER_OPTIONS = ROOM_NUMBERS.map((number) => ({
  value: number,
  label: number,
}));

const ROOM_NUMBER_SET = new Set<string>(ROOM_NUMBERS);

export function isOperationalRoomNumber(value: string | null | undefined): boolean {
  return Boolean(value && ROOM_NUMBER_SET.has(value.trim()));
}

export function roomFloor(number: string): number | null {
  const room = Number(number);
  if (!Number.isInteger(room)) return null;
  return Math.trunc(room / 100);
}

export function roomNumbers(): Array<{ number: string; floor: number }> {
  return ROOM_NUMBERS.map((number) => ({
    number,
    floor: roomFloor(number)!,
  }));
}
