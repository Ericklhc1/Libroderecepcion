import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { redirect } from 'next/navigation';
import { getSupervisionData, type SupervisionBlock } from '@/server/services/supervision';
import { Card, CardHeader, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { TONE_STYLES } from '@/components/ui/tone';
import { Badge, Chip } from '@/components/ui/badge';
import { listAnnouncements } from '@/server/services/announcements';
import { listOperationalUsers } from '@/server/services/users';
import {
  CloseAnnouncementDialog,
  NewAnnouncementDialog,
} from './announcements';
import { ResolveAllConflictsDialog } from '@/components/rooms/resolve-all-conflicts';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Supervisión' };
export const dynamic = 'force-dynamic';
/* Reúne nueve consultas en paralelo más el detector de conflictos. */
export const maxDuration = 60;

function Block({ block }: { block: SupervisionBlock }) {
  const tone = TONE_STYLES[block.tone];
  return (
    <Card className="flex h-[30rem] flex-col overflow-hidden">
      <CardHeader title={block.title} count={block.rows.length} />
      <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{block.hint}</p>
      {block.rows.length === 0 ? (
        <EmptyState message="Nada que revisar en este punto." />
      ) : (
        <CardScroll className="flex-1" maxHeight="max-h-none">
          <ul className="divide-y divide-slate-100">
          {block.rows.map((row) => (
            <li key={row.id}>
              <Link
                href={row.href}
                className="flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50 active:bg-slate-100"
              >
                <span
                  className={`mt-0.5 shrink-0 text-xs font-semibold ${tone.text}`}
                  aria-hidden="true"
                >
                  {tone.symbol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-medium tabular text-slate-500">{row.ref}</span>
                    <span className="text-sm font-medium text-petrol-900">{row.title}</span>
                  </span>
                  {row.detail ? (
                    <span className="mt-0.5 block truncate text-xs text-slate-600">
                      {row.detail}
                    </span>
                  ) : null}
                  {row.meta ? (
                    <span className="mt-0.5 block text-xs text-slate-500">{row.meta}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
          </ul>
        </CardScroll>
      )}
    </Card>
  );
}

export default async function SupervisionPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const tono = typeof params.tono === 'string' ? params.tono : '';
  /*
    Debe coincidir exactamente con la navegación. Gestionar incidencias no
    equivale a supervisar el trabajo de otros: Recepción puede gestionar una
    incidencia sin obtener acceso al tablero de Supervisión por URL directa.
  */
  if (
    !hasPermission(user, 'supervision.view') &&
    !hasPermission(user, 'shift.manage')
  ) {
    redirect('/sin-permisos');
  }

  const canAnnounce = hasPermission(user, 'announcement.manage');
  const canResolveAllConflicts = hasPermission(user, 'conflict.resolve_all');

  const [{ blocks, total, now }, announcements, operationalUsers] = await Promise.all([
    getSupervisionData(),
    canAnnounce ? listAnnouncements() : Promise.resolve([]),
    canAnnounce ? listOperationalUsers() : Promise.resolve([]),
  ]);

  const critical = blocks
    .filter((block) => block.tone === 'critico')
    .reduce((sum, block) => sum + block.rows.length, 0);
  const conflicts = blocks
    .filter((block) => block.key.startsWith('conflictos'))
    .reduce((sum, block) => sum + block.rows.length, 0);
  const unassigned = blocks.find((block) => block.key === 'sin-responsable')?.rows.length ?? 0;

  const visibleBlocks = blocks
    .filter((block) => (!tono ? true : block.tone === tono))
    .map((block) => ({
      ...block,
      rows: block.rows.filter((row) => {
        if (!q) return true;
        return [row.ref, row.title, row.detail, row.meta]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    }))
    .filter((block) => block.rows.length > 0);
  const visibleTotal = visibleBlocks.reduce((sum, block) => sum + block.rows.length, 0);
  const visibleAnnouncements = announcements.filter((announcement) => {
    if (!q) return true;
    return [
      announcement.title,
      announcement.body,
      announcement.createdByName,
      announcement.targetName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <ShieldCheck className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Supervisión
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Todo lo que requiere una decisión y no la ha recibido. Se calcula en cada
            carga: no hay listas que haya que mantener a mano.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* El tablero de asignación es la otra mitad de Supervisión. */}
          <Link
            href="/supervision/tablero"
            className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
          >
            Tablero de asignación y checklists
          </Link>
          {canResolveAllConflicts && conflicts > 0 ? (
            <ResolveAllConflictsDialog count={conflicts} />
          ) : null}
          <p className="text-xs text-slate-500">Al {formatDateTime(now)}</p>
        </div>
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar habitación, ID, responsable, detalle…"
        clearHref="/supervision"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Prioridad visual</span>
          <select name="tono" defaultValue={tono} className="input-base w-full">
            <option value="">Todas</option>
            <option value="critico">Crítico</option>
            <option value="atencion">Atención</option>
            <option value="curso">En curso</option>
          </select>
        </label>
      </ListFilterBar>

      {/*
        Los comunicados obligatorios viven en Supervisión porque son su
        herramienta: parar el mesón para decir algo que nadie puede dejar de
        leer. No son una alerta (eso describe un estado) ni una notificación
        (eso se puede ignorar).
      */}
      {canAnnounce ? (
        <Card>
          <CardHeader
            title="Comunicados obligatorios"
            count={visibleAnnouncements.filter((a) => a.active).length}
            action={
              <NewAnnouncementDialog
                users={operationalUsers.map((u) => ({
                  value: u.id,
                  label: `${u.name} · ${u.role.name}`,
                }))}
              />
            }
          />
          {visibleAnnouncements.length === 0 ? (
            <EmptyState
              message="Sin comunicados."
              hint="Un comunicado bloquea la pantalla hasta que se confirme la lectura."
            />
          ) : (
            <CardScroll>
              <ul className="divide-y divide-slate-100">
              {visibleAnnouncements.map((announcement) => (
                <li key={announcement.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-petrol-900">{announcement.title}</p>
                        {announcement.active ? (
                          <Badge
                            tone={
                              announcement.confirmed >= announcement.expected
                                ? 'resuelto'
                                : 'pendiente'
                            }
                          >
                            {announcement.confirmed} de {announcement.expected} confirmado(s)
                          </Badge>
                        ) : (
                          <Chip>Retirado</Chip>
                        )}
                        {announcement.targetName ? (
                          <Chip>Para {announcement.targetName}</Chip>
                        ) : null}
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">
                        {announcement.body}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {announcement.createdByName} ·{' '}
                        {formatDateTime(announcement.createdAt)}
                        {announcement.expiresAt
                          ? ` · caduca ${formatDateTime(announcement.expiresAt)}`
                          : ''}
                      </p>
                      {announcement.reads.length > 0 ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-medium text-petrol-600">
                            Ver qué escribió cada uno
                          </summary>
                          <ul className="mt-1 space-y-1 border-l-2 border-slate-200 pl-3">
                            {announcement.reads.map((read) => (
                              <li key={`${announcement.id}-${read.name}-${read.at.toISOString()}`}>
                                <p className="text-xs font-medium text-petrol-800">
                                  {read.name} · {formatDateTime(read.at)}
                                </p>
                                <p className="text-xs text-slate-600">{read.text}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                    {announcement.active ? (
                      <CloseAnnouncementDialog announcementId={announcement.id} />
                    ) : null}
                  </div>
                </li>
              ))}
              </ul>
            </CardScroll>
          )}
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Puntos por revisar"
          value={total}
          tone={total > 0 ? 'alert' : 'good'}
          hint={total === 0 ? 'Nada pendiente de intervención' : undefined}
        />
        <StatTile label="Críticos" value={critical} tone={critical > 0 ? 'alert' : 'good'} />
        <StatTile
          label="Conflictos de habitación y llaves"
          value={conflicts}
          tone={conflicts > 0 ? 'alert' : 'good'}
        />
        <StatTile
          label="Sin responsable"
          value={unassigned}
          tone={unassigned > 0 ? 'alert' : 'good'}
        />
      </div>

      {visibleTotal === 0 ? (
        <Card>
          <EmptyState
            message="No hay nada escalado, vencido, sin responsable ni en conflicto."
            hint="Cuando algo lo requiera, aparecerá acá sin que nadie tenga que anotarlo."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleBlocks.map((block) => (
            <Block key={block.key} block={block} />
          ))}
        </div>
      )}

      {/* La leyenda del semáforo: el color nunca es la única señal. */}
      <p className="text-xs text-slate-500">
        {TONE_STYLES.critico.symbol} crítico · {TONE_STYLES.atencion.symbol} requiere
        atención · {TONE_STYLES.curso.symbol} en curso
      </p>
    </div>
  );
}
