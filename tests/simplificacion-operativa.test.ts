import { describe, expect, it } from 'vitest';
import { EntryType, Priority, Severity } from '@prisma/client';
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

  it('una incidencia tampoco necesita contexto PMS', () => {
    const parsed = entryCreateWithContextSchema.safeParse({
      ...base,
      type: EntryType.INCIDENCIA,
      severity: Severity.ALTA,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.roomId).toBeNull();
    expect(parsed.data.guestId).toBeNull();
    expect(parsed.data.reservationId).toBeNull();
    expect(parsed.data.stayId).toBeNull();
  });

  it('una incidencia sigue exigiendo gravedad, no PMS', () => {
    const parsed = entryCreateWithContextSchema.safeParse({
      ...base,
      type: EntryType.INCIDENCIA,
    });

    expect(parsed.success).toBe(true);
  });
});
