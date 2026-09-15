import Link from 'next/link';
import { EntryType, Severity } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ShieldAlert } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { entryInclude } from '@/server/services/entries';
import { getFormOptions } from '@/server/services/options';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, EmptyState, StatTile } from '@/components/ui/card';
import { Filters } from '@/components/operational/filters';
import {
  ENTRY_OPEN_STATUSES,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  IMPACT_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  isOverdue,
} from '@/domain/labels';
import { formatDateTime, relativeTime } from '@/lib/format';
import { filterValues, type RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Incidencias' };
export const dynamic = 'force-dynamic';

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePageUser();
  const params = await searchParams;
  const values = filterValues(params);
  const gravedad = typeof params.gravedad === 'string' ? params.gravedad : undefined;

  const where: Prisma.OperationalEntryWhereInput = {
    deletedAt: null,
    type: EntryType.INCIDENCIA,
    ...(values.estado === 'abiertos'
      ? { status: { in: ENTRY_OPEN_STATUSES } }
      : values.estado
        ? { status: values.estado as Prisma.EnumEntryStatusFilter }
        : {}),
    ...(gravedad && gravedad in Severity ? { severity: gravedad as Severity } : {}),
    ...(values.area ? { departmentId: values.area } : {}),
    ...(values.responsable ? { ownerId: values.responsable } : {}),
    ...(values.prioridad ? { priority: values.prioridad as Prisma.EnumPriorityFilter } : {}),
    ...(values.habitacion
      ? {
          OR: [
            { guest: { roomNumber: { contains: values.habitacion, mode: 'insensitive' } } },
            { reservation: { roomNumber: { contains: values.habitacion, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(values.q
      ? {
          OR: [
            { title: { contains: values.q, mode: 'insensitive' } },
            { description: { contains: values.q, mode: 'insensitive' } },
            { rootCause: { contains: values.q, mode: 'insensitive' } },
            { resolution: { contains: values.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [incidents, options, bySeverity, openCount] = await Promise.all([
    prisma.operationalEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
      take: 150,
    }),
    getFormOptions(),
    prisma.operationalEntry.groupBy({
      by: ['severity'],
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
      _count: { _all: true },
    }),
    prisma.operationalEntry.count({
      where: { deletedAt: null, type: EntryType.INCIDENCIA, status: { in: ENTRY_OPEN_STATUSES } },
    }),
  ]);

  const severityCount = (severity: Severity) =>
    bySeverity.find((row) => row.severity === severity)?._count._all ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <ShieldAlert className="h-5 w-5 text-red-600" aria-hidden="true" />
          Incidencias
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Registros del libro con estructura ampliada: gravedad, impacto, acción inmediata, causa y
          resolución.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Vista especializada. Para ver las incidencias junto al resto de la operación,
          abre el{' '}
          <Link href="/libro?clase=entry&tipo=INCIDENCIA" className="font-medium text-petrol-600 hover:underline">
            libro operativo
          </Link>
          .
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Abiertas" value={openCount} tone={openCount > 0 ? 'alert' : 'good'} />
        {Object.values(Severity).map((severity) => (
          <StatTile
            key={severity}
            label={`Gravedad ${SEVERITY_LABEL[severity]}`}
            value={severityCount(severity)}
            tone={severity === Severity.CRITICA && severityCount(severity) > 0 ? 'alert' : 'neutral'}
          />
        ))}
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filtro por gravedad">
        <Link
          href="/incidencias?estado=abiertos"
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-petrol-700 shadow-card ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Sólo abiertas
        </Link>
        {Object.values(Severity).map((severity) => (
          <Link
            key={severity}
            href={`/incidencias?gravedad=${severity}`}
            className="rounded-lg bg-white px-3 py-1.5 text-sm shadow-card ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>
          </Link>
        ))}
      </nav>

      <Filters
        action="/incidencias"
        fields={['q', 'estado', 'prioridad', 'area', 'responsable', 'habitacion']}
        values={values}
        options={{ departments: options.departments, users: options.users }}
        extraHidden={gravedad ? { gravedad } : undefined}
      />

      <Card>
        {incidents.length === 0 ? (
          <EmptyState
            message="No hay incidencias con esos filtros."
            hint="Registra una desde las acciones rápidas: requiere indicar gravedad."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {incidents.map((incident) => {
              const open = ENTRY_OPEN_STATUSES.includes(incident.status);
              const overdue = isOverdue(incident.dueAt, open);
              return (
                <li key={incident.id}>
                  <Link
                    href={`/libro/${incident.id}`}
                    className="block px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs tabular text-slate-400">#{incident.seq}</span>
                      {incident.severity ? (
                        <Badge tone={SEVERITY_TONE[incident.severity]}>
                          Gravedad {SEVERITY_LABEL[incident.severity]}
                        </Badge>
                      ) : null}
                      <Badge tone={ENTRY_STATUS_TONE[incident.status]}>
                        {ENTRY_STATUS_LABEL[incident.status]}
                      </Badge>
                      <Badge tone={PRIORITY_TONE[incident.priority]} withSymbol={false}>
                        {PRIORITY_LABEL[incident.priority]}
                      </Badge>
                      {incident.impact ? <Chip>{IMPACT_LABEL[incident.impact]}</Chip> : null}
                      {overdue ? <Badge tone="critico">Vencida</Badge> : null}
                    </div>
                    <p className="mt-1 font-medium text-petrol-900">{incident.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                      {incident.description}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(incident.occurredAt)} ·{' '}
                      {incident.owner ? `Resp.: ${incident.owner.name}` : 'sin responsable'}
                      {incident.department ? ` · ${incident.department.name}` : ''}
                      {incident.guest
                        ? ` · ${incident.guest.fullName}${incident.guest.roomNumber ? ` (hab. ${incident.guest.roomNumber})` : ''}`
                        : ''}
                      {incident.dueAt ? ` · vence ${relativeTime(incident.dueAt)}` : ''}
                      {incident._count.followUps > 0
                        ? ` · ${incident._count.followUps} seguimiento(s)`
                        : ''}
                    </p>
                    {incident.resolution ? (
                      <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                        Resolución: {incident.resolution}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
