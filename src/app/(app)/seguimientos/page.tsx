import {boundedPage,pageHref as listPageHref} from '@/lib/search-params';
import {NoticeNavigation} from '@/components/operational/notice-navigation';
import { followUpReadWhere } from '@/server/services/followup-access';
import Link from 'next/link';
import { FollowUpStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Repeat } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { followUpInclude } from '@/server/services/followups';
import { refreshAlertsInBackground } from '@/server/services/dashboard';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { CloseFollowUpDialog } from '@/components/operational/entry-actions';
import { FOLLOWUP_STATUS_LABEL, FOLLOWUP_STATUS_TONE } from '@/domain/labels';
import { formatDateTime, relativeTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Avisos · Pendientes que continúan' };
export const dynamic = 'force-dynamic';

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const page=boundedPage(params.pagina);
  const pageHref=(number:number)=>listPageHref('/seguimientos',params,number);
  refreshAlertsInBackground();

  const q = typeof params.q === 'string' ? params.q.trim().replace(/^#/, '') : '';
  const humanId = /^\d+$/.test(q) ? Number(q) : null;
  const estado = typeof params.estado === 'string' ? params.estado : 'pendientes';
  const mios = params.mios === '1';
  const visibilityWhere = followUpReadWhere(user);

  const where: Prisma.FollowUpWhereInput = {
    AND: [visibilityWhere],
    deletedAt: null,
    ...(mios ? { ownerId: user.id } : {}),
    ...(q
      ? {
          OR: [
            ...(humanId !== null ? [{ humanId }] : []),
            { action: { contains: q, mode: 'insensitive' } },
            { result: { contains: q, mode: 'insensitive' } },
            { nextAction: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(estado === 'pendientes'
      ? { status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] } }
      : estado && estado in FollowUpStatus
        ? { status: estado as FollowUpStatus }
        : {}),
  };

  const [followUps, counts, total] = await Promise.all([
    prisma.followUp.findMany({
      where,
      include: followUpInclude,
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' },{id:'asc'}],
      skip:(page-1)*150, take: 150,
    }),
    prisma.followUp.groupBy({
      by: ['status'],
      where: { deletedAt: null, AND: [visibilityWhere] },
      _count: { _all: true },
    }),
    prisma.followUp.count({where}),
  ]);

  const countByStatus = (status: FollowUpStatus) =>
    counts.find((row) => row.status === status)?._count._all ?? 0;

  const followHref = (nextEstado: string) => {
    const query = new URLSearchParams({ estado: nextEstado });
    if (mios) query.set('mios', '1');
    if (q) query.set('q', q);
    return `/seguimientos?${query.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <NoticeNavigation permissions={user.permissions} current="continuity"/>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <Repeat className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Avisos · Pendientes que continúan
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Asuntos que decidiste mantener en tu radar. El sistema conserva la trazabilidad y avisa si vence la revisión.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Esta es una vista especializada de continuidad. Para priorizar responsables, recepción y siguientes acciones junto con el resto de la operación, abre{' '}
            <Link href="/coordinacion" className="font-medium text-petrol-600 hover:underline">
              Coordinación
            </Link>
            . El seguimiento conserva su vínculo con el registro o tarea que lo originó.
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <Link
            href={mios ? '/seguimientos' : '/seguimientos?mios=1'}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
              mios
                ? 'bg-petrol-700 text-white ring-petrol-700'
                : 'bg-white text-petrol-700 ring-slate-300'
            }`}
          >
            {mios ? 'Viendo los míos' : 'Ver sólo los míos'}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Pendientes"
          value={countByStatus(FollowUpStatus.PENDIENTE)}
          tone="neutral"
        />
        <StatTile
          label="Vencidos"
          value={countByStatus(FollowUpStatus.VENCIDO)}
          tone={countByStatus(FollowUpStatus.VENCIDO) > 0 ? 'alert' : 'good'}
        />
        <StatTile label="Resueltos" value={countByStatus(FollowUpStatus.CUMPLIDO)} tone="good" />
        <StatTile label="Cancelados" value={countByStatus(FollowUpStatus.CANCELADO)} />
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filtro de seguimientos">
        {[
          { key: 'pendientes', label: 'Pendientes y vencidos' },
          { key: 'CUMPLIDO', label: 'Resueltos' },
          { key: 'CANCELADO', label: 'Cancelados' },
          { key: 'todos', label: 'Todos' },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={followHref(tab.key)}
            aria-current={estado === tab.key ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
              estado === tab.key
                ? 'bg-petrol-700 text-white ring-petrol-700'
                : 'bg-white text-petrol-700 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="#ID, acción, resultado o próxima acción…"
        clearHref="/seguimientos"
      >
        <label className="min-w-[13rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
          <select name="estado" defaultValue={estado} className="input-base w-full">
            <option value="pendientes">Pendientes y vencidos</option>
            <option value="CUMPLIDO">Resueltos</option>
            <option value="CANCELADO">Cancelados</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        {mios ? <input type="hidden" name="mios" value="1" /> : null}
      </ListFilterBar>

      <Card>
        {followUps.length === 0 ? (
          <EmptyState
            message="No hay asuntos en seguimiento en esta vista."
            hint="Usa «Seguir» desde Supervisión cuando quieras mantener un asunto en tu radar."
          />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {followUps.map((followUp) => (
              <li key={followUp.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular text-petrol-700">#{followUp.humanId}</span>
                  <Badge tone={FOLLOWUP_STATUS_TONE[followUp.status]}>
                    {FOLLOWUP_STATUS_LABEL[followUp.status]}
                  </Badge>
                  {followUp.entry ? (
                    <Link href={`/libro/${followUp.entry.id}`}>
                      <Chip>Registro #{followUp.entry.humanId}</Chip>
                    </Link>
                  ) : null}
                  {followUp.task ? (
                    <Link href={`/tareas/${followUp.task.id}`}>
                      <Chip>Tarea #{followUp.task.humanId}</Chip>
                    </Link>
                  ) : null}
                </div>

                <p className="mt-1 font-medium text-petrol-900">{followUp.action}</p>
                {followUp.result ? (
                  <p className="mt-0.5 text-sm text-slate-700">
                    <span className="text-xs font-medium text-slate-500">Resultado: </span>
                    {followUp.result}
                  </p>
                ) : null}
                {followUp.nextAction ? (
                  <p className="mt-0.5 text-sm text-slate-700">
                    <span className="text-xs font-medium text-slate-500">Próxima acción: </span>
                    {followUp.nextAction}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">
                  Responsable: {followUp.owner.name} · creado por {followUp.createdBy.name} el{' '}
                  {formatDateTime(followUp.createdAt)}
                  {followUp.scheduledAt
                    ? ` · programado ${formatDateTime(followUp.scheduledAt)} (${relativeTime(followUp.scheduledAt)})`
                    : ' · sin fecha programada'}
                  {followUp.completedAt ? ` · cerrado ${formatDateTime(followUp.completedAt)}` : ''}
                </p>

                {(followUp.status === FollowUpStatus.PENDIENTE ||
                  followUp.status === FollowUpStatus.VENCIDO) &&
                (followUp.ownerId === user.id ||
                  followUp.createdById === user.id ||
                  user.permissions.includes('followup.manage')) ? (
                  <div className="mt-2 no-print">
                    <CloseFollowUpDialog followUpId={followUp.id} />
                  </div>
                ) : null}
              </li>
            ))}
            </ul>
          </CardScroll>
        )}
      </Card>
      <nav aria-label="Páginas de seguimientos" className="flex items-center justify-between gap-2 text-sm">{page>1?<Link href={pageHref(page-1)}>← Anterior</Link>:<span/>}<span>Página {page} · {total} registros</span>{page*150<total&&<Link href={pageHref(page+1)}>Siguiente →</Link>}</nav>
    </div>
  );
}
