import { ShiftStatus, ShiftType } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOperationalBusinessDate } from '@/server/services/shifts';
import { prisma, resetOperationalData } from './helpers';

describe('fecha operativa derivada del ciclo de turnos', () => {
  beforeEach(async () => {
    await resetOperationalData();
  });

  it('mantiene la fecha del turno nocturno aunque cambie el día calendario', async () => {
    await prisma.shift.create({
      data: {
        date: new Date('2026-09-29T00:00:00.000Z'),
        type: ShiftType.NOCHE,
        status: ShiftStatus.ACTIVO,
        plannedStart: new Date('2026-09-29T23:00:00.000Z'),
        plannedEnd: new Date('2026-09-30T11:00:00.000Z'),
        actualStart: new Date('2026-09-29T23:05:00.000Z'),
      },
    });

    const result = await resolveOperationalBusinessDate(
      new Date('2026-09-30T08:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  it('avanza de fecha cuando el último cierre corresponde al turno NOCHE', async () => {
    await prisma.shift.create({
      data: {
        date: new Date('2026-09-28T00:00:00.000Z'),
        type: ShiftType.NOCHE,
        status: ShiftStatus.CERRADO,
        plannedStart: new Date('2026-09-28T23:00:00.000Z'),
        plannedEnd: new Date('2026-09-29T11:00:00.000Z'),
        actualStart: new Date('2026-09-28T23:00:00.000Z'),
        actualEnd: new Date('2026-09-29T11:05:00.000Z'),
      },
    });

    const result = await resolveOperationalBusinessDate(
      new Date('2026-09-29T14:00:00.000Z'),
    );

    expect(result.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  it('conserva la fecha cuando el último cierre corresponde al turno DÍA', async () => {
    await prisma.shift.create({
      data: {
        date: new Date('2026-09-29T00:00:00.000Z'),
        type: ShiftType.DIA,
        status: ShiftStatus.CERRADO,
        plannedStart: new Date('2026-09-29T10:00:00.000Z'),
        plannedEnd: new Date('2026-09-29T23:00:00.000Z'),
        actualStart: new Date('2026-09-29T10:00:00.000Z'),
        actualEnd: new Date('2026-09-29T23:05:00.000Z'),
      },
    });

    const result = await resolveOperationalBusinessDate(
      new Date('2026-09-29T23:10:00.000Z'),
    );

    expect(result.toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });
});
