import 'server-only';
import { prisma } from '@/lib/prisma';
import { SHIFT_TYPE_LABEL } from '@/domain/shift';
import type { Option } from './options';

/** Turnos recientes para los filtros (últimos 30 días). */
export async function getShiftOptions(): Promise<Option[]> {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  from.setHours(0, 0, 0, 0);

  const shifts = await prisma.shift.findMany({
    where: { date: { gte: from } },
    orderBy: [{ date: 'desc' }, { type: 'asc' }],
    select: { id: true, date: true, type: true },
    take: 120,
  });

  return shifts.map((shift) => ({
    value: shift.id,
    label: `${shift.date.toLocaleDateString('es-CL')} · ${SHIFT_TYPE_LABEL[shift.type]}`,
  }));
}
