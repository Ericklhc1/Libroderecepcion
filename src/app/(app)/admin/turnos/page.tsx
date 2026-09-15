import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ShiftStatus } from '@prisma/client';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { listOperationalUsers } from '@/server/services/users';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { ScheduleShiftForm } from '../admin-forms';
import { CancelShiftDialog } from './cancel-shift';
import {
  ASSIGNMENT_ROLE_LABEL,
  HANDOVER_STATUS_LABEL,
  HANDOVER_STATUS_TONE,
} from '@/domain/labels';
import { SHIFT_STATUS_LABEL, SHIFT_TYPE_LABEL } from '@/domain/shift';
import { formatDate, formatTime } from '@/lib/format';

export const metadata = { title: 'Programación de turnos' };
export const dynamic = 'force-dynamic';

const STATUS_TONE = {
  PROGRAMADO: 'pendiente',
  INICIADO: 'curso',
  ACTIVO: 'curso',
  PREPARANDO_ENTREGA: 'atencion',
  ENTREGA_ENVIADA: 'atencion',
  RECIBIDO: 'resuelto',
  CERRADO: 'neutro',
  ANULADO: 'neutro',
} as const;

export default async function ShiftAdminPage() {
  await requirePagePermission('shift.manage');

  const from = new Date();
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);

  const [shifts, users] = await Promise.all([
    prisma.shift.findMany({
      where: { date: { gte: from } },
      include: {
        assignments: { include: { user: { select: { id: true, name: true } } } },
        handoverOut: { select: { id: true, status: true } },
      },
      orderBy: [{ date: 'desc' }, { type: 'asc' }],
      take: 60,
    }),
    listOperationalUsers(),
  ]);

  const userOptions = users.map((user) => ({
    value: user.id,
    label: `${user.name} · ${user.role.name}`,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Programación de turnos</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Un turno por fecha y tipo. El Administrador de sistema no aparece entre las personas
          asignables: su rol está fuera de la operación.
        </p>
      </header>

      <Card>
        <CardHeader title="Programar o reasignar" />
        <div className="px-4 py-4">
          <ScheduleShiftForm users={userOptions} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Turnos recientes y próximos" count={shifts.length} />
        {shifts.length === 0 ? (
          <EmptyState message="No hay turnos programados." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shifts.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-petrol-900">
                      {SHIFT_TYPE_LABEL[shift.type]} · {formatDate(shift.date)}
                    </p>
                    <Badge tone={STATUS_TONE[shift.status]}>
                      {SHIFT_STATUS_LABEL[shift.status]}
                    </Badge>
                    {shift.handoverOut ? (
                      <Link href={`/turno/entrega/${shift.handoverOut.id}`}>
                        <Badge tone={HANDOVER_STATUS_TONE[shift.handoverOut.status]}>
                          Entrega {HANDOVER_STATUS_LABEL[shift.handoverOut.status]}
                        </Badge>
                      </Link>
                    ) : (
                      <Chip>Sin entrega</Chip>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Horario {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)} ·{' '}
                    {shift.assignments.length > 0
                      ? shift.assignments
                          .map((a) => `${a.user.name} (${ASSIGNMENT_ROLE_LABEL[a.role]})`)
                          .join(' · ')
                      : 'sin personal asignado'}
                  </p>
                  {shift.notes ? (
                    <p className="mt-0.5 text-xs text-slate-500">Notas: {shift.notes}</p>
                  ) : null}
                </div>
                {shift.status === ShiftStatus.PROGRAMADO ? (
                  <CancelShiftDialog shiftId={shift.id} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
