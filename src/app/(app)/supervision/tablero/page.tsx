import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ClipboardList, Users } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import type { RawSearchParams } from '@/lib/search-params';
import { getAssignmentBoard } from '@/server/services/assignment-board';
import { getMyOpenRun, listRuns, listTemplates } from '@/server/services/checklists';
import { PRIORITY_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import { AssignDialog } from './assign';
import {
  DeleteTemplateDialog,
  FinishRunDialog,
  MarkItemForm,
  StartRunForm,
  TemplateDialog,
} from './checklists';

export const metadata = { title: 'Tablero de supervisión' };
export const dynamic = 'force-dynamic';

const PRIORITY_TONE = {
  CRITICA: 'critico',
  ALTA: 'atencion',
  MEDIA: 'pendiente',
  BAJA: 'neutro',
} as const;

const RESULT_LABEL = {
  PENDIENTE: 'Sin revisar',
  OK: 'Conforme',
  FALLA: 'Falla',
  NO_APLICA: 'No aplica',
} as const;

const RESULT_TONE = {
  PENDIENTE: 'neutro',
  OK: 'resuelto',
  FALLA: 'critico',
  NO_APLICA: 'neutro',
} as const;

export default async function AssignmentBoardPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const seccion = typeof params.seccion === 'string' ? params.seccion : '';
  /*
    El tablero comparte exactamente la puerta de Supervisión: consultar o
    administrar turnos. `incident.manage` no concede acceso lateral por URL.
  */
  if (
    !hasPermission(user, 'supervision.view') &&
    !hasPermission(user, 'shift.manage')
  ) {
    redirect('/sin-permisos');
  }

  const canAssign = hasPermission(user, 'task.assign');
  const canConfigure = hasPermission(user, 'incident.manage');

  const [board, templates, runs, myRun] = await Promise.all([
    getAssignmentBoard(),
    listTemplates(canConfigure),
    listRuns(8),
    getMyOpenRun(user.id),
  ]);

  const pendingInRun = myRun?.items.filter((item) => item.result === 'PENDIENTE').length ?? 0;
  const textMatches = (values: Array<string | number | null | undefined>) =>
    !q ||
    values
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
      .toLowerCase()
      .includes(q);
  const visibleUnassigned = board.unassigned.filter((item) =>
    textMatches([item.seq, item.kind, item.priority, item.roomNumber, item.title]),
  );
  const visibleWorkload = board.workload.filter((row) =>
    textMatches([row.name, row.roleName, row.openTasks, row.overdueTasks, row.openEntries, row.urgent]),
  );
  const visibleTemplates = templates.filter((template) =>
    textMatches([
      template.name,
      template.description,
      template.cadence,
      ...template.items.map((item) => item.text),
    ]),
  );
  const visibleRuns = runs.filter((run) =>
    textMatches([
      run.templateName,
      run.runBy.name,
      run.notes,
      ...run.items.map((item) => item.text),
      ...run.items.map((item) => item.observation),
    ]),
  );
  const show = (name: string) => !seccion || seccion === name;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link
        href="/supervision"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Supervisión
      </Link>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <Users className="h-5 w-5 text-petrol-600" aria-hidden="true" />
          Tablero de asignación
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Quién hace qué y qué no tiene dueño. La carga de cada persona se calcula al
          cargar la pantalla: no hay contadores que mantener a mano.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Sin responsable"
          value={board.unassigned.length}
          tone={board.unassigned.length > 0 ? 'alert' : 'good'}
          hint={board.unassigned.length === 0 ? 'Todo tiene dueño' : undefined}
        />
        <StatTile
          label="Vencidas asignadas"
          value={board.overdueTotal}
          tone={board.overdueTotal > 0 ? 'alert' : 'good'}
        />
        <StatTile label="Personas operativas" value={board.workload.length} tone="neutral" />
      </div>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar tarea, persona, lista o ronda…"
        clearHref="/supervision/tablero"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Sección</span>
          <select name="seccion" defaultValue={seccion} className="input-base w-full">
            <option value="">Todas</option>
            <option value="sin-responsable">Sin responsable</option>
            <option value="carga">Carga por persona</option>
            <option value="listas">Listas de control</option>
            <option value="rondas">Rondas recientes</option>
          </select>
        </label>
      </ListFilterBar>

      {/* Lo que no tiene dueño va primero: es lo único que nadie está mirando. */}
      {show('sin-responsable') ? <Card>
        <CardHeader title="Sin responsable" count={visibleUnassigned.length} />
        {visibleUnassigned.length === 0 ? (
          <EmptyState
            message="Todo tiene responsable."
            hint="Nada quedó sin que alguien lo esté mirando."
          />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleUnassigned.map((item) => {
              const overdue = item.dueAt !== null && item.dueAt < board.now;
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-xs text-slate-400">#{item.seq}</span>
                      <Chip>{item.kind === 'task' ? 'Tarea' : 'Registro'}</Chip>
                      <Badge tone={PRIORITY_TONE[item.priority]}>
                        {PRIORITY_LABEL[item.priority]}
                      </Badge>
                      {overdue ? <Badge tone="critico">Vencida</Badge> : null}
                      {item.roomNumber ? <Chip>Hab. {item.roomNumber}</Chip> : null}
                    </div>
                    <Link
                      href={item.href}
                      className="mt-0.5 block font-medium text-petrol-900 hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Creada {formatDateTime(item.createdAt)}
                      {item.dueAt ? ` · vence ${formatDateTime(item.dueAt)}` : ''}
                    </p>
                  </div>
                  {canAssign ? (
                    <AssignDialog
                      kind={item.kind}
                      id={item.id}
                      title={item.title}
                      people={board.assignees}
                    />
                  ) : null}
                </li>
              );
            })}
            </ul>
          </CardScroll>
        )}
      </Card> : null}

      {show('carga') ? <Card>
        <CardHeader title="Carga por persona" count={visibleWorkload.length} />
        {visibleWorkload.length === 0 ? (
          <EmptyState message="Sin personal operativo activo." />
        ) : (
          <CardScroll>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Persona</th>
                  <th className="px-4 py-2 font-semibold">Tareas abiertas</th>
                  <th className="px-4 py-2 font-semibold">Vencidas</th>
                  <th className="px-4 py-2 font-semibold">Registros</th>
                  <th className="px-4 py-2 font-semibold">Urgentes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleWorkload.map((row) => (
                  <tr key={row.userId}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-petrol-900">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.roleName}</p>
                    </td>
                    <td className="px-4 py-2.5 tabular">{row.openTasks}</td>
                    <td className="px-4 py-2.5 tabular">
                      {row.overdueTasks > 0 ? (
                        <span className="font-semibold text-red-700">{row.overdueTasks}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular">{row.openEntries}</td>
                    <td className="px-4 py-2.5 tabular">
                      {row.urgent > 0 ? (
                        <span className="font-semibold text-orange-800">{row.urgent}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardScroll>
        )}
      </Card> : null}

      {/* La ronda abierta de esta persona, si la hay: es lo que tiene a medias. */}
      {myRun ? (
        <Card>
          <CardHeader
            title={`Ronda en curso: ${myRun.templateName}`}
            count={myRun.items.length}
            action={pendingInRun === 0 ? <FinishRunDialog runId={myRun.id} /> : null}
          />
          <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            {pendingInRun > 0
              ? `Quedan ${pendingInRun} punto(s) sin revisar. Márcalos, aunque sea como «no aplica».`
              : 'Todos los puntos revisados: ya puedes cerrarla.'}
          </p>
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {myRun.items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={RESULT_TONE[item.result]}>{RESULT_LABEL[item.result]}</Badge>
                </div>
                <MarkItemForm
                  itemId={item.id}
                  result={item.result}
                  observation={item.observation}
                  critical={item.critical}
                  text={item.text}
                />
              </li>
            ))}
            </ul>
          </CardScroll>
        </Card>
      ) : null}

      {show('listas') ? <Card>
        <CardHeader
          title="Listas de control"
          count={visibleTemplates.length}
          action={canConfigure ? <TemplateDialog /> : null}
        />
        {visibleTemplates.length === 0 ? (
          <EmptyState
            message="Sin listas de control."
            hint="Ármalas con los puntos que revisas en cada ronda."
          />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleTemplates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ClipboardList
                      className="h-4 w-4 shrink-0 text-petrol-600"
                      aria-hidden="true"
                    />
                    <p className="font-medium text-petrol-900">{template.name}</p>
                    <Chip>{template.items.length} punto(s)</Chip>
                    {template.items.some((item) => item.critical) ? (
                      <Badge tone="atencion">
                        {template.items.filter((item) => item.critical).length} crítico(s)
                      </Badge>
                    ) : null}
                    {template.active ? null : <Chip>Inactiva</Chip>}
                  </div>
                  {template.description ? (
                    <p className="mt-0.5 text-sm text-slate-600">{template.description}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {template.cadence ? `${template.cadence} · ` : ''}
                    {template._count.runs} ronda(s) recorrida(s)
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {template.active && !myRun ? <StartRunForm templateId={template.id} /> : null}
                  {canConfigure ? (
                    <>
                      <TemplateDialog
                        template={{
                          id: template.id,
                          name: template.name,
                          description: template.description,
                          cadence: template.cadence,
                          active: template.active,
                          items: template.items,
                        }}
                      />
                      <DeleteTemplateDialog templateId={template.id} />
                    </>
                  ) : null}
                </div>
              </li>
            ))}
            </ul>
          </CardScroll>
        )}
      </Card> : null}

      {show('rondas') ? <Card>
        <CardHeader title="Rondas recientes" count={visibleRuns.length} />
        {visibleRuns.length === 0 ? (
          <EmptyState message="Todavía no se ha recorrido ninguna lista." />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleRuns.map((run) => {
              const failures = run.items.filter((item) => item.result === 'FALLA');
              const criticalFailures = failures.filter((item) => item.critical);
              return (
                <li key={run.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-petrol-900">{run.templateName}</p>
                    {run.finishedAt ? (
                      failures.length === 0 ? (
                        <Badge tone="resuelto">Sin fallas</Badge>
                      ) : (
                        <Badge tone={criticalFailures.length > 0 ? 'critico' : 'atencion'}>
                          {failures.length} falla(s)
                          {criticalFailures.length > 0
                            ? `, ${criticalFailures.length} crítica(s)`
                            : ''}
                        </Badge>
                      )
                    ) : (
                      <Badge tone="curso">En curso</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {run.runBy.name} · {formatDateTime(run.startedAt)}
                    {run.finishedAt ? ` → ${formatDateTime(run.finishedAt)}` : ''}
                  </p>
                  {failures.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 border-l-2 border-red-200 pl-3">
                      {failures.map((item) => (
                        <li key={item.id} className="text-xs text-slate-700">
                          <span className="font-medium">{item.text}:</span>{' '}
                          {item.observation ?? 'sin observación'}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {run.notes ? (
                    <p className="mt-1 text-xs text-slate-600">{run.notes}</p>
                  ) : null}
                </li>
              );
            })}
            </ul>
          </CardScroll>
        )}
      </Card> : null}
    </div>
  );
}
