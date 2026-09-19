import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { addCalendarDateDays, hotelCalendarDate } from '@/domain/time';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { ArchiveShiftDialog } from './cancel-shift';
import {
  ASSIGNMENT_ROLE_LABEL,
  HANDOVER_STATUS_LABEL,
  HANDOVER_STATUS_TONE,
} from '@/domain/labels';
import { SHIFT_STATUS_LABEL, SHIFT_TYPE_LABEL, windowHours } from '@/domain/shift';
import { formatDate, formatTime } from '@/lib/format';

export const metadata = { title: 'Historial de turnos' };
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
  const user = await requirePagePermission('shift.manage');

  const from = addCalendarDateDays(hotelCalendarDate(), -30);

  const shifts = await prisma.shift.findMany({
    where: { date: { gte: from } },
    include: {
      assignments: { include: { user: { select: { id: true, name: true } } } },
      handoverOut: { select: { id: true, status: true } },
    },
    orderBy: [{ date: 'desc' }, { actualStart: 'desc' }, { createdAt: 'desc' }],
    take: 120,
  });

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
        <h1 className="text-xl font-semibold text-petrol-900">Historial y archivo de turnos</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Los turnos no se programan desde aquí. Se abren al comenzar la operación y sólo puede
          existir uno en curso. Esta pantalla conserva la trazabilidad y permite retirar turnos
          sin borrar su información.
          {user.isSystemAdmin
            ? ' Como Administrador de sistema, puedes retirar también un turno que aún no esté cerrado.'
            : ''}
        </p>
      </header>

      <Card>
        <CardHeader title="Turnos recientes" count={shifts.length} />
        {shifts.length === 0 ? (
          <EmptyState message="Todavía no hay turnos en el historial." />
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
                    {shift.archivedAt ? <Chip>Archivado</Chip> : null}
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
                    Ventana {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)} (
                    {windowHours(shift.plannedStart, shift.plannedEnd)} h) ·{' '}
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
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <ArchiveShiftDialog
                    shiftId={shift.id}
                    archived={shift.archivedAt !== null}
                    systemAdmin={user.isSystemAdmin}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
