import { describe, expect, it } from 'vitest';
import { EntryType, Priority } from '@prisma/client';
import { entryCreateWithContextSchema } from '@/server/schemas';

const base = {
  title: 'Novedad sin contexto de reserva',
  description: 'Registro operativo autónomo para comprobar la simplificación.',
  priority: Priority.MEDIA,
  tags: '',
  requiresFollowUp: '',
};

describe('simplificación operativa', () => {
  it('permite registrar una novedad sin habitación, huésped, reserva ni estadía', () => {
    const parsed = entryCreateWithContextSchema.safeParse({
      ...base,
      type: EntryType.NOVEDAD,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.roomId).toBeNull();
    expect(parsed.data.guestId).toBeNull();
    expect(parsed.data.reservationId).toBeNull();
    expect(parsed.data.stayId).toBeNull();
  });

  it('mantiene contexto obligatorio para una incidencia', () => {
    const parsed = entryCreateWithContextSchema.safeParse({
      ...base,
      type: EntryType.INCIDENCIA,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === 'roomId')).toBe(true);
    expect(parsed.error.issues.some((issue) => issue.path[0] === 'departmentId')).toBe(true);
  });
});
